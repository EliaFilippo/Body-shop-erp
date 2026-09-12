import type {
  ErpData,
  EstimateLine,
  EstimateProductionForecast,
  JobPhase,
  OperatorDayProgram,
  OperatorDayProgramSummary,
  OperatorProgramHistoryEntry,
  OperatorProgramTask,
  PlannerAssignment,
  PlannerOperator,
  PlannerPriorityWeights,
  PlannerSettings,
  ProductionWorkLog,
  RepairJob,
  Vehicle,
} from '../types'
import { estimatePhaseTotals, estimateVehicleTotalMinutes, JOB_PHASE_TEMPLATE, resolveInternalHourlyRate } from './workflow'
import { isVehicleDeliveredStatus } from './vehicleStatuses'
import {
  addDays as calendarAddDays,
  addWorkingMinutes,
  calendarMinutesBetween,
  dateKey as calendarDateKey,
  getOperatorWorkingIntervals,
  isWorkingDate,
  nextWorkingInstant,
  parseDateKey,
  workingMinutesForDate,
} from './workCalendar'

const round = (value: number) => Math.round(value * 100) / 100
const dayStartIso = (date: string) => `${date}T00:00:00.000Z`
const MAX_SCORE_DAYS = 30

const DEFAULT_PRIORITY_WEIGHTS: PlannerPriorityWeights = {
  urgency: 120,
  promisedDate: 110,
  daysToDelivery: 90,
  accumulatedDelay: 100,
  startedWork: 80,
  technicalReady: 70,
  operatorAvailability: 50,
  marginPerHour: 40,
  totalMargin: 30,
  capacityOptimization: 20,
  fifo: 10,
  blockedPenalty: 150,
}

function resolvePriorityWeights(settings: PlannerSettings): PlannerPriorityWeights {
  return {
    ...DEFAULT_PRIORITY_WEIGHTS,
    ...(settings.plannerPriorityWeights ?? {}),
  }
}

function betweenDays(from: string, to: string) {
  if (!from || !to) return MAX_SCORE_DAYS
  const fromDate = new Date(`${from}T00:00:00.000Z`).getTime()
  const toDate = new Date(`${to}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(fromDate) || !Number.isFinite(toDate)) return MAX_SCORE_DAYS
  return Math.round((toDate - fromDate) / 86_400_000)
}

function normalizeScore(value: number, max: number) {
  if (max <= 0) return 0
  return Math.max(0, Math.min(1, value / max))
}

function marginMetrics(job: RepairJob, vehicle: Vehicle, settings: PlannerSettings) {
  const phaseMinutes = Math.max(0, job.phases.reduce((sum, phase) => sum + Math.max(0, Number(phase.estimatedMinutes ?? 0)), 0))
  const lineMinutes = Math.max(0, estimateVehicleTotalMinutes(job.lines ?? []))
  const productiveMinutes = Math.max(phaseMinutes, lineMinutes, Math.max(0, vehicle.estimatedHours || 0) * 60)
  const productiveHours = Math.max(0.25, productiveMinutes / 60)
  const rate = Math.max(0, resolveInternalHourlyRate(settings).effectiveHourlyRate || 0)
  const revenueFromLines = (job.lines ?? []).reduce((sum, line) => sum + Math.max(0, Number(line.taxableAmount ?? line.total ?? 0)), 0)
  const plannedRevenue = Math.max(0, Number(job.taxableAmount ?? 0), Number(job.total ?? 0), revenueFromLines, Number(vehicle.expectedRevenue ?? 0))
  const totalMargin = plannedRevenue - (productiveHours * rate)
  const marginPerHour = totalMargin / productiveHours
  return {
    productiveHours,
    totalMargin,
    marginPerHour,
  }
}

function priorityTier(priority: RepairJob['priority'], promisedDate?: string) {
  const hasPromised = Boolean(promisedDate)
  if (priority === 'Urgente' && hasPromised) return 1
  if (hasPromised) return 2
  if (priority === 'Urgente') return 3
  return 4
}

export type TrafficStatus = 'green' | 'yellow' | 'red' | 'neutral'

export interface DayCapacity {
  date: string
  nominal: number
  normal: number
  protected: number
  committed: number
  remaining: number
  overload: number
  saturation: number
}

export interface VehiclePlanResult {
  vehicleId: string
  calculatedDeliveryDate: string
  status: TrafficStatus
  missingHours: number
  delayWorkingDays: number
  suggestedDate: string
  assignments: PlannerAssignment[]
  blocked: boolean
}

export interface PlannerResult {
  vehicles: VehiclePlanResult[]
  assignments: PlannerAssignment[]
}

export interface PlannerQueueItem {
  jobId: string
  jobNumber: string
  vehicleId?: string
  plate: string
  status: RepairJob['status']
  priority: RepairJob['priority']
  phaseName: string
  schedulable: boolean
  reason: string
  availableFrom?: string
}

export interface PlannerLatestJobTrace {
  jobId: string
  quoteId: string
  vehicleId: string
  plate: string
  status: RepairJob['status']
  currentPhase: string
  requestedDelivery: string
  estimatedDelivery: string
  priority: RepairJob['priority']
  workflowId: string
  phaseCount: number
  phases: Array<{ name: string; minutes: number; requiredSkill: string }>
  compatibleOperators: string[]
  schedulablePhaseCount: number
  eligible: boolean
  reason: string
  loadedFromDatabase: boolean
  workflowFound: boolean
  entersPlannerInput: boolean
  exitsPlannerOutput: boolean
  appearsInPlannedVehicles: boolean
  appearsInOperatorProgram: boolean
  inputExclusionCondition: string
}

export interface OperatorProgramResult {
  programs: OperatorDayProgram[]
  historyEntry: OperatorProgramHistoryEntry
}

export interface SimulatedPhaseForecast {
  phaseName: string
  plannedMinutes: number
  technicalWaitMinutes: number
  operatorIds: string[]
  operatorNames: string[]
  startAt: string
  endAt: string
  availableAfter: string
}

export interface EstimateProductionSimulation extends EstimateProductionForecast {
  phasePlans: SimulatedPhaseForecast[]
}

export const dateKey = calendarDateKey
export const parseDate = parseDateKey
export const addDays = calendarAddDays
const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const todayKey = () => localDateKey(new Date())

function planningDateFloor(referenceDate: string, nowIso?: string) {
  if (!nowIso) return referenceDate
  const nowDate = localDateKey(new Date(nowIso))
  return referenceDate < nowDate ? nowDate : referenceDate
}

function planningInstantFloor(referenceDate: string, nowIso?: string) {
  if (!nowIso) return `${referenceDate}T00:00:00.000Z`
  const nowDate = localDateKey(new Date(nowIso))
  if (referenceDate < nowDate) return nowIso
  if (referenceDate === nowDate) return nowIso
  return `${referenceDate}T00:00:00.000Z`
}

export const remainingHours = (vehicle: Vehicle) =>
  Math.max(0, round((vehicle.estimatedHours || 0) - (vehicle.workedHours || 0)))

const PHASE_SKILL_FALLBACK: Record<string, string> = {
  Smontaggio: 'smontaggio',
  Lattoneria: 'lattoneria',
  Preparazione: 'preparazione',
  Verniciatura: 'verniciatura',
  Rimontaggio: 'rimontaggio',
  Lucidatura: 'lucidatura',
  Lavaggio: 'lavaggio',
  'Controllo qualità': 'controllo',
}

function minutesFromIso(value: string) {
  const date = new Date(value)
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function phaseTemplateIndex(phaseName: string) {
  return JOB_PHASE_TEMPLATE.indexOf(phaseName as (typeof JOB_PHASE_TEMPLATE)[number])
}

function phaseSkillName(phaseName: string) {
  return PHASE_SKILL_FALLBACK[phaseName] ?? phaseName.trim().toLowerCase()
}

function operatorSupportsPhase(operator: PlannerOperator, phaseName: string) {
  const skills = (operator.skills ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean)
  if (!skills.length) return true
  const phaseSkill = phaseSkillName(phaseName)
  return skills.some((skill) => phaseSkill.includes(skill) || skill.includes(phaseSkill))
}

function remainingWorkingMinutesToday(fromIso: string, settings: PlannerSettings, operator?: PlannerOperator) {
  const date = fromIso.slice(0, 10)
  const minute = minutesFromIso(fromIso)
  return getOperatorWorkingIntervals(date, settings, operator).reduce((sum, interval) => {
    if (interval.endMinute <= minute) return sum
    return sum + Math.max(0, interval.endMinute - Math.max(interval.startMinute, minute))
  }, 0)
}

function estimatedPhaseSequence(lines: EstimateLine[]) {
  const totals = estimatePhaseTotals(lines)
  const fallbackMinutes = Math.max(15, Math.round(estimateVehicleTotalMinutes(lines)))
  const lineByPhase = new Map<string, EstimateLine[]>()
  for (const line of lines) {
    const phaseName = String(line.categoryOrPhase ?? '').trim()
    if (!phaseName) continue
    lineByPhase.set(phaseName, [...(lineByPhase.get(phaseName) ?? []), line])
  }

  const phases: Array<{ phaseName: string; plannedMinutes: number; requiredSkill: string; technicalWaitMinutes: number; technicalWaitBlocksPhaseNames: string[] }> = []
  for (const phaseName of JOB_PHASE_TEMPLATE) {
    const minutes = Math.max(0, Number(totals.get(phaseName) ?? 0))
    if (minutes <= 0) continue
    const phaseLines = lineByPhase.get(phaseName) ?? []
    const requiredSkill = phaseLines.find((line) => String(line.requiredSkill ?? '').trim())?.requiredSkill ?? phaseSkillName(phaseName)
    const technicalWaitMinutes = Math.max(0, ...phaseLines.map((line) => Math.max(0, Number(line.technicalWaitMinutes ?? 0))), 0)
    const technicalWaitBlocksPhaseNames = Array.from(new Set(phaseLines.flatMap((line) => line.technicalWaitBlocksPhaseNames ?? []).map((name) => String(name).trim()).filter(Boolean)))
    phases.push({
      phaseName,
      plannedMinutes: Math.max(15, Math.round(minutes)),
      requiredSkill,
      technicalWaitMinutes,
      technicalWaitBlocksPhaseNames,
    })
  }

  if (phases.length) return phases
  return [{ phaseName: 'Produzione', plannedMinutes: fallbackMinutes, requiredSkill: '', technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [] }]
}

function desiredOperatorCount(priority: RepairJob['priority'], requestedDeliveryDate?: string, referenceDate?: string) {
  if (priority === 'Urgente') return 2
  if (requestedDeliveryDate && referenceDate && requestedDeliveryDate <= addDays(referenceDate, 1)) return 2
  return 1
}

function reliabilityFromSimulation(input: {
  phasePlans: SimulatedPhaseForecast[]
  workshopLoadPercent: number
  requestedDeliveryCompatible?: boolean
  compatibleOperatorsFound: boolean
  productiveDurationMinutes: number
}) {
  if (!input.compatibleOperatorsFound) return 'Bassa' as const
  if (input.requestedDeliveryCompatible === false) return 'Bassa' as const
  if (input.workshopLoadPercent >= 95) return 'Bassa' as const
  if (input.workshopLoadPercent >= 80 || input.productiveDurationMinutes > 8 * 60) return 'Media' as const
  return 'Alta' as const
}

export function isWorkingDay(date: string, settings: PlannerSettings) {
  return isWorkingDate(date, settings)
}

export function calculateDayCapacity(date: string, settings: PlannerSettings): DayCapacity {
  if (!isWorkingDay(date, settings)) {
    return { date, nominal: 0, normal: 0, protected: 0, committed: 0, remaining: 0, overload: 0, saturation: 0 }
  }
  const nominal = settings.operators
    .filter((operator) => operator.active)
    .reduce((total, operator) => total + (workingMinutesForDate(date, settings, operator) / 60), 0)
  const normal = nominal * Math.max(0, settings.efficiencyPercent) / 100
  const protectedHours = normal * (1 - Math.min(100, Math.max(0, settings.safetyMarginPercent)) / 100)
  return {
    date,
    nominal: round(nominal),
    normal: round(normal),
    protected: round(protectedHours),
    committed: 0,
    remaining: round(protectedHours),
    overload: 0,
    saturation: 0,
  }
}

export function workingDaysBetween(from: string, to: string, settings: PlannerSettings) {
  if (!from || !to || to <= from) return 0
  let count = 0
  for (let date = addDays(from, 1); date <= to; date = addDays(date, 1)) {
    if (isWorkingDay(date, settings)) count += 1
  }
  return count
}

export function sortPlanningVehicles(vehicles: Vehicle[]) {
  return [...vehicles].sort((a, b) => {
    const aBlocked = Boolean(a.blockReason) || a.partsStatus === 'Mancanti'
    const bBlocked = Boolean(b.blockReason) || b.partsStatus === 'Mancanti'
    const aTier = priorityTier(a.priority ?? 'Normale', a.requestedDeliveryDate || '')
    const bTier = priorityTier(b.priority ?? 'Normale', b.requestedDeliveryDate || '')
    const aDaysToDue = betweenDays(a.plannedEntryDate || a.createdAt.slice(0, 10), a.requestedDeliveryDate || '')
    const bDaysToDue = betweenDays(b.plannedEntryDate || b.createdAt.slice(0, 10), b.requestedDeliveryDate || '')
    return Number(aBlocked) - Number(bBlocked)
      || aTier - bTier
      || aDaysToDue - bDaysToDue
      || (a.requestedDeliveryDate || '9999-12-31').localeCompare(b.requestedDeliveryDate || '9999-12-31')
      || (a.plannedEntryDate || a.createdAt).localeCompare(b.plannedEntryDate || b.createdAt)
      || (a.manualPlanningDate || '9999-12-31').localeCompare(b.manualPlanningDate || '9999-12-31')
      || a.createdAt.localeCompare(b.createdAt)
  })
}

function availableFor(date: string, settings: PlannerSettings, usage: Map<string, number>, protectedMode: boolean) {
  const capacity = calculateDayCapacity(date, settings)
  const limit = protectedMode ? capacity.protected : capacity.normal
  return Math.max(0, round(limit - (usage.get(date) ?? 0)))
}

function allocate(
  vehicle: Vehicle,
  settings: PlannerSettings,
  usage: Map<string, number>,
  protectedMode: boolean,
  referenceDate: string,
  maxDays = 730,
) {
  let remaining = remainingHours(vehicle)
  const assignments: PlannerAssignment[] = []
  const start = [referenceDate, vehicle.plannedEntryDate, vehicle.manualPlanningDate].filter(Boolean).sort().at(-1) ?? referenceDate
  let date = start
  for (let day = 0; day < maxDays && remaining > 0; day += 1, date = addDays(date, 1)) {
    const available = availableFor(date, settings, usage, protectedMode)
    if (available <= 0) continue
    const hours = Math.min(remaining, available)
    assignments.push({
      vehicleId: vehicle.id,
      date,
      protectedHours: protectedMode ? round(hours) : 0,
      normalHours: protectedMode ? 0 : round(hours),
    })
    usage.set(date, round((usage.get(date) ?? 0) + hours))
    remaining = round(remaining - hours)
  }
  return { assignments, delivery: assignments.at(-1)?.date ?? start, unallocated: remaining }
}

export function calculatePlanner(vehicles: Vehicle[], settings: PlannerSettings, referenceDate = todayKey(), nowIso?: string): PlannerResult {
  const effectiveReferenceDate = planningDateFloor(referenceDate, nowIso)
  const active = sortPlanningVehicles(vehicles.filter((vehicle) => !isVehicleDeliveredStatus(settings, vehicle.status) && remainingHours(vehicle) > 0))
  const protectedUsage = new Map<string, number>()
  const normalUsage = new Map<string, number>()
  const results: VehiclePlanResult[] = []

  for (const vehicle of active) {
    const blocked = Boolean(vehicle.blockReason) || vehicle.partsStatus === 'Mancanti'
    if (blocked) {
      results.push({
        vehicleId: vehicle.id,
        calculatedDeliveryDate: '',
        status: 'neutral',
        missingHours: remainingHours(vehicle),
        delayWorkingDays: 0,
        suggestedDate: '',
        assignments: [],
        blocked: true,
      })
      continue
    }
    const protectedPlan = allocate(vehicle, settings, protectedUsage, true, effectiveReferenceDate)
    const normalPlan = allocate(vehicle, settings, normalUsage, false, effectiveReferenceDate)
    const requested = vehicle.requestedDeliveryDate
    let status: TrafficStatus = 'neutral'
    if (requested && requested < effectiveReferenceDate) {
      status = 'red'
    } else if (requested) {
      if (!protectedPlan.unallocated && protectedPlan.delivery <= requested) status = 'green'
      else if (!normalPlan.unallocated && normalPlan.delivery <= requested) status = 'yellow'
      else status = 'red'
    }
    const normalAssignedByDeadline = normalPlan.assignments
      .filter((item) => !requested || item.date <= requested)
      .reduce((sum, item) => sum + item.normalHours, 0)
    results.push({
      vehicleId: vehicle.id,
      calculatedDeliveryDate: protectedPlan.delivery,
      status,
      missingHours: status === 'red' ? round(Math.max(0, remainingHours(vehicle) - normalAssignedByDeadline)) : 0,
      delayWorkingDays: status === 'red' && requested ? workingDaysBetween(requested, normalPlan.delivery, settings) : 0,
      suggestedDate: normalPlan.delivery,
      assignments: protectedPlan.assignments,
      blocked: false,
    })
  }

  return { vehicles: results, assignments: results.flatMap((result) => result.assignments) }
}

export function capacityWithAssignments(date: string, settings: PlannerSettings, assignments: PlannerAssignment[]): DayCapacity {
  const base = calculateDayCapacity(date, settings)
  const committed = round(assignments.filter((item) => item.date === date).reduce((sum, item) => sum + item.protectedHours, 0))
  const overload = round(Math.max(0, committed - base.protected))
  return {
    ...base,
    committed,
    remaining: round(Math.max(0, base.protected - committed)),
    overload,
    saturation: base.protected ? round((committed / base.protected) * 100) : committed ? 100 : 0,
  }
}

export function moveVehiclePlanningDate(assignments: PlannerAssignment[], vehicleId: string, date: string, settings: PlannerSettings) {
  const moving = assignments.filter((item) => item.vehicleId === vehicleId)
  const kept = assignments.filter((item) => item.vehicleId !== vehicleId)
  const hours = round(moving.reduce((sum, item) => sum + item.protectedHours, 0))
  const capacity = capacityWithAssignments(date, settings, kept)
  return {
    assignments: [...kept, { vehicleId, date, protectedHours: hours, normalHours: 0 }],
    requiresConfirmation: hours > capacity.remaining,
    excessHours: round(Math.max(0, hours - capacity.remaining)),
  }
}

export const moveVehicleWork = moveVehiclePlanningDate

const isJobBlocked = (job: RepairJob) => job.status === 'In attesa' || job.phases.some((phase) => phase.status === 'Bloccata')
const isJobActive = (job: RepairJob) => job.status !== 'Annullata' && job.status !== 'Consegnata'

function jobStarted(job: RepairJob) {
  if (job.status === 'In lavorazione') return true
  return job.phases.some((phase) => phase.status === 'In lavorazione' || (phase.operatorAssignments ?? []).some((assignment) => assignment.activityStatus === 'Attivo' && !assignment.endedAt))
}

function computePriorityScore(input: {
  job: RepairJob
  vehicle: Vehicle
  referenceDate: string
  blocked: boolean
  compatibleCount: number
  totalActiveOperators: number
  readyAt: string
  settings: PlannerSettings
}) {
  const { job, vehicle, referenceDate, blocked, compatibleCount, totalActiveOperators, readyAt, settings } = input
  const weights = resolvePriorityWeights(settings)
  const promisedDate = String(job.expectedDeliveryDate ?? '').trim()
  const tier = priorityTier(job.priority, promisedDate)
  const started = jobStarted(job)
  const daysToDueRaw = promisedDate ? betweenDays(referenceDate, promisedDate) : MAX_SCORE_DAYS
  const daysToDue = Math.max(0, daysToDueRaw)
  const delayDays = Math.max(0, -daysToDueRaw)
  const dueSoonScore = 1 - normalizeScore(daysToDue, MAX_SCORE_DAYS)
  const readyNow = readyAt.slice(0, 10) <= referenceDate ? 1 : 0
  const compatibilityScore = totalActiveOperators > 0 ? compatibleCount / totalActiveOperators : 0
  const economics = marginMetrics(job, vehicle, settings)
  const marginPerHourScore = normalizeScore(Math.max(0, economics.marginPerHour), 500)
  const totalMarginScore = normalizeScore(Math.max(0, economics.totalMargin), 5000)
  const fifoAgeDays = Math.max(0, betweenDays(vehicle.createdAt.slice(0, 10), referenceDate))
  const fifoScore = normalizeScore(fifoAgeDays, 90)
  const rawScore =
    weights.urgency * (job.priority === 'Urgente' ? 1 : 0)
    + weights.promisedDate * (promisedDate ? 1 : 0)
    + weights.daysToDelivery * dueSoonScore
    + weights.accumulatedDelay * normalizeScore(delayDays, 30)
    + weights.startedWork * (started ? 1 : 0)
    + weights.technicalReady * readyNow
    + weights.operatorAvailability * compatibilityScore
    + weights.marginPerHour * marginPerHourScore
    + weights.totalMargin * totalMarginScore
    + weights.capacityOptimization * readyNow
    + weights.fifo * fifoScore
    - weights.blockedPenalty * (blocked ? 1 : 0)
  return {
    tier,
    score: rawScore,
    totalMargin: economics.totalMargin,
    marginPerHour: economics.marginPerHour,
    started,
    promisedDate,
    dueDate: promisedDate || '9999-12-31',
    readyAt,
  }
}

function phaseManWorkedMinutes(phase: JobPhase, atIso: string) {
  return (phase.operatorAssignments ?? []).reduce((sum, assignment) => {
    if (assignment.endedAt) return sum + Math.max(0, assignment.workedMinutes)
    if (assignment.activityStatus === 'Attivo') {
      const elapsed = Math.max(0, Math.round((new Date(atIso).getTime() - new Date(assignment.startedAt).getTime()) / 60000))
      return sum + Math.max(assignment.workedMinutes, elapsed)
    }
    return sum + Math.max(0, assignment.workedMinutes)
  }, 0)
}

function phaseResidualMinutes(phase: JobPhase, atIso: string) {
  const estimated = Math.max(15, phase.estimatedMinutes || 15)
  const worked = phaseManWorkedMinutes(phase, atIso)
  const activeCount = Math.max(1, (phase.operatorAssignments ?? []).filter((item) => item.activityStatus === 'Attivo' && !item.endedAt).length)
  return Math.max(15, Math.ceil(Math.max(0, estimated - worked) / activeCount))
}

function operatorCompatible(operator: PlannerOperator, phase: JobPhase) {
  return operatorSupportsPhase(operator, phase.name)
}

function reasonForAssignment(job: RepairJob, hasDelay: boolean, isContinuation: boolean, isSupport: boolean, isAdvancedFromFuture: boolean) {
  if (isAdvancedFromFuture) return 'Lavorazione futura anticipata nel primo slot disponibile'
  if (hasDelay && job.priority === 'Urgente') return 'Priorita alta: consegna oggi'
  if (isContinuation) return 'Prosegue lavorazione gia iniziata'
  if (isSupport) return 'Supporto secondo operatore per recuperare ritardo'
  return 'Operatore disponibile e compatibile'
}

function hasExplicitSkillMismatch(phase: JobPhase, operators: PlannerOperator[]) {
  const required = String(phase.requiredSkill ?? '').trim().toLowerCase()
  if (!required) return false
  const skilled = operators.some((operator) => (operator.skills ?? []).some((skill) => skill.trim().toLowerCase() === required))
  return !skilled
}

function technicalWaitStillRunning(job: RepairJob, phase: JobPhase, readyAt: string, referenceDate: string) {
  if (!readyAt) return false
  const index = job.phases.findIndex((item) => item.id === phase.id)
  if (index < 0) return false
  const referenceInstant = `${referenceDate}T23:59:59.999Z`
  if (readyAt <= referenceInstant) return false
  return job.phases.slice(0, index).some((predecessor) => {
    if (predecessor.notRequired) return false
    if (predecessor.status !== 'Completata') return false
    const blocksBySequence = phaseTemplateIndex(predecessor.name) === index - 1
    const blocksByTechnicalWait = (predecessor.technicalWaitBlocksPhaseNames ?? []).includes(phase.name)
    return (blocksBySequence || blocksByTechnicalWait) && Math.max(0, Number(predecessor.technicalWaitMinutes ?? 0)) > 0
  })
}

function firstOperatorCapacityDate(
  fromIso: string,
  settings: PlannerSettings,
  operators: PlannerOperator[],
  horizonEndDate: string,
) {
  for (let date = fromIso.slice(0, 10); date <= horizonEndDate; date = addDays(date, 1)) {
    const available = operators.some((operator) => workingMinutesForDate(date, settings, operator) > 0)
    if (!available) continue
    const first = nextWorkingInstant(`${date}T00:00:00.000Z`, settings, operators[0])
    return first.slice(0, 10)
  }
  return ''
}

export function buildPlannerQueue(data: ErpData, referenceDate = todayKey(), horizonDays = 30, nowIso?: string): PlannerQueueItem[] {
  const effectiveReferenceDate = planningDateFloor(referenceDate, nowIso)
  const jobs = (data.jobs ?? []).filter((job) => isJobActive(job))
  const vehiclesById = new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const activeOperators = data.plannerSettings.operators.filter((operator) => operator.active)
  const horizonEndDate = addDays(effectiveReferenceDate, Math.max(1, horizonDays))

  return jobs.map((job) => {
    if (!job.vehicleId) {
      return {
        jobId: job.id,
        jobNumber: job.number,
        plate: job.plate,
        status: job.status,
        priority: job.priority,
        phaseName: '—',
        schedulable: false,
        reason: 'Dati mancanti: commessa senza vehicleId',
      }
    }
    const vehicle = vehiclesById.get(job.vehicleId)
    if (!vehicle) {
      return {
        jobId: job.id,
        jobNumber: job.number,
        vehicleId: job.vehicleId,
        plate: job.plate,
        status: job.status,
        priority: job.priority,
        phaseName: '—',
        schedulable: false,
        reason: 'Dati mancanti: veicolo non trovato',
      }
    }
    if (job.status === 'Consegnata') {
      return {
        jobId: job.id,
        jobNumber: job.number,
        vehicleId: job.vehicleId,
        plate: job.plate,
        status: job.status,
        priority: job.priority,
        phaseName: '—',
        schedulable: false,
        reason: 'Commessa gia consegnata',
      }
    }
    const blockedByParts = vehicle.partsStatus === 'Mancanti' || /ricambi/i.test(vehicle.blockReason || '')
    if (blockedByParts) {
      return {
        jobId: job.id,
        jobNumber: job.number,
        vehicleId: job.vehicleId,
        plate: job.plate,
        status: job.status,
        priority: job.priority,
        phaseName: '—',
        schedulable: false,
        reason: 'Attesa ricambi',
      }
    }
    if (isJobBlocked(job) || Boolean(vehicle.blockReason)) {
      return {
        jobId: job.id,
        jobNumber: job.number,
        vehicleId: job.vehicleId,
        plate: job.plate,
        status: job.status,
        priority: job.priority,
        phaseName: '—',
        schedulable: false,
        reason: 'Bloccata',
      }
    }
    const selected = selectSchedulablePhase(job)
    if (!selected) {
      return {
        jobId: job.id,
        jobNumber: job.number,
        vehicleId: job.vehicleId,
        plate: job.plate,
        status: job.status,
        priority: job.priority,
        phaseName: '—',
        schedulable: false,
        reason: 'Nessuna fase schedulabile',
      }
    }
    const compatible = activeOperators.filter((operator) => operatorCompatible(operator, selected.phase))
    if (!compatible.length) {
      const reason = hasExplicitSkillMismatch(selected.phase, activeOperators)
        ? 'Lavorazione senza competenza configurata'
        : 'Nessun operatore compatibile'
      return {
        jobId: job.id,
        jobNumber: job.number,
        vehicleId: job.vehicleId,
        plate: job.plate,
        status: job.status,
        priority: job.priority,
        phaseName: selected.phase.name,
        schedulable: false,
        reason,
      }
    }
    const readyAt = nextWorkingInstant(selected.readyAt, data.plannerSettings, compatible[0])
    const readyDate = readyAt.slice(0, 10)
    const firstCapacityDate = firstOperatorCapacityDate(readyAt, data.plannerSettings, compatible, horizonEndDate)
    const isOverdueWork = readyDate < effectiveReferenceDate
    if (!firstCapacityDate) {
      return {
        jobId: job.id,
        jobNumber: job.number,
        vehicleId: job.vehicleId,
        plate: job.plate,
        status: job.status,
        priority: job.priority,
        phaseName: selected.phase.name,
        schedulable: false,
        reason: 'Nessuna capacita disponibile nell\'orizzonte corrente',
      }
    }
    const requestedExpired = Boolean(job.expectedDeliveryDate && job.expectedDeliveryDate < effectiveReferenceDate)
    if (requestedExpired) {
      return {
        jobId: job.id,
        jobNumber: job.number,
        vehicleId: job.vehicleId,
        plate: job.plate,
        status: job.status,
        priority: job.priority,
        phaseName: selected.phase.name,
        schedulable: firstCapacityDate <= horizonEndDate,
        reason: 'Data richiesta scaduta',
        availableFrom: firstCapacityDate,
      }
    }
    if (firstCapacityDate > effectiveReferenceDate) {
      const waitingReason = technicalWaitStillRunning(job, selected.phase, readyAt, effectiveReferenceDate)
        ? 'Tempo tecnico in corso'
        : firstCapacityDate > readyDate
          ? `Nessuna capacita disponibile oggi, prima disponibilita ${firstCapacityDate}`
          : `In attesa fino al ${readyAt.slice(0, 16).replace('T', ' ')}`
      const reason = isOverdueWork ? `Lavorazione arretrata · ${waitingReason}` : waitingReason
      return {
        jobId: job.id,
        jobNumber: job.number,
        vehicleId: job.vehicleId,
        plate: job.plate,
        status: job.status,
        priority: job.priority,
        phaseName: selected.phase.name,
        schedulable: false,
        reason,
        availableFrom: firstCapacityDate,
      }
    }
    return {
      jobId: job.id,
      jobNumber: job.number,
      vehicleId: job.vehicleId,
      plate: job.plate,
      status: job.status,
      priority: job.priority,
      phaseName: selected.phase.name,
      schedulable: true,
      reason: 'Schedulabile',
      availableFrom: firstCapacityDate,
    }
  })
}

export function buildLatestJobTraceReport(data: ErpData, referenceDate = todayKey()): PlannerLatestJobTrace | null {
  const jobs = data.jobs ?? []
  if (!jobs.length) return null
  const latest = [...jobs].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id))[0]
  const vehiclesById = new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const vehicle = latest.vehicleId ? vehiclesById.get(latest.vehicleId) : undefined
  const selected = selectSchedulablePhase(latest)
  const activeOperators = data.plannerSettings.operators.filter((operator) => operator.active)
  const compatible = selected ? activeOperators.filter((operator) => operatorCompatible(operator, selected.phase)) : []
  const queue = buildPlannerQueue(data, referenceDate)
  const queueItem = queue.find((item) => item.jobId === latest.id)
  const plannerInputVehicles = sortPlanningVehicles(data.vehicles.filter((item) => !isVehicleDeliveredStatus(data.plannerSettings, item.status) && remainingHours(item) > 0))
  const entersPlannerInput = Boolean(latest.vehicleId && plannerInputVehicles.some((item) => item.id === latest.vehicleId))
  const planner = calculatePlanner(data.vehicles, data.plannerSettings, referenceDate)
  const exitsPlannerOutput = Boolean(latest.vehicleId && planner.vehicles.some((item) => item.vehicleId === latest.vehicleId))
  const appearsInPlannedVehicles = Boolean(
    vehicle
        && !isVehicleDeliveredStatus(data.plannerSettings, vehicle.status)
      && ((latest.vehicleId && jobs.some((item) => item.vehicleId === latest.vehicleId && item.status !== 'Annullata' && item.status !== 'Consegnata')) || vehicle.estimatedHours > vehicle.workedHours),
  )
  const operatorPrograms = data.operatorPrograms ?? []
  const appearsInOperatorProgram = operatorPrograms.some((program) => program.tasks.some((task) => task.jobId === latest.id))
  let inputExclusionCondition = 'nessuna'
  if (!latest.vehicleId) inputExclusionCondition = 'job.vehicleId assente'
  else if (!vehicle) inputExclusionCondition = 'vehicle non trovato da vehicleId'
  else if (isVehicleDeliveredStatus(data.plannerSettings, vehicle.status)) inputExclusionCondition = 'vehicle.status = Consegnata'
  else if (remainingHours(vehicle) <= 0) inputExclusionCondition = `remainingHours <= 0 (estimated=${vehicle.estimatedHours}, worked=${vehicle.workedHours})`

  return {
    jobId: latest.id,
    quoteId: String(latest.estimateId ?? ''),
    vehicleId: String(latest.vehicleId ?? ''),
    plate: latest.plate,
    status: latest.status,
    currentPhase: selected?.phase.name ?? '—',
    requestedDelivery: latest.expectedDeliveryDate,
    estimatedDelivery: vehicle?.calculatedDeliveryDate ?? '',
    priority: latest.priority,
    workflowId: latest.id,
    phaseCount: latest.phases.length,
    phases: latest.phases.map((phase) => ({ name: phase.name, minutes: Math.max(0, Number(phase.estimatedMinutes ?? 0)), requiredSkill: String(phase.requiredSkill ?? '') })),
    compatibleOperators: compatible.map((item) => item.name),
    schedulablePhaseCount: latest.phases.filter((phase) => !phase.notRequired && (phase.status === 'Da fare' || phase.status === 'In lavorazione')).length,
    eligible: Boolean(queueItem?.schedulable),
    reason: queueItem?.reason ?? 'Nessuna coda planner disponibile',
    loadedFromDatabase: jobs.length > 0,
    workflowFound: latest.phases.length > 0,
    entersPlannerInput,
    exitsPlannerOutput,
    appearsInPlannedVehicles,
    appearsInOperatorProgram,
    inputExclusionCondition,
  }
}

function taskSort(a: OperatorProgramTask, b: OperatorProgramTask) {
  return a.startAt.localeCompare(b.startAt) || a.jobNumber.localeCompare(b.jobNumber)
}

function samePrograms(a: OperatorDayProgram[], b: OperatorDayProgram[]) {
  return JSON.stringify(a.map((item) => ({ operatorId: item.operatorId, tasks: item.tasks.map((task) => ({
    operatorId: task.operatorId,
    jobId: task.jobId,
    phaseId: task.phaseId,
    startAt: task.startAt,
    endAt: task.endAt,
    plannedMinutes: task.plannedMinutes,
    reason: task.reason,
  })) }))) === JSON.stringify(b.map((item) => ({ operatorId: item.operatorId, tasks: item.tasks.map((task) => ({
    operatorId: task.operatorId,
    jobId: task.jobId,
    phaseId: task.phaseId,
    startAt: task.startAt,
    endAt: task.endAt,
    plannedMinutes: task.plannedMinutes,
    reason: task.reason,
  })) })))
}

function movedJobCount(previous: OperatorDayProgram[], next: OperatorDayProgram[]) {
  const previousStartByJob = new Map<string, string>()
  for (const program of previous) {
    for (const task of program.tasks) {
      const current = previousStartByJob.get(task.jobId)
      if (!current || task.startAt < current) previousStartByJob.set(task.jobId, task.startAt)
    }
  }
  const nextStartByJob = new Map<string, string>()
  for (const program of next) {
    for (const task of program.tasks) {
      const current = nextStartByJob.get(task.jobId)
      if (!current || task.startAt < current) nextStartByJob.set(task.jobId, task.startAt)
    }
  }
  let moved = 0
  for (const [jobId, previousStart] of previousStartByJob.entries()) {
    const nextStart = nextStartByJob.get(jobId)
    if (nextStart && nextStart !== previousStart) moved += 1
  }
  return moved
}

function completedAtForPhase(phase: JobPhase) {
  if (phase.endedAt) return phase.endedAt
  if (phase.status === 'Completata' && phase.operatorAssignments.length) {
    const ended = phase.operatorAssignments.map((assignment) => assignment.endedAt).filter((value): value is string => Boolean(value)).sort().at(-1)
    if (ended) return ended
  }
  return ''
}

function phaseReadyAt(job: RepairJob, phase: JobPhase) {
  const index = job.phases.findIndex((item) => item.id === phase.id)
  if (index < 0) return ''
  let readyAt = job.entryDate ? `${job.entryDate}T00:00:00.000Z` : new Date().toISOString()
  for (const predecessor of job.phases.slice(0, index)) {
    if (predecessor.notRequired) continue
    const completedAt = completedAtForPhase(predecessor) || `${job.entryDate || todayKey()}T00:00:00.000Z`
    if (!completedAt) return ''
    const isSequentialDependency = phaseTemplateIndex(predecessor.name) >= 0 && phaseTemplateIndex(predecessor.name) === index - 1
    const isTechnicalDependency = (predecessor.technicalWaitBlocksPhaseNames ?? []).includes(phase.name)
    const availableAt = (isSequentialDependency || isTechnicalDependency)
      ? new Date(new Date(completedAt).getTime() + Math.max(0, Number(predecessor.technicalWaitMinutes ?? 0)) * 60_000).toISOString()
      : completedAt
    if (availableAt > readyAt) readyAt = availableAt
  }
  return readyAt
}

function selectSchedulablePhase(job: RepairJob) {
  const active = job.phases.find((phase) => phase.status === 'In lavorazione')
  if (active) return { phase: active, readyAt: completedAtForPhase(active) || `${job.entryDate || todayKey()}T00:00:00.000Z` }
  const todo = job.phases
    .filter((phase) => phase.status === 'Da fare' && !phase.notRequired)
    .map((phase) => ({ phase, readyAt: phaseReadyAt(job, phase) }))
    .filter((entry) => Boolean(entry.readyAt))
    .sort((a, b) => a.readyAt.localeCompare(b.readyAt) || phaseTemplateIndex(a.phase.name) - phaseTemplateIndex(b.phase.name))
  return todo[0] ?? null
}

function summarizeOperatorDay(data: ErpData, operatorId: string, date: string, tasks: OperatorProgramTask[]): OperatorDayProgramSummary {
  const logs = (data.production?.workLogs ?? []).filter((log: ProductionWorkLog) => log.operatorId === operatorId && log.startedAt.slice(0, 10) === date)
  const actualMinutes = logs.reduce((sum, log) => sum + Math.max(0, Number(log.totalMinutes ?? 0)), 0)
  const plannedMinutes = tasks.reduce((sum, task) => sum + task.plannedMinutes, 0)
  const workingMinutes = workingMinutesForDate(date, data.plannerSettings, data.plannerSettings.operators.find((operator) => operator.id === operatorId))
  const completedPlannedMinutes = logs.reduce((sum, log) => {
    const task = tasks.find((item) => item.jobId === log.vehicleId || (item.vehicleId === log.vehicleId && item.phaseName === log.phase))
    return sum + Math.max(0, Number(task?.plannedMinutes ?? 0))
  }, 0)
  return {
    plannedMinutes,
    actualMinutes,
    differenceMinutes: actualMinutes - plannedMinutes,
    overtimeMinutes: Math.max(0, actualMinutes - workingMinutes),
    advancedMinutes: tasks.filter((task) => task.isAdvancedFromFuture).reduce((sum, task) => sum + task.plannedMinutes, 0),
    completedPlannedMinutes,
    efficiencyPercent: actualMinutes > 0 ? round((completedPlannedMinutes / actualMinutes) * 100) : 0,
  }
}

export function generateOperatorPrograms(data: ErpData, date = todayKey(), reason = 'Ricalcolo automatico', nowIso?: string): OperatorProgramResult {
  const now = nowIso ?? new Date().toISOString()
  const effectiveDate = planningDateFloor(date, nowIso)
  const schedulingFloor = planningInstantFloor(date, nowIso)
  const revision = Number(data.operatorProgramRevision ?? 0) + 1
  const horizonEndDate = addDays(effectiveDate, 30)
  const operators = data.plannerSettings.operators.filter((operator) => operator.active)
  const vehiclesById = new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const openJobs = (data.jobs ?? []).filter((job) => isJobActive(job) && job.vehicleId)
  const candidates = openJobs
    .map((job, arrivalIndex) => {
      const selectedPhase = selectSchedulablePhase(job)
      if (!selectedPhase) return null
      const vehicle = vehiclesById.get(job.vehicleId ?? '')
      if (!vehicle) return null
      const blocked = isJobBlocked(job) || Boolean(vehicle.blockReason)
      const compatibleCount = operators.filter((operator) => operatorCompatible(operator, selectedPhase.phase)).length
      const score = computePriorityScore({
        job,
        vehicle,
        referenceDate: effectiveDate,
        blocked,
        compatibleCount,
        totalActiveOperators: operators.length,
        readyAt: selectedPhase.readyAt,
        settings: data.plannerSettings,
      })
      const dueToday = Boolean(job.expectedDeliveryDate && job.expectedDeliveryDate <= effectiveDate)
      return {
        job,
        phase: selectedPhase.phase,
        readyAt: selectedPhase.readyAt,
        vehicle,
        blocked,
        dueToday,
        score,
        arrivalIndex,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => {
      if (Number(a.blocked) !== Number(b.blocked)) return Number(a.blocked) - Number(b.blocked)
      if (a.score.tier !== b.score.tier) return a.score.tier - b.score.tier
      if (a.score.dueDate !== b.score.dueDate) return a.score.dueDate.localeCompare(b.score.dueDate)
      if (Number(a.score.started) !== Number(b.score.started)) return Number(b.score.started) - Number(a.score.started)
      if (a.score.score !== b.score.score) return b.score.score - a.score.score
      if (a.score.marginPerHour !== b.score.marginPerHour) return b.score.marginPerHour - a.score.marginPerHour
      if (a.score.totalMargin !== b.score.totalMargin) return b.score.totalMargin - a.score.totalMargin
      return a.readyAt.localeCompare(b.readyAt)
        || a.job.number.localeCompare(b.job.number)
        || a.job.id.localeCompare(b.job.id)
        || a.vehicle.createdAt.localeCompare(b.vehicle.createdAt)
        || a.job.createdAt.localeCompare(b.job.createdAt)
        || a.arrivalIndex - b.arrivalIndex
    })

  const operatorState = new Map<string, { nextAt: string; tasks: OperatorProgramTask[]; operator: PlannerOperator }>()
  for (const operator of operators) {
    operatorState.set(operator.id, {
      nextAt: nextWorkingInstant(schedulingFloor, data.plannerSettings, operator),
      tasks: [],
      operator,
    })
  }

  for (const item of candidates) {
    if (item.blocked) continue
    const activeAssignments = (item.phase.operatorAssignments ?? []).filter((entry) => entry.activityStatus === 'Attivo' && !entry.endedAt)
    const residual = phaseResidualMinutes(item.phase, now)
    const desiredOperators = Math.max(1, item.job.priority === 'Urgente' || item.dueToday ? 2 : 1)

    const compatible = Array.from(operatorState.values())
      .filter((state) => operatorCompatible(state.operator, item.phase))
      .sort((a, b) => a.nextAt.localeCompare(b.nextAt))
    if (!compatible.length) continue

    const selected = compatible.slice(0, Math.min(desiredOperators, compatible.length))
    const rawReadyAt = nextWorkingInstant(item.readyAt, data.plannerSettings, selected[0]?.operator)
    const readyAt = rawReadyAt < schedulingFloor ? nextWorkingInstant(schedulingFloor, data.plannerSettings, selected[0]?.operator) : rawReadyAt
    const sharedStartAt = selected.reduce((latest, state) => state.nextAt > latest ? state.nextAt : latest, readyAt)
    if (sharedStartAt.slice(0, 10) > horizonEndDate) continue
    const availableToday = selected.map((state) => remainingWorkingMinutesToday(sharedStartAt, data.plannerSettings, state.operator))
    const duration = Math.max(15, Math.min(residual, ...availableToday))
    if (duration <= 0) continue

    const startAt = sharedStartAt
    const endAt = addWorkingMinutes(startAt, duration, data.plannerSettings, selected[0]?.operator)
    const activeNames = activeAssignments.map((entry) => entry.operatorName)
    const isAdvancedFromFuture = Boolean(item.job.expectedDeliveryDate && item.job.expectedDeliveryDate > effectiveDate)
    const phaseLines = (item.job.lines ?? []).filter((line) => String(line.categoryOrPhase ?? '').trim().toLowerCase() === item.phase.name.trim().toLowerCase())
    const panelNames = Array.from(new Set(phaseLines.map((line) => String(line.panelName ?? '').trim()).filter(Boolean)))
    const panelNotes = Array.from(new Set(phaseLines.map((line) => String(line.panelWorkNote ?? '').trim()).filter(Boolean)))

    for (const state of selected) {
      const operatorName = state.operator.name.trim() || 'Operatore'
      const task: OperatorProgramTask = {
        id: crypto.randomUUID(),
        operatorId: state.operator.id,
        operatorName,
        vehicleId: item.vehicle.id,
        plate: item.vehicle.plate,
        jobId: item.job.id,
        jobNumber: item.job.number,
        phaseId: item.phase.id,
        phaseName: item.phase.name,
        startAt,
        endAt,
        plannedMinutes: duration,
        priority: item.job.priority,
        reason: reasonForAssignment(item.job, item.dueToday, activeNames.includes(operatorName), selected.length > 1, isAdvancedFromFuture),
        panelNames,
        panelNotes,
        originalPlannedDate: item.job.expectedDeliveryDate,
        scheduleDeltaMinutes: item.job.expectedDeliveryDate && item.job.expectedDeliveryDate > effectiveDate ? Math.max(0, calendarMinutesBetween(dayStartIso(effectiveDate), dayStartIso(item.job.expectedDeliveryDate))) : 0,
        isAdvancedFromFuture,
        overtimeMinutes: Math.max(0, calendarMinutesBetween(startAt, endAt) - duration),
        revision,
      }
      state.tasks.push(task)
      state.nextAt = endAt
    }
  }

  const grouped = new Map<string, { operator: PlannerOperator; date: string; tasks: OperatorProgramTask[] }>()
  for (const state of operatorState.values()) {
    grouped.set(`${state.operator.id}|${effectiveDate}`, { operator: state.operator, date: effectiveDate, tasks: [] })
    for (const task of state.tasks) {
      const taskDate = task.startAt.slice(0, 10)
      const key = `${state.operator.id}|${taskDate}`
      const existing = grouped.get(key) ?? { operator: state.operator, date: taskDate, tasks: [] }
      existing.tasks.push(task)
      grouped.set(key, existing)
    }
  }

  const programs: OperatorDayProgram[] = Array.from(grouped.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.operator.name.localeCompare(b.operator.name, 'it-IT'))
    .map((entry) => ({
      date: entry.date,
      operatorId: entry.operator.id,
      operatorName: entry.operator.name,
      tasks: [...entry.tasks].sort(taskSort),
      generatedAt: now,
      revision,
      summary: summarizeOperatorDay(data, entry.operator.id, entry.date, entry.tasks),
    }))

  return {
    programs,
    historyEntry: {
      id: crypto.randomUUID(),
      date: effectiveDate,
      generatedAt: now,
      revision,
      reason,
      programs,
    },
  }
}

export function recalculateOperatorPrograms(data: ErpData, date = todayKey(), reason = 'Ricalcolo automatico', nowIso?: string): ErpData {
  // Keep automatic recalculation deterministic for identical inputs.
  const runtimeNow = nowIso
  const generated = generateOperatorPrograms(data, date, reason, runtimeNow)
  const current = data.operatorPrograms ?? []
  if (samePrograms(current, generated.programs)) return data
  const moved = movedJobCount(current, generated.programs)
  const reasonWithMovement = moved > 0
    ? `${generated.historyEntry.reason} · commesse ripianificate: ${moved}`
    : generated.historyEntry.reason
  const history = [{ ...generated.historyEntry, reason: reasonWithMovement, previousPrograms: current }, ...(data.operatorProgramHistory ?? [])].slice(0, 200)
  return {
    ...data,
    operatorPrograms: generated.programs,
    operatorProgramHistory: history,
    operatorProgramRevision: generated.historyEntry.revision,
  }
}

export function nextTaskForOperator(data: ErpData, operatorId: string, atIso = new Date().toISOString()) {
  const date = atIso.slice(0, 10)
  const program = (data.operatorPrograms ?? []).find((item) => item.date === date && item.operatorId === operatorId)
  if (!program) return null
  const current = program.tasks.find((task) => task.startAt <= atIso && task.endAt >= atIso)
  if (current) return current
  return program.tasks.find((task) => task.startAt > atIso) ?? null
}

export function simulateEstimateProductionForecast(
  data: ErpData,
  input: {
    vehicleId?: string
    plate: string
    priority?: RepairJob['priority']
    requestedDeliveryDate?: string
    lines: EstimateLine[]
    referenceDate?: string
  },
): EstimateProductionSimulation {
  const referenceDate = input.referenceDate ?? todayKey()
  const priority = input.priority ?? 'Normale'
  const requestedDeliveryDate = input.requestedDeliveryDate?.trim() || undefined
  const productiveDurationMinutes = Math.max(0, estimateVehicleTotalMinutes(input.lines))
  const syntheticVehicleId = input.vehicleId || `forecast-${input.plate || 'vehicle'}`
  const baseVehicle = input.vehicleId ? data.vehicles.find((vehicle) => vehicle.id === input.vehicleId) : undefined
  const simulatedVehicle: Vehicle = {
    ...(baseVehicle ?? {
      id: syntheticVehicleId,
      customerId: '',
      plate: input.plate.trim().toUpperCase(),
      make: '',
      model: '',
      color: '',
      year: '',
      vin: '',
      mileage: '',
      status: 'Confermata',
      coneNumber: null,
      estimatedHours: 0,
      workedHours: 0,
      plannedEntryDate: referenceDate,
      requestedDeliveryDate: requestedDeliveryDate ?? '',
      calculatedDeliveryDate: '',
      expectedRevenue: 0,
      expectedMargin: 0,
      partsStatus: 'Disponibili',
      blockReason: '',
      manualPlanningDate: '',
      createdAt: new Date().toISOString(),
    }),
    id: syntheticVehicleId,
    plate: input.plate.trim().toUpperCase(),
    priority,
    status: 'Confermata',
    blockReason: '',
    partsStatus: 'Disponibili',
    estimatedHours: round(productiveDurationMinutes / 60),
    workedHours: 0,
    plannedEntryDate: referenceDate,
    requestedDeliveryDate: requestedDeliveryDate ?? baseVehicle?.requestedDeliveryDate ?? '',
    manualPlanningDate: referenceDate,
  }

  const plannerVehicles = data.vehicles.filter((vehicle) => vehicle.id !== simulatedVehicle.id)
  const baselinePlannerResult = calculatePlanner(plannerVehicles, data.plannerSettings, referenceDate)
  const baselineByVehicle = new Map(baselinePlannerResult.vehicles.map((item) => [item.vehicleId, item.calculatedDeliveryDate]))
  const plannerResult = calculatePlanner([...plannerVehicles, simulatedVehicle], data.plannerSettings, referenceDate)
  const plan = plannerResult.vehicles.find((vehicle) => vehicle.vehicleId === simulatedVehicle.id)
  const firstAvailabilityDate = plan?.assignments[0]?.date || referenceDate
  const basePrograms = (data.operatorPrograms ?? []).filter((program) => program.date >= firstAvailabilityDate)
  const occupiedUntil = new Map<string, string>()
  for (const program of basePrograms) {
    for (const task of program.tasks ?? []) {
      const current = occupiedUntil.get(program.operatorId)
      if (!current || current < task.endAt) occupiedUntil.set(program.operatorId, task.endAt)
    }
  }

  const phasePlans: SimulatedPhaseForecast[] = []
  const phaseSequence = estimatedPhaseSequence(input.lines)
  const activeOperators = data.plannerSettings.operators.filter((operator) => operator.active)
  let dependencyCursor = nextWorkingInstant(`${firstAvailabilityDate}T08:00:00.000Z`, data.plannerSettings)
  let compatibleOperatorsFound = true

  for (const phase of phaseSequence) {
    const compatible = activeOperators.filter((operator) => operatorSupportsPhase(operator, phase.phaseName))
    if (!compatible.length) {
      compatibleOperatorsFound = false
      continue
    }
    const neededOperators = Math.min(desiredOperatorCount(priority, requestedDeliveryDate, referenceDate), compatible.length)
    const candidates = compatible
      .map((operator) => {
        const busyUntil = occupiedUntil.get(operator.id)
        const earliest = busyUntil && busyUntil > dependencyCursor ? busyUntil : dependencyCursor
        const nextAt = nextWorkingInstant(earliest, data.plannerSettings, operator)
        return { operator, nextAt }
      })
      .sort((a, b) => a.nextAt.localeCompare(b.nextAt) || a.operator.name.localeCompare(b.operator.name, 'it-IT'))

    const selected = candidates.slice(0, Math.min(neededOperators, candidates.length))
    const startAt = selected.reduce((latest, entry) => entry.nextAt > latest ? entry.nextAt : latest, dependencyCursor)
    const endAt = addWorkingMinutes(startAt, phase.plannedMinutes, data.plannerSettings, selected[0]?.operator)
    const availableAfter = phase.technicalWaitMinutes > 0 ? new Date(new Date(endAt).getTime() + phase.technicalWaitMinutes * 60_000).toISOString() : endAt
    for (const entry of selected) occupiedUntil.set(entry.operator.id, endAt)
    phasePlans.push({
      phaseName: phase.phaseName,
      plannedMinutes: phase.plannedMinutes,
      technicalWaitMinutes: phase.technicalWaitMinutes,
      operatorIds: selected.map((entry) => entry.operator.id),
      operatorNames: selected.map((entry) => entry.operator.name),
      startAt,
      endAt,
      availableAfter,
    })
    dependencyCursor = availableAfter
  }

  const bufferMode = data.plannerSettings.deliveryBufferMode === 'hours' ? 'hours' : 'percent'
  const bufferValue = Math.max(0, Number(data.plannerSettings.deliveryBufferValue ?? 0))
  const technicalCompletionAt = phasePlans.at(-1)?.endAt || nextWorkingInstant(`${firstAvailabilityDate}T08:00:00.000Z`, data.plannerSettings)
  const bufferMinutes = bufferMode === 'hours' ? Math.round(bufferValue * 60) : Math.round(productiveDurationMinutes * (bufferValue / 100))
  const advisedDeliveryAt = addWorkingMinutes(technicalCompletionAt, bufferMinutes, data.plannerSettings)
  const advisedDeliveryDate = advisedDeliveryAt.slice(0, 10)
  const requestedDeliveryCompatible = requestedDeliveryDate ? requestedDeliveryDate >= advisedDeliveryDate : undefined
  const workshopLoadPercent = plan?.assignments.length ? capacityWithAssignments(firstAvailabilityDate, data.plannerSettings, plannerResult.assignments).saturation : 0
  const reliability = reliabilityFromSimulation({
    phasePlans,
    workshopLoadPercent,
    requestedDeliveryCompatible,
    compatibleOperatorsFound,
    productiveDurationMinutes,
  })
  const estimatedStartAt = phasePlans[0]?.startAt || nextWorkingInstant(`${firstAvailabilityDate}T08:00:00.000Z`, data.plannerSettings)
  const withSimulationByVehicle = new Map(plannerResult.vehicles.map((item) => [item.vehicleId, item.calculatedDeliveryDate]))
  let movedJobs = 0
  let delayedJobs = 0
  let delayedUrgentOrPromisedJobs = 0
  for (const vehicle of plannerVehicles) {
    const before = baselineByVehicle.get(vehicle.id)
    const after = withSimulationByVehicle.get(vehicle.id)
    if (!before || !after || before === after) continue
    movedJobs += 1
    if (after > before) {
      delayedJobs += 1
      if (vehicle.priority === 'Urgente' || Boolean(vehicle.requestedDeliveryDate)) delayedUrgentOrPromisedJobs += 1
    }
  }
  const impactSummary = delayedJobs === 0
    ? 'Nessuna commessa ripianificata in ritardo.'
    : `Ripianificate ${delayedJobs} commesse (${delayedUrgentOrPromisedJobs} urgenti/promesse).`

  return {
    firstAvailabilityDate,
    estimatedStartAt,
    technicalCompletionAt,
    advisedDeliveryDate,
    productiveDurationMinutes,
    calendarDurationMinutes: calendarMinutesBetween(estimatedStartAt, technicalCompletionAt),
    workshopLoadPercent,
    reliability,
    calculatedAt: new Date().toISOString(),
    requestedDeliveryDate,
    requestedDeliveryCompatible,
    plannerImpact: {
      movedJobs,
      delayedJobs,
      delayedUrgentOrPromisedJobs,
      summary: impactSummary,
    },
    phasePlans,
  }
}
