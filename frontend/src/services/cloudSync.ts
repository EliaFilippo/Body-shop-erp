import { authenticatedCloudFetch } from './cloudSession'
import type { ErpData } from '../types'
import type { CloudAuthConfig, CloudAuthSession } from './cloudAuth'

export interface CloudSnapshot {
  companyId: string
  revision: number
  payload: ErpData
  updatedAt: string
}

interface CloudSnapshotRow {
  company_id?: string
  revision?: number
  payload?: ErpData
  updated_at?: string
  message?: string
}

export class CloudSnapshotConflictError extends Error {
  constructor() {
    super('I dati cloud sono stati aggiornati da un altro dispositivo. Ricarica il gestionale prima di salvare di nuovo.')
    this.name = 'CloudSnapshotConflictError'
  }
}

const headers = (session: Pick<CloudAuthSession, 'accessToken'>, config: CloudAuthConfig) => ({
  'Content-Type': 'application/json',
  apikey: config.anonKey,
  Authorization: `Bearer ${session.accessToken}`,
})

function normalizeRow(row: CloudSnapshotRow): CloudSnapshot {
  if (!row.company_id || !row.payload) throw new Error('Snapshot cloud non valido.')
  return { companyId: row.company_id, revision: Math.max(0, Number(row.revision ?? 0)), payload: row.payload, updatedAt: String(row.updated_at ?? '') }
}

// Cache only acknowledged versions; never diff against an optimistic local save.
const acknowledged = new Map<string, CloudSnapshot>()
const archiveKey = (company: string, session: Pick<CloudAuthSession, 'accessToken'> & {userId?:string}, config: CloudAuthConfig) => `${config.url}|${company}|${session.userId??session.accessToken}`
export function clearCloudSnapshotCache() { acknowledged.clear() }
function remember(key: string, snapshot: CloudSnapshot) {
  acknowledged.set(key, structuredClone(snapshot))
  if (acknowledged.size > 4) acknowledged.delete(acknowledged.keys().next().value!)
}
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v,i) => sameJson(v,b[i]))
  const aa=a as Record<string,unknown>, bb=b as Record<string,unknown>
  const keys=Object.keys(aa).filter(k=>aa[k]!==undefined), other=Object.keys(bb).filter(k=>bb[k]!==undefined)
  return keys.length===other.length && keys.every(k=>Object.hasOwn(bb,k) && sameJson(aa[k],bb[k]))
}

async function responseMessage(response: Response) {
  let code: unknown
  try {
    const payload = await response.json() as { code?: unknown } | null
    code = payload?.code
  } catch {
    // Anche una risposta non JSON deve produrre un messaggio comprensibile.
  }
  if (response.status === 401) return 'La sessione cloud non è valida o è scaduta. Accedi di nuovo al gestionale.'
  if (response.status === 403 || code === '42501') return 'Accesso ai dati cloud negato. Occorre verificare i permessi del gestionale su Supabase.'
  return `Sincronizzazione cloud non riuscita (errore ${response.status}). Riprova tra poco.`
}

export async function loadCloudSnapshot(companyId: string, session: Pick<CloudAuthSession, 'accessToken'>, config: CloudAuthConfig, fetcher: typeof fetch = fetch): Promise<CloudSnapshot | null> {
  const query = new URLSearchParams({ company_id: `eq.${companyId}`, select: 'company_id,revision,payload,updated_at', limit: '1' })
  const response = await authenticatedCloudFetch(`${config.url}/rest/v1/erp_snapshots?${query}`, { headers: headers(session, config) }, session, config, fetcher)
  if (!response.ok) throw new Error(await responseMessage(response))
  const rows = await response.json() as CloudSnapshotRow[]
  if (!rows[0]) return null
  const snapshot=normalizeRow(rows[0])
  remember(archiveKey(companyId,session,config),snapshot)
  return snapshot
}

export async function createCloudSnapshot(companyId: string, data: ErpData, session: Pick<CloudAuthSession, 'accessToken' | 'userId'>, config: CloudAuthConfig, fetcher: typeof fetch = fetch): Promise<CloudSnapshot> {
  const response = await authenticatedCloudFetch(`${config.url}/rest/v1/erp_snapshots`, {
    method: 'POST',
    headers: { ...headers(session, config), Prefer: 'return=representation' },
    body: JSON.stringify({ company_id: companyId, revision: 1, payload: data, updated_by: session.userId }),
  }, session, config, fetcher)
  if (response.status === 409) throw new CloudSnapshotConflictError()
  if (!response.ok) throw new Error(await responseMessage(response))
  const rows = await response.json() as CloudSnapshotRow[]
  if (!rows[0]) throw new Error('Supabase non ha restituito lo snapshot creato.')
  const snapshot=normalizeRow(rows[0])
  remember(archiveKey(companyId,session,config),snapshot)
  return snapshot
}

export async function updateCloudSnapshot(companyId: string, expectedRevision: number, data: ErpData, session: Pick<CloudAuthSession, 'accessToken' | 'userId'>, config: CloudAuthConfig, fetcher: typeof fetch = fetch): Promise<CloudSnapshot> {
  const key=archiveKey(companyId,session,config)
  const baseline=acknowledged.get(key)
  const sent=structuredClone(data)
  const values=sent as unknown as Record<string,unknown>
  const base=baseline?.revision===expectedRevision ? baseline.payload as unknown as Record<string,unknown> : undefined
  const changes: Record<string,unknown>=Object.create(null)
  for (const field of Object.keys(values)) {
    if(values[field]!==undefined && (!base || !sameJson(values[field],base[field]))) changes[field]=values[field]
  }
  const removeKeys=base ? Object.keys(base).filter(field=>values[field]===undefined) : []
  const response=await authenticatedCloudFetch(`${config.url}/rest/v1/rpc/erp_update_snapshot_sections`,{
    method:'POST',headers:headers(session,config),
    body:JSON.stringify({p_company_id:companyId,p_expected_revision:expectedRevision,p_changes:changes,p_remove_keys:removeKeys}),
  }, session, config, fetcher)
  if (!response.ok) throw new Error(await responseMessage(response))
  const rows=await response.json() as CloudSnapshotRow[]
  if (!rows[0]) throw new CloudSnapshotConflictError()
  if(rows[0].company_id!==companyId || Number(rows[0].revision)!==expectedRevision+1) throw new Error('Conferma del salvataggio cloud non valida. I dati locali sono conservati.')
  const saved: CloudSnapshot={companyId,revision:expectedRevision+1,payload:sent,updatedAt:String(rows[0].updated_at??'')}
  remember(key,saved)
  return saved
}

const pendingKey = (companyId: string) => `body-shop-erp.pending-cloud-save.v1:${companyId}`
export function markPendingCloudSave(companyId: string): string {
  const token = crypto.randomUUID()
  localStorage.setItem(pendingKey(companyId), token)
  return token
}
export function pendingCloudSaveToken(companyId: string): string | null {
  return localStorage.getItem(pendingKey(companyId))
}
export function hasPendingCloudSave(companyId: string): boolean {
  return Boolean(pendingCloudSaveToken(companyId))
}
export function clearPendingCloudSave(companyId: string, token?: string) {
  if (!token || localStorage.getItem(pendingKey(companyId)) === token) localStorage.removeItem(pendingKey(companyId))
}
