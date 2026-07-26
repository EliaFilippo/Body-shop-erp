import type {
  PlannerAssignment,
  PlannerSettings,
  Vehicle,
} from '../types'

const DAY_MS = 86_400_000
const round = (value: number) => Math.round(value * 100) / 100

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

export const dateKey = (date: Date) => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const parseDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export const addDays = (value: string, days: number) =>
  dateKey(new Date(parseDate(value).getTime() + days * DAY_MS))

export const todayKey = () => dateKey(new Date())

export const remainingHours = (vehicle: Vehicle) =>
  Math.max(0, round((vehicle.estimatedHours || 0) - (vehicle.workedHours || 0)))

function dateInRange(date: string, start: string, end: string) {
  return date >= start && date <= end
}

export function isWorkingDay(date: string, settings: PlannerSettings) {
  const day = parseDate(date).getUTCDay()
  return settings.workingDays.includes(day)
    && !settings.holidays.includes(date)
    && !settings.closures.includes(date)
}

export function calculateDayCapacity(date: string, settings: PlannerSettings): DayCapacity {
  if (!isWorkingDay(date, settings)) {
    return { date, nominal: 0, normal: 0, protected: 0, committed: 0, remaining: 0, overload: 0, saturation: 0 }
  }
  const nominal = settings.operators
    .filter((operator) => operator.active)
    .reduce((total, operator) => {
      const absence = settings.absences.find((entry) =>
        entry.operatorId === operator.id && dateInRange(date, entry.startDate, entry.endDate),
      )
      const unavailable = absence ? absence.hoursPerDay ?? operator.dailyHours : 0
      return total + Math.max(0, operator.dailyHours - unavailable)
    }, 0)
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

function priorityValue(vehicle: Vehicle) {
  return { Urgente: 0, Alta: 1, Normale: 2 }[vehicle.priority ?? 'Normale']
}

export function sortPlanningVehicles(vehicles: Vehicle[]) {
  return [...vehicles].sort((a, b) => {
    const aBlocked = Boolean(a.blockReason) || a.partsStatus === 'Mancanti'
    const bBlocked = Boolean(b.blockReason) || b.partsStatus === 'Mancanti'
    return Number(aBlocked) - Number(bBlocked)
      || priorityValue(a) - priorityValue(b)
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

export function calculatePlanner(vehicles: Vehicle[], settings: PlannerSettings, referenceDate = todayKey()): PlannerResult {
  const active = sortPlanningVehicles(vehicles.filter((vehicle) =>
    vehicle.status !== 'Consegnata' && remainingHours(vehicle) > 0,
  ))
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
    const protectedPlan = allocate(vehicle, settings, protectedUsage, true, referenceDate)
    const normalPlan = allocate(vehicle, settings, normalUsage, false, referenceDate)
    const requested = vehicle.requestedDeliveryDate
    let status: TrafficStatus = 'neutral'
    if (requested) {
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
      delayWorkingDays: status === 'red' && requested
        ? workingDaysBetween(requested, normalPlan.delivery, settings)
        : 0,
      suggestedDate: normalPlan.delivery,
      assignments: protectedPlan.assignments,
      blocked: false,
    })
  }
  const assignments = results.flatMap((result) => result.assignments)
  return { vehicles: results, assignments }
}

export function capacityWithAssignments(
  date: string,
  settings: PlannerSettings,
  assignments: PlannerAssignment[],
): DayCapacity {
  const base = calculateDayCapacity(date, settings)
  const committed = round(assignments.filter((item) => item.date === date).reduce((sum, item) => sum + item.protectedHours, 0))
  const overload = round(Math.max(0, committed - base.protected))
  return {
    ...base,
    committed,
    remaining: round(Math.max(0, base.protected - committed)),
    overload,
    saturation: base.protected ? round(committed / base.protected * 100) : committed ? 100 : 0,
  }
}

export function moveVehicleWork(
  assignments: PlannerAssignment[],
  vehicleId: string,
  date: string,
  settings: PlannerSettings,
) {
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
