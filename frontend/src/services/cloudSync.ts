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

async function responseMessage(response: Response) {
  try {
    const payload = await response.json() as { message?: string }
    return payload.message || `Errore cloud (${response.status}).`
  } catch {
    return `Errore cloud (${response.status}).`
  }
}

export async function loadCloudSnapshot(companyId: string, session: Pick<CloudAuthSession, 'accessToken'>, config: CloudAuthConfig, fetcher: typeof fetch = fetch): Promise<CloudSnapshot | null> {
  const query = new URLSearchParams({ company_id: `eq.${companyId}`, select: 'company_id,revision,payload,updated_at', limit: '1' })
  const response = await fetcher(`${config.url}/rest/v1/erp_snapshots?${query}`, { headers: headers(session, config) })
  if (!response.ok) throw new Error(await responseMessage(response))
  const rows = await response.json() as CloudSnapshotRow[]
  return rows[0] ? normalizeRow(rows[0]) : null
}

export async function createCloudSnapshot(companyId: string, data: ErpData, session: Pick<CloudAuthSession, 'accessToken' | 'userId'>, config: CloudAuthConfig, fetcher: typeof fetch = fetch): Promise<CloudSnapshot> {
  const response = await fetcher(`${config.url}/rest/v1/erp_snapshots`, {
    method: 'POST',
    headers: { ...headers(session, config), Prefer: 'return=representation' },
    body: JSON.stringify({ company_id: companyId, revision: 1, payload: data, updated_by: session.userId }),
  })
  if (response.status === 409) throw new CloudSnapshotConflictError()
  if (!response.ok) throw new Error(await responseMessage(response))
  const rows = await response.json() as CloudSnapshotRow[]
  if (!rows[0]) throw new Error('Supabase non ha restituito lo snapshot creato.')
  return normalizeRow(rows[0])
}

export async function updateCloudSnapshot(companyId: string, expectedRevision: number, data: ErpData, session: Pick<CloudAuthSession, 'accessToken' | 'userId'>, config: CloudAuthConfig, fetcher: typeof fetch = fetch): Promise<CloudSnapshot> {
  const query = new URLSearchParams({ company_id: `eq.${companyId}`, revision: `eq.${expectedRevision}` })
  const response = await fetcher(`${config.url}/rest/v1/erp_snapshots?${query}`, {
    method: 'PATCH',
    headers: { ...headers(session, config), Prefer: 'return=representation' },
    body: JSON.stringify({ revision: expectedRevision + 1, payload: data, updated_by: session.userId, updated_at: new Date().toISOString() }),
  })
  if (!response.ok) throw new Error(await responseMessage(response))
  const rows = await response.json() as CloudSnapshotRow[]
  if (!rows[0]) throw new CloudSnapshotConflictError()
  return normalizeRow(rows[0])
}
