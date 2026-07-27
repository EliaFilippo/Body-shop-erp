import type { PlannerSettings, Vehicle } from '../types'
import { addDays, isWorkingDay, remainingHours, todayKey } from './planner'

export interface EconomicSummary {
  goal: number
  plannedRevenue: number
  plannedMargin: number
  reachedPercent: number
  missingRevenue: number
  remainingWorkingDays: number
  dailyRevenueNeeded: number
  productiveHoursNeeded: number | null
  sufficient: boolean
}

const round = (value: number) => Math.round(value * 100) / 100

export function calculateEconomicSummary(
  vehicles: Vehicle[],
  settings: PlannerSettings,
  referenceDate = todayKey(),
): EconomicSummary {
  const month = referenceDate.slice(0, 7)
  const scheduled = vehicles.filter((vehicle) =>
    vehicle.status !== 'Consegnata'
    && (vehicle.plannedEntryDate || vehicle.calculatedDeliveryDate || referenceDate).startsWith(month),
  )
  const plannedRevenue = scheduled.reduce((sum, vehicle) => sum + (vehicle.expectedRevenue || 0), 0)
  const plannedMargin = scheduled.reduce((sum, vehicle) => sum + (vehicle.expectedMargin || 0), 0)
  const goal = Math.max(0, settings.monthlyRevenueGoal)
  const missingRevenue = Math.max(0, goal - plannedRevenue)
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`
  let remainingWorkingDays = 0
  for (let date = referenceDate; date <= monthEnd; date = addDays(date, 1)) {
    if (isWorkingDay(date, settings)) remainingWorkingDays += 1
  }
  const totalHours = scheduled.reduce((sum, vehicle) => sum + remainingHours(vehicle), 0)
  const hourlyRevenue = totalHours > 0 ? plannedRevenue / totalHours : 0
  return {
    goal,
    plannedRevenue: round(plannedRevenue),
    plannedMargin: round(plannedMargin),
    reachedPercent: goal ? round(plannedRevenue / goal * 100) : 0,
    missingRevenue: round(missingRevenue),
    remainingWorkingDays,
    dailyRevenueNeeded: remainingWorkingDays ? round(missingRevenue / remainingWorkingDays) : missingRevenue,
    productiveHoursNeeded: hourlyRevenue > 0 ? round(missingRevenue / hourlyRevenue) : null,
    sufficient: goal > 0 && plannedRevenue >= goal,
  }
}

export function vehicleEconomicImpact(
  before: Vehicle[],
  after: Vehicle[],
  settings: PlannerSettings,
  referenceDate = todayKey(),
) {
  const previous = calculateEconomicSummary(before, settings, referenceDate)
  const next = calculateEconomicSummary(after, settings, referenceDate)
  return {
    addedRevenue: Math.max(0, next.plannedRevenue - previous.plannedRevenue),
    addedMargin: Math.max(0, next.plannedMargin - previous.plannedMargin),
    newReachedPercent: next.reachedPercent,
    sufficient: next.sufficient,
  }
}
