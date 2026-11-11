import type { ErpData } from '../types'
import { calculateGoalProgress } from './goalProgress'
import { monthlyTargetRate } from './monthlyTargetRate'
import { addDays, isWorkingDate, workingMinutesForDate } from './workCalendar'
import type { VehicleWork } from './productionPlanningState'
import { operatorHourlyCost } from './closedJobMargin'

const romeDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
const round = (amount: number) => Math.round(amount * 100) / 100

export function marginTargetRate(data: ErpData, monthKey: string, today = romeDate.format(new Date()), monthProgress?: Pick<ReturnType<typeof calculateGoalProgress>[number], 'done' | 'incomplete'>, vehicleWork?: readonly VehicleWork[]) {
  const settings = data.plannerSettings
  const monthGoal = Math.max(0, settings.monthlyMarginGoal ?? 0)
  if (!monthGoal || monthKey !== today.slice(0, 7)) return null
  const nightly = data.nightlyPlanning?.economics
  const baseline = monthlyTargetRate(settings, monthKey)
  const progress = monthProgress ?? calculateGoalProgress(data, today, vehicleWork)[2]
  const remainingMargin = round(Math.max(0, monthGoal - progress.done))
  const materialsPercent = Math.min(100, Math.max(0, settings.internalCostSettings?.budgetMaterialsPercent ?? 20))
  const activeOperators = settings.operators.filter(operator => operator.active)
  let monthlyMinutes = 0
  let remainingMinutes = 0
  let laborCostByMinute = 0
  let ratesComplete = activeOperators.length > 0
  for (let date = monthKey + '-01'; date.slice(0, 7) === monthKey; date = addDays(date, 1)) {
    if (!activeOperators.length) {
      const day = Number(isWorkingDate(date, settings))
      monthlyMinutes += day
      if (date >= today) remainingMinutes += day
      continue
    }
    for (const operator of activeOperators) {
      const minutes = workingMinutesForDate(date, settings, operator)
      monthlyMinutes += minutes
      if (date < today) continue
      remainingMinutes += minutes
      const rate = operatorHourlyCost(operator)
      if (minutes > 0 && rate === null) ratesComplete = false
      laborCostByMinute += minutes * (rate ?? 0)
    }
  }
  const hasCurrentForecast = nightly?.monthKey === monthKey && nightly.plannedFor === today
  const hours = hasCurrentForecast ? nightly.remainingProductiveHours
    : monthlyMinutes > 0 ? round(baseline.hours * remainingMinutes / monthlyMinutes) : 0
  const hourlyCost = remainingMinutes > 0 ? laborCostByMinute / remainingMinutes : 0
  const hourlyRate = ratesComplete && remainingMinutes > 0 && hours > 0 && materialsPercent < 100
    ? Math.ceil((hourlyCost + remainingMargin / hours) / (1 - materialsPercent / 100) * 100) / 100 : null
  return {
    monthGoal, remainingMargin, hours, hourlyRate, hourlyCost, materialsPercent, ratesComplete,
    partial: progress.incomplete,
  }
}
