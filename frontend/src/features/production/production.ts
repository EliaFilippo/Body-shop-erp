import type {
  ErpData,
  ProductionJobState,
  ProductionModule,
  ProductionOperatorIdentity,
  ProductionPhase,
  ProductionReport,
  ProductionReportType,
  ProductionWorkLog,
  Vehicle,
  VehicleStatus,
} from '../../types'

const DAY_MS = 86_400_000

export const PRODUCTION_PHASES: ProductionPhase[] = [
  'Da iniziare',
  'Smontaggio',
  'Lattoneria',
  'Preparazione',
  'Verniciatura',
  'Rimontaggio',
  'Lucidatura',
  'Lavaggio/Controllo',
  'Pronta',
]

export const PRODUCTION_REPORT_TYPES: ProductionReportType[] = [
  'ricambio mancante',
  'problema tecnico',
  'lavorazione aggiuntiva',
  'danno non previsto',
  'richiesta all\'ufficio',
  'altro',
]

const nowIso = () => new Date().toISOString()
const todayKey = () => new Date().toISOString().slice(0, 10)

const roundMinutes = (value: number) => Math.max(0, Math.round(value))

const elapsedMinutes = (fromIso: string, toIso: string) => {
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0
  return roundMinutes((to - from) / 60_000)
}

const makeId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 11)}`
const DEFAULT_PRODUCTION_IDENTITY: ProductionOperatorIdentity = {
  role: 'production',
  operatorId: 'tablet-operator',
  operatorName: 'Operatore Produzione',
}

export interface PhaseMoveInput {
  vehicleId: string
  nextPhase: ProductionPhase
  operator: ProductionOperatorIdentity
  note?: string
}

export interface TimerInput {
  vehicleId: string
  phase: ProductionPhase
  operator: ProductionOperatorIdentity
}

export interface ReportInput {
  vehicleId: string
  type: ProductionReportType
  note: string
  operator: ProductionOperatorIdentity
  photoDataUrl?: string
}

export interface TodayInShopSnapshot {
  phaseCards: Array<{ phase: ProductionPhase; jobs: ProductionJobState[] }>
  alertsOpen: number
  byPriority: { urgente: number; alta: number; normale: number }
  activeTimers: number
  dueToday: number
  overdue: number
}

function ensureProduction(data: ErpData): ProductionModule {
  if (data.production) return data.production
  return {
    jobs: [],
    phaseHistory: [],
    workLogs: [],
    reports: [],
    identities: [DEFAULT_PRODUCTION_IDENTITY],
  }
}

const phaseTrackingMetric = (data: ErpData) => data.plannerSettings.phaseTrackingMetric === 'man-hours' ? 'man-hours' : 'calendar'

const workflowPhaseNamesByProductionPhase = (phase: ProductionPhase) => {
  if (phase === 'Da iniziare') return ['Smontaggio']
  if (phase === 'Lavaggio/Controllo') return ['Lavaggio', 'Controllo qualità']
  return [phase]
}

const humanMinutes = (value: number) => Math.max(0, Math.round(value))

function unique(list: string[]) {
  return Array.from(new Set(list.map((item) => item.trim()).filter(Boolean)))
}

function sumManWorkedMinutes(phase: JobPhase, atIso: string) {
  return phase.operatorAssignments.reduce((sum, item) => {
    if (item.endedAt) return sum + Math.max(item.workedMinutes, elapsedMinutes(item.startedAt, item.endedAt))
    if (item.activityStatus === 'Attivo') return sum + Math.max(item.workedMinutes, elapsedMinutes(item.startedAt, atIso))
    return sum + Math.max(0, item.workedMinutes)
  }, 0)
}

function calendarWorkedMinutes(phase: JobPhase, atIso: string) {
  const starts = phase.operatorAssignments.map((item) => item.startedAt).filter(Boolean).sort()
  const phaseStart = starts[0] || phase.startedAt
  if (!phaseStart) return Math.max(0, phase.actualMinutes)
  const phaseEnd = phase.status === 'Completata' ? (phase.endedAt || atIso) : atIso
  return Math.max(Math.max(0, phase.actualMinutes), elapsedMinutes(phaseStart, phaseEnd))
}

function findWorkflowJob(data: ErpData, vehicleId: string) {
  return (data.jobs ?? []).find((job) => job.vehicleId === vehicleId && job.status !== 'Annullata') ?? null
}

function findTrackedPhase(job: RepairJob, productionPhase: ProductionPhase) {
  const active = job.phases.find((phase) => phase.status === 'In lavorazione')
  if (active) return active
  const names = workflowPhaseNamesByProductionPhase(productionPhase)
  return job.phases.find((phase) => names.includes(phase.name))
    || job.phases.find((phase) => phase.status === 'Da fare' && !phase.notRequired)
    || job.phases.find((phase) => phase.status === 'Completata')
    || null
}

function operatorsInPhase(phase: JobPhase) {
  const active = unique((phase.operatorAssignments ?? [])
    .filter((item) => item.activityStatus === 'Attivo' && !item.endedAt)
    .map((item) => item.operatorName))
  if (active.length) return active
  return unique((phase.operatorAssignments ?? []).map((item) => item.operatorName))
}

function paceLevel(consumedPercent: number): ProductionPaceLevel {
  if (consumedPercent > 100) return 'IN RITARDO'
  if (consumedPercent >= 80) return 'A RISCHIO'
  return 'IN ORARIO'
}

function createPaceHistoryEntry(input: Omit<ProductionPaceHistoryEntry, 'id'>): ProductionPaceHistoryEntry {
  return { id: makeId('pace'), ...input }
}

function samePaceStateSemantics(previous: ProductionPaceState, next: ProductionPaceState) {
  if (previous.id !== next.id) return false
  if (previous.vehicleId !== next.vehicleId) return false
  if (previous.jobId !== next.jobId) return false
  if (previous.phaseId !== next.phaseId) return false
  if (previous.phaseName !== next.phaseName) return false
  if (previous.metric !== next.metric) return false
  if (previous.estimatedMinutes !== next.estimatedMinutes) return false
  if (previous.workedMinutes !== next.workedMinutes) return false
  if (previous.residualMinutes !== next.residualMinutes) return false
  if (previous.consumedPercent !== next.consumedPercent) return false
  if (previous.level !== next.level) return false
  if ((previous.preAlertAt ?? '') !== (next.preAlertAt ?? '')) return false
  if ((previous.delayedAt ?? '') !== (next.delayedAt ?? '')) return false
  if ((previous.finalDelayMinutes ?? null) !== (next.finalDelayMinutes ?? null)) return false
  if (previous.operators.length !== next.operators.length) return false
  for (let index = 0; index < previous.operators.length; index += 1) {
    if (previous.operators[index] !== next.operators[index]) return false
  }
  return true
}

function buildPaceState(data: ErpData, productionJob: ProductionJobState, atIso: string): ProductionPaceState | null {
  const workflowJob = findWorkflowJob(data, productionJob.vehicleId)
  if (!workflowJob) return null
  const phase = findTrackedPhase(workflowJob, productionJob.phase)
  if (!phase || phase.notRequired) return null
  const estimatedMinutes = Math.max(15, Number(phase.estimatedMinutes) || 15)
  const metric = phaseTrackingMetric(data)
  const workedMinutes = metric === 'man-hours'
    ? humanMinutes(sumManWorkedMinutes(phase, atIso))
    : humanMinutes(calendarWorkedMinutes(phase, atIso))
  const consumedPercent = Math.max(0, Math.round((workedMinutes / estimatedMinutes) * 100))
  return {
    id: `${workflowJob.id}:${phase.id}`,
    vehicleId: productionJob.vehicleId,
    jobId: workflowJob.id,
    phaseId: phase.id,
    phaseName: phase.name,
    metric,
    estimatedMinutes,
    workedMinutes,
    residualMinutes: Math.max(0, estimatedMinutes - workedMinutes),
    consumedPercent,
    level: paceLevel(consumedPercent),
    operators: operatorsInPhase(phase),
    updatedAt: atIso,
  }
}

function operatorCompatibleWithPhase(data: ErpData, operatorName: string, phaseName: string) {
  const operator = data.plannerSettings.operators.find((item) => item.name.trim().toLowerCase() === operatorName.trim().toLowerCase())
  if (!operator) return false
  const skills = (operator.skills ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean)
  if (!skills.length) return true
  return skills.some((item) => phaseName.toLowerCase().includes(item))
}

function findSupportOperator(data: ErpData, state: ProductionPaceState, atIso: string) {
  const assigned = state.operators.map((item) => item.toLowerCase())
  const candidates = data.plannerSettings.operators
    .filter((operator) => operator.active)
    .filter((operator) => !assigned.includes(operator.name.trim().toLowerCase()))
    .filter((operator) => operatorCompatibleWithPhase(data, operator.name, state.phaseName))
  if (!candidates.length) return { operatorName: '', skippedReason: 'Nessun operatore compatibile disponibile.' }
  for (const operator of candidates) {
    const nextTask = nextTaskForOperator(data, operator.id, atIso)
    if (!nextTask) return { operatorName: operator.name, skippedReason: '' }
    const startsSoon = elapsedMinutes(atIso, nextTask.startAt) <= 90
    const protectsUrgent = nextTask.priority === 'Urgente' && nextTask.jobId !== state.jobId
    if (protectsUrgent || startsSoon) continue
    return { operatorName: operator.name, skippedReason: '' }
  }
  return { operatorName: '', skippedReason: 'Riassegnazione evitata per non aggravare altre urgenze.' }
}

export function paceStateByVehicle(data: ErpData, vehicleId: string, atIso = nowIso()) {
  const production = ensureProduction(data)
  const current = production.jobs.find((job) => job.vehicleId === vehicleId)
  if (!current) return null
  const computed = buildPaceState(data, current, atIso)
  if (computed) {
    const persisted = (production.paceStates ?? []).find((item) => item.id === computed.id)
    return persisted ? { ...computed, preAlertAt: persisted.preAlertAt, delayedAt: persisted.delayedAt, finalDelayMinutes: persisted.finalDelayMinutes } : computed
  }
  return null
}

export function runProductionDelayControl(data: ErpData, reason = 'Controllo tempi tablet', atIso = nowIso()): ErpData {
  const production = ensureProduction(data)
  let nextData = data
  let paceStates = [...(production.paceStates ?? [])]
  let paceHistory = [...(production.paceHistory ?? [])]
  let shouldRecalculatePlanner = false
  const touched = new Set<string>()

  for (const productionJob of production.jobs) {
    const nextState = buildPaceState(nextData, productionJob, atIso)
    if (!nextState) continue
    touched.add(nextState.id)
    const previous = paceStates.find((item) => item.id === nextState.id)
    const merged: ProductionPaceState = {
      ...previous,
      ...nextState,
    }

    if (!previous?.preAlertAt && nextState.level === 'A RISCHIO') {
      merged.preAlertAt = atIso
      paceHistory = [createPaceHistoryEntry({
        at: atIso,
        event: 'pre-alert',
        message: `Pre-allerta: consumato ${nextState.consumedPercent}% del previsto in ${nextState.phaseName}.`,
        operators: nextState.operators,
        vehicleId: nextState.vehicleId,
        jobId: nextState.jobId,
        phaseId: nextState.phaseId,
        phaseName: nextState.phaseName,
      }), ...paceHistory]
    }

    if (!previous?.delayedAt && nextState.level === 'IN RITARDO') {
      merged.delayedAt = atIso
      shouldRecalculatePlanner = true
      const delayMinutes = Math.max(0, nextState.workedMinutes - nextState.estimatedMinutes)
      const delayedJob = findWorkflowJob(nextData, nextState.vehicleId)
      const impact = delayedJob?.expectedDeliveryDate
        ? delayedJob.expectedDeliveryDate < todayKey()
          ? 'Impatto consegna: vettura gia oltre la data promessa.'
          : delayedJob.expectedDeliveryDate === todayKey()
            ? 'Impatto consegna: rischio ritardo su consegna odierna.'
            : 'Impatto consegna: monitorare scadenza promessa.'
        : 'Impatto consegna: data promessa non definita.'
      paceHistory = [createPaceHistoryEntry({
        at: atIso,
        event: 'delay-start',
        message: `Fase in ritardo: +${delayMinutes} min (${nextState.phaseName}). ${impact}`,
        delayMinutes,
        operators: nextState.operators,
        vehicleId: nextState.vehicleId,
        jobId: nextState.jobId,
        phaseId: nextState.phaseId,
        phaseName: nextState.phaseName,
      }), ...paceHistory]

      const workflowJob = findWorkflowJob(nextData, nextState.vehicleId)
      const phase = workflowJob?.phases.find((item) => item.id === nextState.phaseId)
      if (workflowJob && phase) {
        const support = findSupportOperator(nextData, nextState, atIso)
        if (support.operatorName) {
          const activeNames = operatorsInPhase(phase)
          nextData = updateJobPhaseOperators(nextData, workflowJob.id, phase.id, [...activeNames, support.operatorName], atIso)
          paceHistory = [createPaceHistoryEntry({
            at: atIso,
            event: 'auto-support-assigned',
            message: `Supporto automatico assegnato: ${support.operatorName}.`,
            operators: [...nextState.operators, support.operatorName],
            vehicleId: nextState.vehicleId,
            jobId: nextState.jobId,
            phaseId: nextState.phaseId,
            phaseName: nextState.phaseName,
          }), ...paceHistory]
        } else {
          paceHistory = [createPaceHistoryEntry({
            at: atIso,
            event: 'auto-support-skipped',
            message: support.skippedReason,
            operators: nextState.operators,
            vehicleId: nextState.vehicleId,
            jobId: nextState.jobId,
            phaseId: nextState.phaseId,
            phaseName: nextState.phaseName,
          }), ...paceHistory]
        }
      }
    }

    const workflowJob = findWorkflowJob(nextData, nextState.vehicleId)
    const workflowPhase = workflowJob?.phases.find((item) => item.id === nextState.phaseId)
    if (workflowPhase?.status === 'Completata' && merged.delayedAt && merged.finalDelayMinutes == null) {
      const finalDelayMinutes = Math.max(0, nextState.workedMinutes - nextState.estimatedMinutes)
      merged.finalDelayMinutes = finalDelayMinutes
      paceHistory = [createPaceHistoryEntry({
        at: atIso,
        event: 'delay-final',
        message: `Ritardo finale fase: +${finalDelayMinutes} min.`,
        delayMinutes: finalDelayMinutes,
        operators: nextState.operators,
        vehicleId: nextState.vehicleId,
        jobId: nextState.jobId,
        phaseId: nextState.phaseId,
        phaseName: nextState.phaseName,
      }), ...paceHistory]
    }

    if (previous && samePaceStateSemantics(previous, merged)) {
      paceStates = [previous, ...paceStates.filter((item) => item.id !== previous.id)]
      continue
    }

    paceStates = [merged, ...paceStates.filter((item) => item.id !== merged.id)]
  }

  paceStates = paceStates.filter((item) => touched.has(item.id) || item.finalDelayMinutes != null)

  let finalData: ErpData = {
    ...nextData,
    production: {
      ...ensureProduction(nextData),
      paceStates,
      paceHistory: paceHistory.slice(0, 400),
    },
  }

  if (shouldRecalculatePlanner) {
    finalData = recalculateOperatorPrograms(finalData, plannerTodayKey(), reason)
    const latest = paceStates.find((item) => item.level === 'IN RITARDO')
    if (latest) {
      finalData = {
        ...finalData,
        production: {
          ...ensureProduction(finalData),
          paceHistory: [createPaceHistoryEntry({
            at: atIso,
            event: 'planner-recalculation',
            message: `Planner ricalcolato per ritardo su ${latest.phaseName}.`,
            operators: latest.operators,
            vehicleId: latest.vehicleId,
            jobId: latest.jobId,
            phaseId: latest.phaseId,
            phaseName: latest.phaseName,
          }), ...ensureProduction(finalData).paceHistory].slice(0, 400),
        },
      }
    }
  }

  return finalData
}

function vehicleToJob(vehicle: Vehicle): ProductionJobState {
  const mappedPhase = vehicle.status.toLowerCase() === 'pronta'
    ? 'Pronta'
    : vehicle.status.toLowerCase() === 'in lavorazione'
      ? 'Preparazione'
      : 'Da iniziare'
  return {
    vehicleId: vehicle.id,
    phase: mappedPhase,
    priority: vehicle.priority ?? 'Normale',
    assignedWorks: [],
    operationalNotes: vehicle.blockReason || '',
    promisedAt: vehicle.requestedDeliveryDate || '',
    updatedAt: vehicle.createdAt,
  }
}

export function syncProductionJobsFromVehicles(data: ErpData): ErpData {
  const production = ensureProduction(data)
  const jobByVehicle = new Map(production.jobs.map((job) => [job.vehicleId, job]))
  const activeVehicleIds = new Set(data.vehicles.filter((vehicle) => vehicle.status !== 'consegnata').map((vehicle) => vehicle.id))
  const mergedJobs = data.vehicles
    .filter((vehicle) => vehicle.status !== 'consegnata')
    .map((vehicle) => {
      const existing = jobByVehicle.get(vehicle.id)
      const base = vehicleToJob(vehicle)
      return existing
        ? {
            ...existing,
            priority: vehicle.priority ?? existing.priority,
            promisedAt: vehicle.requestedDeliveryDate || existing.promisedAt,
            updatedAt: existing.updatedAt || base.updatedAt,
          }
        : base
    })
  const filteredLogs = production.workLogs.filter((log) => activeVehicleIds.has(log.vehicleId))
  const filteredReports = production.reports.filter((report) => activeVehicleIds.has(report.vehicleId))
  const filteredHistory = production.phaseHistory.filter((entry) => activeVehicleIds.has(entry.vehicleId))
  return {
    ...data,
    production: {
      ...production,
      jobs: mergedJobs,
      workLogs: filteredLogs,
      reports: filteredReports,
      phaseHistory: filteredHistory,
    },
  }
}

function phaseIndex(phase: ProductionPhase) {
  return PRODUCTION_PHASES.indexOf(phase)
}

export function moveProductionPhase(data: ErpData, input: PhaseMoveInput): ErpData {
  const production = ensureProduction(data)
  const current = production.jobs.find((job) => job.vehicleId === input.vehicleId)
  if (!current) throw new Error('Pratica non trovata in produzione.')
  if (current.phase === input.nextPhase) return data

  const currentIndex = phaseIndex(current.phase)
  const nextIndex = phaseIndex(input.nextPhase)
  if (nextIndex < 0 || currentIndex < 0) throw new Error('Fase non valida.')
  if (nextIndex > currentIndex + 1) throw new Error('Puoi avanzare solo alla fase successiva.')

  const timestamp = nowIso()
  const updatedJobs = production.jobs.map((job) =>
    job.vehicleId === input.vehicleId
      ? {
          ...job,
          phase: input.nextPhase,
          updatedAt: timestamp,
        }
      : job,
  )

  const updatedVehicles = data.vehicles.map((vehicle) => {
    if (vehicle.id !== input.vehicleId) return vehicle
    const status: VehicleStatus = input.nextPhase === 'Pronta' ? 'pronta' : 'in lavorazione'
    return { ...vehicle, status }
  })

  const historyEntry = {
    id: makeId('phase'),
    vehicleId: input.vehicleId,
    operatorId: input.operator.operatorId,
    operatorName: input.operator.operatorName,
    previousPhase: current.phase,
    nextPhase: input.nextPhase,
    createdAt: timestamp,
    note: input.note?.trim() || '',
  }

  return {
    ...data,
    vehicles: updatedVehicles,
    production: {
      ...production,
      jobs: updatedJobs,
      phaseHistory: [historyEntry, ...production.phaseHistory],
    },
  }
}

function updateOpenLog(log: ProductionWorkLog, toStatus: 'paused' | 'completed', timestamp: string): ProductionWorkLog {
  const anchor = log.lastResumedAt || log.startedAt
  const spent = elapsedMinutes(anchor, timestamp)
  return {
    ...log,
    totalMinutes: roundMinutes(log.totalMinutes + spent),
    pausedAt: toStatus === 'paused' ? timestamp : log.pausedAt,
    endedAt: toStatus === 'completed' ? timestamp : log.endedAt,
    lastResumedAt: toStatus === 'completed' ? undefined : log.lastResumedAt,
    status: toStatus,
  }
}

export function startProductionTimer(data: ErpData, input: TimerInput): ErpData {
  const production = ensureProduction(data)
  const running = production.workLogs.find((log) =>
    log.vehicleId === input.vehicleId
    && log.phase === input.phase
    && log.operatorId === input.operator.operatorId
    && log.status === 'running',
  )
  if (running) return data
  const timestamp = nowIso()
  const nextLog: ProductionWorkLog = {
    id: makeId('timer'),
    vehicleId: input.vehicleId,
    phase: input.phase,
    operatorId: input.operator.operatorId,
    operatorName: input.operator.operatorName,
    startedAt: timestamp,
    lastResumedAt: timestamp,
    totalMinutes: 0,
    status: 'running',
  }
  return {
    ...data,
    production: {
      ...production,
      workLogs: [nextLog, ...production.workLogs],
    },
  }
}

export function pauseProductionTimer(data: ErpData, logId: string): ErpData {
  const production = ensureProduction(data)
  const timestamp = nowIso()
  return {
    ...data,
    production: {
      ...production,
      workLogs: production.workLogs.map((log) =>
        log.id === logId && log.status === 'running'
          ? updateOpenLog(log, 'paused', timestamp)
          : log,
      ),
    },
  }
}

export function resumeProductionTimer(data: ErpData, logId: string): ErpData {
  const production = ensureProduction(data)
  const timestamp = nowIso()
  return {
    ...data,
    production: {
      ...production,
      workLogs: production.workLogs.map((log) =>
        log.id === logId && log.status === 'paused'
          ? {
              ...log,
              status: 'running',
              lastResumedAt: timestamp,
              pausedAt: undefined,
            }
          : log,
      ),
    },
  }
}

export function stopProductionTimer(data: ErpData, logId: string): ErpData {
  const production = ensureProduction(data)
  const timestamp = nowIso()
  return {
    ...data,
    production: {
      ...production,
      workLogs: production.workLogs.map((log) =>
        log.id === logId && (log.status === 'running' || log.status === 'paused')
          ? updateOpenLog(log, 'completed', timestamp)
          : log,
      ),
    },
  }
}

export function reportProductionIssue(data: ErpData, input: ReportInput): ErpData {
  const production = ensureProduction(data)
  const note = input.note.trim()
  if (!note) throw new Error('Inserisci una nota per la segnalazione.')
  const report: ProductionReport = {
    id: makeId('report'),
    vehicleId: input.vehicleId,
    type: input.type,
    note,
    photoDataUrl: input.photoDataUrl,
    operatorId: input.operator.operatorId,
    operatorName: input.operator.operatorName,
    createdAt: nowIso(),
  }
  return {
    ...data,
    production: {
      ...production,
      reports: [report, ...production.reports],
    },
  }
}

export function resolveProductionReport(data: ErpData, reportId: string): ErpData {
  const production = ensureProduction(data)
  const resolvedAt = nowIso()
  return {
    ...data,
    production: {
      ...production,
      reports: production.reports.map((report) =>
        report.id === reportId ? { ...report, resolvedAt } : report,
      ),
    },
  }
}

export function openProductionReports(data: ErpData) {
  const production = ensureProduction(data)
  return production.reports.filter((report) => !report.resolvedAt)
}

export function nextProductionPhase(phase: ProductionPhase): ProductionPhase | null {
  const index = PRODUCTION_PHASES.indexOf(phase)
  if (index < 0 || index >= PRODUCTION_PHASES.length - 1) return null
  return PRODUCTION_PHASES[index + 1]
}

export function activeWorkLogForVehicle(data: ErpData, vehicleId: string) {
  const production = ensureProduction(data)
  return production.workLogs
    .filter((log) => log.vehicleId === vehicleId && (log.status === 'running' || log.status === 'paused'))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
}

export function signalVehicleBlock(
  data: ErpData,
  vehicleId: string,
  type: ProductionReportType,
  note: string,
  operator: ProductionOperatorIdentity,
) {
  const withReport = reportProductionIssue(data, {
    vehicleId,
    type,
    note,
    operator,
  })
  return {
    ...withReport,
    vehicles: withReport.vehicles.map((vehicle) => {
      if (vehicle.id !== vehicleId) return vehicle
      return {
        ...vehicle,
        blockReason: note,
        partsStatus: type === 'ricambio mancante' ? 'Mancanti' : vehicle.partsStatus,
      }
    }),
  }
}

export function resolveVehicleBlock(data: ErpData, reportId: string) {
  const report = openProductionReports(data).find((item) => item.id === reportId)
  if (!report) return data
  const resolved = resolveProductionReport(data, reportId)
  const remainingForVehicle = openProductionReports(resolved).filter((item) => item.vehicleId === report.vehicleId)
  if (remainingForVehicle.length) return resolved
  return {
    ...resolved,
    vehicles: resolved.vehicles.map((vehicle) => {
      if (vehicle.id !== report.vehicleId) return vehicle
      return {
        ...vehicle,
        blockReason: '',
        partsStatus: vehicle.partsStatus === 'Mancanti' ? 'Disponibili' : vehicle.partsStatus,
      }
    }),
  }
}

export function startVehiclePhase(
  data: ErpData,
  vehicleId: string,
  operator: ProductionOperatorIdentity,
) {
  const production = ensureProduction(data)
  const job = production.jobs.find((item) => item.vehicleId === vehicleId)
  if (!job) return data
  let next = data
  if (job.phase === 'Da iniziare') {
    next = moveProductionPhase(next, {
      vehicleId,
      nextPhase: 'Smontaggio',
      operator,
      note: 'Avvio lavorazione',
    })
  }
  const currentJob = ensureProduction(next).jobs.find((item) => item.vehicleId === vehicleId)
  if (!currentJob) return next
  const active = activeWorkLogForVehicle(next, vehicleId)
  if (active?.status === 'paused') return resumeProductionTimer(next, active.id)
  if (active?.status === 'running') return next
  return startProductionTimer(next, {
    vehicleId,
    phase: currentJob.phase,
    operator,
  })
}

export function completeVehiclePhase(
  data: ErpData,
  vehicleId: string,
  operator: ProductionOperatorIdentity,
) {
  const production = ensureProduction(data)
  const job = production.jobs.find((item) => item.vehicleId === vehicleId)
  if (!job) return data
  const phase = job.phase
  const nextPhase = nextProductionPhase(phase)
  if (!nextPhase) return data

  let next = data
  const active = activeWorkLogForVehicle(next, vehicleId)
  if (active && active.status !== 'completed') next = stopProductionTimer(next, active.id)

  return moveProductionPhase(next, {
    vehicleId,
    nextPhase,
    operator,
    note: 'Completamento fase',
  })
}

export function markVehicleReady(
  data: ErpData,
  vehicleId: string,
  operator: ProductionOperatorIdentity,
) {
  const job = ensureProduction(data).jobs.find((item) => item.vehicleId === vehicleId)
  if (!job || job.phase === 'Pronta') return data
  let next = data
  const active = activeWorkLogForVehicle(next, vehicleId)
  if (active && active.status !== 'completed') next = stopProductionTimer(next, active.id)
  while (true) {
    const current = ensureProduction(next).jobs.find((item) => item.vehicleId === vehicleId)
    if (!current || current.phase === 'Pronta') break
    const target = nextProductionPhase(current.phase)
    if (!target) break
    next = moveProductionPhase(next, {
      vehicleId,
      nextPhase: target,
      operator,
      note: 'Allineamento verso pronta',
    })
  }
  return next
}

export function timerMinutesByVehicleAndPhase(data: ErpData, vehicleId: string, phase: ProductionPhase) {
  const production = ensureProduction(data)
  const now = nowIso()
  return roundMinutes(production.workLogs
    .filter((log) => log.vehicleId === vehicleId && log.phase === phase)
    .reduce((sum, log) => {
      if (log.status === 'running') {
        const anchor = log.lastResumedAt || log.startedAt
        return sum + log.totalMinutes + elapsedMinutes(anchor, now)
      }
      return sum + log.totalMinutes
    }, 0))
}

export function totalWorkedHoursByVehicle(data: ErpData, vehicleId: string) {
  const production = ensureProduction(data)
  const now = nowIso()
  const totalMinutes = production.workLogs
    .filter((log) => log.vehicleId === vehicleId)
    .reduce((sum, log) => {
      if (log.status === 'running') {
        const anchor = log.lastResumedAt || log.startedAt
        return sum + log.totalMinutes + elapsedMinutes(anchor, now)
      }
      return sum + log.totalMinutes
    }, 0)
  return Math.round((totalMinutes / 60) * 100) / 100
}

function dueTodayOrOverdue(promisedAt: string) {
  if (!promisedAt) return { dueToday: false, overdue: false }
  const today = todayKey()
  if (promisedAt === today) return { dueToday: true, overdue: false }
  return { dueToday: false, overdue: promisedAt < today }
}

export function buildTodayInShopSnapshot(data: ErpData): TodayInShopSnapshot {
  const production = ensureProduction(data)
  const phaseCards = PRODUCTION_PHASES.map((phase) => ({
    phase,
    jobs: production.jobs.filter((job) => job.phase === phase),
  }))
  const byPriority = production.jobs.reduce((acc, job) => {
    if (job.priority === 'Urgente') acc.urgente += 1
    else if (job.priority === 'Alta') acc.alta += 1
    else acc.normale += 1
    return acc
  }, { urgente: 0, alta: 0, normale: 0 })

  const dueCounters = production.jobs.reduce((acc, job) => {
    const due = dueTodayOrOverdue(job.promisedAt)
    if (due.dueToday) acc.dueToday += 1
    if (due.overdue) acc.overdue += 1
    return acc
  }, { dueToday: 0, overdue: 0 })

  return {
    phaseCards,
    alertsOpen: openProductionReports(data).length,
    byPriority,
    activeTimers: production.workLogs.filter((log) => log.status === 'running').length,
    dueToday: dueCounters.dueToday,
    overdue: dueCounters.overdue,
  }
}

export function syncVehicleWorkedHoursFromProduction(data: ErpData): ErpData {
  const production = ensureProduction(data)
  if (!production.workLogs.length) return data
  const now = nowIso()
  const minutesByVehicle = new Map<string, number>()
  for (const log of production.workLogs) {
    const existing = minutesByVehicle.get(log.vehicleId) ?? 0
    const live = log.status === 'running'
      ? elapsedMinutes(log.lastResumedAt || log.startedAt, now)
      : 0
    minutesByVehicle.set(log.vehicleId, existing + log.totalMinutes + live)
  }
  const vehicles = data.vehicles.map((vehicle) => {
    const totalMinutes = minutesByVehicle.get(vehicle.id)
    if (!totalMinutes) return vehicle
    const workedHours = Math.round((totalMinutes / 60) * 100) / 100
    const capped = Math.min(vehicle.estimatedHours, Math.max(vehicle.workedHours, workedHours))
    return { ...vehicle, workedHours: capped }
  })
  return { ...data, vehicles }
}

export function listProductionWorkLogs(data: ErpData, vehicleId: string) {
  const production = ensureProduction(data)
  return production.workLogs.filter((log) => log.vehicleId === vehicleId)
}

export function defaultProductionIdentity(data: ErpData): ProductionOperatorIdentity {
  const production = ensureProduction(data)
  return production.identities[0] ?? DEFAULT_PRODUCTION_IDENTITY
}

export function isFinancialViewRestricted(identity: ProductionOperatorIdentity) {
  return identity.role === 'production'
}

export function isToday(dateIso: string) {
  if (!dateIso) return false
  const input = new Date(dateIso).getTime()
  if (!Number.isFinite(input)) return false
  const now = Date.now()
  return Math.abs(now - input) < DAY_MS
}
