import type { ErpData } from '../types'
import { buildIntegritySnapshot } from './database'

export const BACKUP_FORMAT = 'body-shop-erp-backup'
export const BACKUP_VERSION = 1

export interface ErpBackupEnvelope {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  createdAt: string
  appOrigin: string
  revision: number
  summary: ReturnType<typeof buildIntegritySnapshot>
  data: ErpData
}

export function createBackupEnvelope(data: ErpData, createdAt = new Date().toISOString(), appOrigin = globalThis.location?.origin ?? 'unknown'): ErpBackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    appOrigin,
    revision: Math.max(0, Number(data.dbRevision ?? 0)),
    summary: buildIntegritySnapshot(data),
    data,
  }
}

export function serializeBackup(data: ErpData, createdAt?: string, appOrigin?: string) {
  return JSON.stringify(createBackupEnvelope(data, createdAt, appOrigin), null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseBackup(raw: string): ErpBackupEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Il file selezionato non contiene un JSON valido.')
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || parsed.version !== BACKUP_VERSION) {
    throw new Error('Il file non è un backup compatibile di Body Shop ERP.')
  }
  const data = parsed.data
  if (!isRecord(data)
    || !Array.isArray(data.customers)
    || !Array.isArray(data.vehicles)
    || !Array.isArray(data.coneHistory)
    || !isRecord(data.plannerSettings)
    || !Array.isArray(data.plannerAssignments)
    || !Array.isArray(data.invoices)
    || !Array.isArray(data.bankAccounts)
    || !Array.isArray(data.ribaBatches)
    || !Array.isArray(data.financialEvents)
    || !isRecord(data.financeSettings)) {
    throw new Error('Il backup è incompleto o danneggiato: archivio non ripristinato.')
  }
  const envelope = parsed as unknown as ErpBackupEnvelope
  const actualSummary = buildIntegritySnapshot(envelope.data)
  if (!isRecord(parsed.summary)
    || actualSummary.customers !== parsed.summary.customers
    || actualSummary.vehicles !== parsed.summary.vehicles
    || actualSummary.estimates !== parsed.summary.estimates
    || actualSummary.jobs !== parsed.summary.jobs) {
    throw new Error('Il riepilogo del backup non corrisponde ai dati: archivio non ripristinato.')
  }
  return envelope
}

export function backupFilename(createdAt = new Date().toISOString()) {
  return `body-shop-erp-backup-${createdAt.slice(0, 10)}-${createdAt.slice(11, 19).replaceAll(':', '-')}.json`
}
