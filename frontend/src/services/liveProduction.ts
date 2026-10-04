import type { ErpData, RepairJob } from '../types'
import type { CloudAuthConfig, CloudAuthSession } from './cloudAuth'
import { quoteOperatorRate, quoteStructureRate } from './quoteHourBudget'

export interface LiveClock {
  jobId: string; plate: string; number: string; remainingSeconds: number | null;
  remainingPercent: number; activeCount: number; ownStatus: 'running' | 'paused' | 'finished' | null;
  operators: { name: string; status: string }[];
  ownRemainingSeconds?: number | null; ownBurnFactor?: number; ownPhaseId?: string | null;
  phases?: LivePhase[];
  tasks?: { id: string; description: string; panel?: string; quantity: number }[];
}
export interface LivePhase { id: string; name: string; status: string; notRequired: boolean; checkedBy: string | null; checkedAt: string | null; canComplete: boolean; blockedReason?: string }
export interface HoursDay { date: string; workedSeconds: number; plannedSeconds: number | null; ordinarySeconds: number | null; extraSeconds: number | null; running: boolean }
export interface HoursReport {
  operatorId: string; name: string; serverNow: string; from: string; to: string; days: HoursDay[];
  workedSeconds: number; ordinarySeconds: number | null; extraSeconds: number | null; unconfigured: boolean;
}
export interface LiveFeed {
  companyId: string; serverNow: string; role: 'owner' | 'office' | 'production';
  operatorName: string | null; jobs: LiveClock[];
  members: { userId: string; name: string; operatorId: string | null }[];
  today?: HoursReport | null;
  staff?: { operatorId: string; name: string; today: HoursReport }[];
  program?: { id: string; jobId: string; plate: string; phaseId: string; phaseName: string; startAt: string; endAt: string; ready: boolean; panels: string[] }[];
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
  // Materiali aggiunti manualmente hanno un costo conservato nella riga.
  // Le vecchie righe di consumo automatiche non rappresentano un acquisto extra.
  const direct = job.lines.filter(l => ['ricambi', 'servizi esterni', 'altre'].includes(l.category)
    || (l.category === 'materiali' && l.budgetDirectUnitCost !== undefined))
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
  const individualSeconds = clock.ownRemainingSeconds === undefined ? seconds : clock.ownRemainingSeconds === null ? null
    : Math.max(0, clock.ownRemainingSeconds - elapsed * (clock.ownBurnFactor ?? 0))
  return { seconds, individualSeconds, percent, warning: percent <= 20, exhausted: percent <= 0 }
}

/** Productive time only: one running segment per operator, pauses excluded. */
export function interpolateHours(report: HoursReport, elapsedSeconds: number) {
  const elapsed = Math.max(0, elapsedSeconds)
  const days = report.days.map(day => {
    const workedSeconds = day.workedSeconds + (day.running ? elapsed : 0)
    return { ...day, workedSeconds, ordinarySeconds: day.plannedSeconds === null ? null : Math.min(workedSeconds, day.plannedSeconds),
      extraSeconds: day.plannedSeconds === null ? null : Math.max(0, workedSeconds - day.plannedSeconds) }
  })
  const unconfigured = days.some(d => d.plannedSeconds === null && d.workedSeconds > 0)
  return { ...report, days, workedSeconds: days.reduce((sum, d) => sum + d.workedSeconds, 0), unconfigured,
    ordinarySeconds: unconfigured ? null : days.reduce((sum, d) => sum + (d.ordinarySeconds ?? 0), 0),
    extraSeconds: unconfigured ? null : days.reduce((sum, d) => sum + (d.extraSeconds ?? 0), 0) }
}

export interface PhaseCheckUpdate { jobId: string; phaseId: string; checkedBy: string; checkedAt: string; workedSeconds: number }
/** Import canonical signatures without letting an old office snapshot erase them. */
export function applyLivePhaseChecks(data: ErpData, checks: PhaseCheckUpdate[]): ErpData {
  let changed = false
  const jobs = (data.jobs ?? []).map(job => {
    let jobChanged = false
    const history = [...job.history]
    const phases = job.phases.map(phase => {
      const check = checks.find(c => c.jobId === job.id && c.phaseId === phase.id)
      if (!check || !check.checkedBy || !Number.isFinite(Date.parse(check.checkedAt))) return phase
      if (phase.status === 'Completata' && phase.completedByName === check.checkedBy && phase.completedAt === check.checkedAt && phase.tabletWorkedSeconds === check.workedSeconds) return phase
      changed = true; jobChanged = true
      const historyId = `tablet:${job.id}:${phase.id}:${check.checkedAt}`
      if (!history.some(h => h.id === historyId)) history.unshift({ id: historyId, at: check.checkedAt, actor: check.checkedBy, message: `Fase ${phase.name} completata da tablet.` })
      return { ...phase, status: 'Completata' as const, completedByName: check.checkedBy, completedAt: check.checkedAt,
        endedAt: check.checkedAt, tabletWorkedSeconds: check.workedSeconds }
    })
    return jobChanged ? { ...job, phases, history } : job
  })
  return changed ? { ...data, jobs } : data
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
