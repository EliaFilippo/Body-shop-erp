import type { ErpData } from '../types'
import { calculateGoalProgress } from './goalProgress'
import { monthlyTargetRate } from './monthlyTargetRate'
import { addDays, isWorkingDate, workingMinutesForDate } from './workCalendar'
import { resolveInternalHourlyRate } from './workflow'

const romeDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
const round = (amount: number) => Math.round(amount * 100) / 100

export function marginTargetRate(data: ErpData, monthKey: string, today = romeDate.format(new Date()), monthProgress?: Pick<ReturnType<typeof calculateGoalProgress>[number], 'done' | 'incomplete'>) {
  const settings = data.plannerSettings
  const monthGoal = Math.max(0, settings.monthlyMarginGoal ?? 0)
  if (!monthGoal || monthKey !== today.slice(0, 7)) return null
  const nightly = data.nightlyPlanning?.economics
  const baseline = monthlyTargetRate(settings, monthKey)
  const progress = monthProgress ?? calculateGoalProgress(data, today)[2]
  const remainingMargin = round(Math.max(0, monthGoal - progress.done))
  const hourlyCost = resolveInternalHourlyRate(settings).effectiveHourlyRate
  const materialsPercent = Math.min(100, Math.max(0, settings.internalCostSettings?.budgetMaterialsPercent ?? 20))
  const activeOperators = settings.operators.filter(operator => operator.active)
  let monthlyMinutes = 0
  let remainingMinutes = 0
  let externalCostByMinute = 0
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
      if (operator.costMode === 'external-extra') {
        externalCostByMinute += minutes * Math.max(0, operator.externalHourlyCost ?? operator.hourlyCost ?? 0)
      }
    }
  }
  const hasCurrentForecast = nightly?.monthKey === monthKey && nightly.plannedFor === today
  const hours = hasCurrentForecast ? nightly.remainingProductiveHours
    : monthlyMinutes > 0 ? round(baseline.hours * remainingMinutes / monthlyMinutes) : 0
  const externalHourlyCost = remainingMinutes > 0 ? externalCostByMinute / remainingMinutes : 0
  const hourlyRate = hourlyCost > 0 && hours > 0 && materialsPercent < 100
    ? Math.ceil((hourlyCost + externalHourlyCost + remainingMargin / hours) / (1 - materialsPercent / 100) * 100) / 100 : null
  return {
    monthGoal, remainingMargin, hours, hourlyRate, hourlyCost, externalHourlyCost, materialsPercent,
    partial: progress.incomplete,
  }
}
