import type { ErpData, RepairJob } from '../types'
import type { CloudAuthConfig, CloudAuthSession } from './cloudAuth'
import { quoteOperatorRate, quoteStructureRate } from './quoteHourBudget'

export interface LiveClock {
  jobId: string; plate: string; number: string; remainingSeconds: number | null;
  remainingPercent: number; activeCount: number; ownStatus: 'running' | 'paused' | 'finished' | null;
  operators: { name: string; status: string }[];
}
export interface LiveFeed {
  companyId: string; serverNow: string; role: 'owner' | 'office' | 'production';
  operatorName: string | null; jobs: LiveClock[];
  members: { userId: string; name: string; operatorId: string | null }[];
}

export async function refreshProductionSession(session: CloudAuthSession, config: CloudAuthConfig): Promise<CloudAuthSession> {
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refreshToken }), signal: AbortSignal.timeout(10000),
  })
  const result = await response.json()
  if (!response.ok || !result.access_token || result.user?.id !== session.userId) throw new Error('Accesso scaduto. Esci e accedi di nuovo; il timer sul server resta registrato.')
  return { ...session, accessToken: result.access_token, refreshToken: result.refresh_token ?? session.refreshToken, expiresIn: result.expires_in ?? 3600 }
}

/** A budget is approved once by the office and frozen when the first operator starts. */
export function prepareLiveJob(data: ErpData, job: RepairJob) {
  if (['Consegnata', 'Annullata'].includes(job.status)) throw new Error('La commessa è chiusa.')
  const structure = quoteStructureRate(data.plannerSettings)
  if (structure.error) throw new Error(structure.error)
  const operators = data.plannerSettings.operators.filter(o => o.active).map(o => {
    const cost = quoteOperatorRate(data.plannerSettings, o.id)
    if (cost.error) throw new Error(cost.error)
    return { id: o.id, name: o.name, rate: structure.rate + cost.rate }
  })
  if (!operators.length) throw new Error('Configura almeno un operatore attivo.')
  const percent = Math.min(100, Math.max(0, data.plannerSettings.internalCostSettings?.budgetMaterialsPercent ?? 20))
  const materials = job.lines.filter(l => ['carrozzeria', 'verniciatura', 'meccanica'].includes(l.category))
    .reduce((sum, l) => sum + Math.max(0, l.quantity * l.unitPrice - l.discount) * percent / 100, 0)
  const direct = job.lines.filter(l => ['ricambi', 'servizi esterni', 'altre'].includes(l.category))
  // Never mistake a planned labour amount for a parts/external purchase cost.
  if (direct.some(l => l.quantity > 0 && l.unitPrice > 0 && l.budgetDirectUnitCost === undefined)) {
    throw new Error('La commessa contiene costi diretti non conservati nel preventivo. Rigenera le righe dal preventivo con i costi interni compilati prima di attivare il timer.')
  }
  const directCosts = direct.reduce((sum, l) => sum + Math.max(0, l.quantity) * Math.max(0, l.budgetDirectUnitCost ?? 0), 0)
  const budget = Math.round((job.taxableAmount - materials - directCosts) * 100) / 100
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('Il preventivo non lascia un budget positivo per il lavoro.')
  return { budget, materials, directCosts, revenue: job.taxableAmount, operators }
}

/** Interpolate only a recent authoritative sample; never trust the tablet's wall clock. */
export function liveCountdown(clock: LiveClock, elapsedSeconds: number) {
  const elapsed = Math.max(0, elapsedSeconds)
  const seconds = clock.remainingSeconds === null ? null : Math.max(0, clock.remainingSeconds - (clock.activeCount > 0 ? elapsed : 0))
  const percent = clock.activeCount > 0 && clock.remainingSeconds && clock.remainingSeconds > 0
    ? Math.max(0, clock.remainingPercent * (seconds ?? 0) / clock.remainingSeconds) : clock.remainingPercent
  return { seconds, percent, warning: percent <= 20, exhausted: percent <= 0 }
}

export async function productionRpc<T>(name: string, body: Record<string, unknown>, session: CloudAuthSession,
  config: CloudAuthConfig, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.anonKey, Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  })
  const payload = await response.json()
  if (!response.ok) {
    if (response.status === 401) throw new Error('Accesso scaduto. Esci e accedi di nuovo; il tempo già avviato resta registrato.')
    if (payload?.code === 'PGRST202') throw new Error('La produzione condivisa deve essere attivata su Supabase prima di usare i tablet.')
    throw new Error(payload?.message || 'Collegamento non riuscito. Il timer sul server continua finché non viene messo in pausa.')
  }
  return payload as T
}
