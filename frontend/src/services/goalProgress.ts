import { finalizedJobCosts } from './finalizedJobCosts'
import type { ErpData } from '../types'
import { closedJobPartsCost, closedJobMargin, jobOtherDirectCost, operatorHourlyCost, recordedPhaseLabor } from './closedJobMargin'
import { deliveredWorkPhases } from './deliveredJobReport'
import { historicalRevenues, isRealizedInvoice } from './historicalActuals'
import { calculateJobMaterialMargin } from './jobMaterialCosts'
import type { VehicleWork } from './productionPlanningState'
import { isVehicleStatusSemantic } from './vehicleStatuses'
import { addDays, isWorkingDate, workingMinutesForDate } from './workCalendar'

const romeDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayOf = (timestamp?: string) => timestamp && Number.isFinite(Date.parse(timestamp))
  ? romeDate.format(new Date(timestamp)) : undefined
const federicaOfficeMinutes = 4 * 60
const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100)

export function goalWeekStart(date: string) {
  return addDays(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7))
}

export function calculateGoalProgress(data: ErpData, today = romeDate.format(new Date()), vehicleWork?: readonly VehicleWork[],
  selection?: { day?: string; week?: string }) {
  const settings = data.plannerSettings
  const month = today.slice(0, 7)
  const monthGoal = Math.max(0, settings.monthlyMarginGoal ?? 0)
  const day = selection?.day ?? today
  const monday = goalWeekStart(selection?.week ?? today)
  const week = Array.from({ length: 7 }, (_, index) => addDays(monday, index))
  const weekEnd = week[6] < today ? week[6] : today
  const operators = settings.operators.filter(operator => operator.active)
  const capacity = (date: string) => operators.length
    ? operators.reduce((sum, operator) => sum + workingMinutesForDate(date, settings, operator), 0)
    : Number(isWorkingDate(date, settings))
  const monthCapacity = new Map<string, number>()
  const dailyGoal = (date: string) => {
    const monthKey = date.slice(0, 7)
    const target = monthKey === month ? monthGoal
      : Math.max(0, settings.monthlyGoalHistory?.find(record => record.monthKey === monthKey)?.marginGoal ?? 0)
    if (target === 0) return 0
    if (!monthCapacity.has(monthKey)) {
      const [year, monthNumber] = monthKey.split('-').map(Number)
      const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
      monthCapacity.set(monthKey, Array.from({ length: days }, (_, index) => capacity(addDays(monthKey + '-01', index))).reduce((a, b) => a + b, 0))
    }
    const total = monthCapacity.get(monthKey) ?? 0
    return total > 0 ? target * capacity(date) / total : 0
  }

  const production: Array<{ date: string; marginCents: number | null; provisional: boolean; internalLaborCents: number; producedCents: number }> = []
  const vehicles = new Map(data.vehicles.map(vehicle => [vehicle.id, vehicle]))
  const jobsByVehicle = new Map<string, number>()
  for (const job of data.jobs ?? []) {
    if (job.vehicleId) jobsByVehicle.set(job.vehicleId, (jobsByVehicle.get(job.vehicleId) ?? 0) + 1)
  }
  const internalIds = new Set(settings.operators.filter(op => op.costMode !== 'external-extra' && !op.isOwner).map(op => op.id))
  for (const job of data.jobs ?? []) {
    const vehicle = job.vehicleId ? vehicles.get(job.vehicleId) : undefined
    if (job.status === 'Annullata' || (vehicle && isVehicleStatusSemantic(settings, vehicle.status, 'cancelled'))) continue
    const uniqueVehicleJob = vehicle && jobsByVehicle.get(vehicle.id) === 1
    const vehicleDelivery = uniqueVehicleJob && isVehicleStatusSemantic(settings, vehicle.status, 'delivered')
      ? dayOf(vehicle.deliveredAt) : undefined
    const matchingDelivery = vehicleDelivery && vehicleDelivery >= job.entryDate ? vehicleDelivery : undefined
    const deliveryDate = job.status === 'Consegnata' ? dayOf(job.deliveredAt) ?? matchingDelivery : matchingDelivery
    const closure = finalizedJobCosts(job,vehicle,data.jobs??[],settings)
    const finalized = closure.finalized
    const accountingDate = deliveryDate ?? (finalized ? closure.date : undefined)
    const materials = calculateJobMaterialMargin(job)
    const costs = closure.costs
    const materialCost = materials.actualMaterials ?? costs?.materials ?? (finalized ? undefined : materials.estimatedMaterials)
    const { partsCents, partsEstimated } = closedJobPartsCost(job, costs?.parts)
    const other = jobOtherDirectCost(job, costs?.other, finalized)
    const provisional = materials.actualMaterials === null && costs?.materials === undefined || partsEstimated || other.estimated
    const netBeforeLabor = Number.isFinite(job.taxableAmount) && partsCents !== null && (!finalized || !partsEstimated) && materialCost !== undefined && Number.isFinite(materialCost) && other.cents !== null
      ? cents(job.taxableAmount) - partsCents - cents(materialCost) - other.cents : null
    const phases = deliveredWorkPhases(job)
    const sharedCounts = new Map<string, number>()
    for (const phase of phases) {
      if (phase.sharedTimeKey && !phase.notRequired) sharedCounts.set(phase.sharedTimeKey, (sharedCounts.get(phase.sharedTimeKey) ?? 0) + 1)
    }
    const weights = phases.map(phase => phase.notRequired ? 0 : Math.max(0, phase.sharedTimeKey && phase.sharedTimeMinutes !== undefined
      ? phase.sharedTimeMinutes / (sharedCounts.get(phase.sharedTimeKey) ?? 1) : phase.estimatedMinutes || 0))
    const totalWeight = weights.reduce((a, b) => a + b, 0)
    let creditedMargin = 0
    let creditedInternalLabor = 0
    let creditedRevenue = 0
    const revenueCents = Number.isFinite(job.taxableAmount) ? cents(job.taxableAmount) : 0
    phases.forEach((phase, index) => {
      const date = phase.status === 'Completata' ? dayOf(phase.completedAt || phase.endedAt) : undefined
      if (!date || date > today || (deliveryDate && date > deliveryDate)) return
      const labor = recordedPhaseLabor(phase, settings.operators)
      const laborCents = labor.complete
        ? cents(labor.workers.reduce((sum, worker) => sum + worker.seconds / 3600 * (worker.rate ?? 0), 0))
        : null
      const marginCents = netBeforeLabor !== null && laborCents !== null
        ? Math.round(totalWeight > 0 ? netBeforeLabor * weights[index] / totalWeight : 0) - laborCents
        : null
      const producedCents = phase.completedByName === 'Ufficio · Consegna' || totalWeight === 0
        ? 0 : Math.min(revenueCents - creditedRevenue, Math.round(revenueCents * weights[index] / totalWeight))
      creditedRevenue += producedCents
      creditedMargin += marginCents ?? 0
      const internalLaborCents = marginCents === null ? 0 : cents(labor.workers.filter(worker => internalIds.has(worker.id)).reduce((sum, worker) => sum + worker.seconds / 3600 * (worker.rate ?? 0), 0))
      creditedInternalLabor += internalLaborCents
      production.push({ date, marginCents, provisional: provisional || !finalized, internalLaborCents, producedCents })
    })
    if (accountingDate && accountingDate <= today) {
      const closed = closedJobMargin(job, settings.operators, costs?.materials, costs?.parts, finalized)
      const marginCents = closed.marginCents === null || other.cents === null ? null : closed.marginCents - other.cents - creditedMargin
      const internalLaborCents = marginCents === null ? 0 : closed.operatorLabor.filter(worker => internalIds.has(worker.id)).reduce((sum, worker) => sum + (worker.costCents ?? 0), 0) - creditedInternalLabor
      production.push({ date: accountingDate, marginCents, provisional, internalLaborCents, producedCents: revenueCents - creditedRevenue })
    }
  }
  const federica = operators.filter(operator => operator.name.trim().toLowerCase() === 'federica')
  const vehicleSeconds = new Map<string, number>()
  for (const entry of data.historicalActuals ?? []) {
    if (entry.kind === 'hours' && Number.isFinite(entry.productiveSeconds) && entry.productiveSeconds >= 0) {
      vehicleSeconds.set(`${entry.operatorId}/${entry.date}`, entry.productiveSeconds)
    }
  }
  for (const entry of vehicleWork ?? []) {
    if (Number.isFinite(entry.seconds) && entry.seconds >= 0) {
      vehicleSeconds.set(`${entry.operatorId}/${entry.date}`, entry.seconds)
    }
  }
  const currentCalendar = { ...settings, operatorDayExtensions: [] }
  const currentWeekStart = goalWeekStart(today)
  const liveWorkStart = currentWeekStart < month + '-01' ? currentWeekStart : month + '-01'
  const outsideCosts: Array<{ date: string; seconds: number | null; costCents: number | null; internal: boolean }> = []
  const intervals = [[day, day], [monday, weekEnd], [month + '-01', today]]
  const periodDays = new Set<string>()
  for (const [start, end] of intervals) {
    for (let date = start; date <= end; date = addDays(date, 1)) periodDays.add(date)
  }
  for (const date of periodDays) {
    for (const operator of federica) {
      const productionMinutes = workingMinutesForDate(date, currentCalendar, operator)
      if (productionMinutes <= 0) continue
      const recorded = vehicleSeconds.get(`${operator.id}/${date}`)
      const seconds = recorded === undefined && (vehicleWork === undefined || date < liveWorkStart)
        ? null : federicaOfficeMinutes * 60 + Math.max(0, productionMinutes * 60 - (recorded ?? 0))
      const rate = operatorHourlyCost(operator)
      const costCents = seconds === null || (seconds > 0 && rate === null)
        ? null : cents(seconds / 3600 * (rate ?? 0))
      outsideCosts.push({ date, seconds, costCents, internal: operator.costMode !== 'external-extra' && !operator.isOwner })
    }
  }
  const billed = [
    ...data.invoices.filter(isRealizedInvoice).map(invoice => ({ date: invoice.issueDate, amount: invoice.taxableAmount || 0 })),
    ...historicalRevenues(data),
  ]
  const period = (label: string, start: string, goal: number, end = today) => {
    const includes = (date: string) => date >= start && date <= end
    const recognized = production.filter(entry => includes(entry.date))
    const expenses = outsideCosts.filter(entry => includes(entry.date))
    const offVehicleCostCents = expenses.reduce((sum, entry) => sum + (entry.costCents ?? 0), 0)
    const recognizedInternalLabor = (recognized.reduce((sum, entry) => sum + entry.internalLaborCents, 0) + expenses.filter(entry => entry.internal).reduce((sum, entry) => sum + (entry.costCents ?? 0), 0)) / 100
    const payrollActual = label === 'Mese' ? [...(settings.monthlyPayrollActuals ?? [])].filter(entry => entry.monthKey === month && Number.isFinite(entry.amount) && entry.amount >= 0).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0] : undefined
    const payrollAdjustment = payrollActual ? cents(payrollActual.amount - recognizedInternalLabor) / 100 : 0
    const done = (recognized.reduce((sum, entry) => sum + (entry.marginCents ?? 0), 0) - offVehicleCostCents) / 100 - payrollAdjustment
    const offVehicleTimeIncomplete = expenses.some(entry => entry.seconds === null)
    const offVehicleCostIncomplete = expenses.some(entry => entry.costCents === null)
    const incomplete = recognized.some(entry => entry.marginCents === null) || offVehicleCostIncomplete
    const provisional = recognized.some(entry => entry.marginCents !== null && entry.provisional)
    const hasMargin = !incomplete || recognized.some(entry => entry.marginCents !== null) || offVehicleCostCents > 0
    const invoiced = billed.reduce((sum, entry) => includes(entry.date) ? sum + entry.amount : sum, 0)
    const target = cents(goal) / 100
    const produced = recognized.reduce((sum, entry) => sum + entry.producedCents, 0) / 100
    const revenueGoal = label === 'Mese' ? Math.max(0, settings.monthlyRevenueGoal || 0) : null
    return { label, produced, revenueGoal, recognizedInternalLabor, payrollActual: payrollActual?.amount, payrollAdjustment, goal: target, done, billed: cents(invoiced) / 100, incomplete, provisional, hasMargin,
      offVehicleHours: expenses.reduce((sum, entry) => sum + (entry.seconds ?? 0), 0) / 3600,
      offVehicleCost: offVehicleCostCents / 100, offVehicleCostIncomplete, offVehicleTimeIncomplete,
      gap: Math.max(0, cents(target - done)) / 100, percent: target > 0 && !incomplete ? 100 * done / target : null }
  }
  // The current day's and week's remaining targets must absorb the entire
  // outstanding monthly margin, weighted by the remaining scheduled capacity.
  // Historical periods keep their original budget allocation for comparison.
  const monthlyProgress = period('Mese', month + '-01', monthGoal)
  const remainingMargin = Math.max(0, monthGoal - monthlyProgress.done)
  const [year, monthNumber] = month.split('-').map(Number)
  const monthEnd = month + '-' + String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')
  const remainingCapacity = (start: string, end: string) => {
    let minutes = 0
    for (let date = start; date <= end; date = addDays(date, 1)) minutes += capacity(date)
    return minutes
  }
  const monthMinutesLeft = remainingCapacity(today, monthEnd)
  const share = (start: string, end: string) =>
    monthMinutesLeft > 0 && start <= end
      ? remainingMargin * remainingCapacity(start, end) / monthMinutesLeft : 0
  const todayActual = period('Oggi', today, 0, today).done
  const weekActual = period('Settimana', monday, 0, weekEnd).done
  const currentDayGoal = day === today && monthMinutesLeft > 0
    ? todayActual + share(today, today) : dailyGoal(day)
  const currentWeekGoal = monday === goalWeekStart(today) && monthMinutesLeft > 0
    ? weekActual + share(today, week[6] < monthEnd ? week[6] : monthEnd)
    : week.reduce((sum, date) => sum + dailyGoal(date), 0)
  return [
    period('Oggi', day, currentDayGoal, day),
    period('Settimana', monday, currentWeekGoal, weekEnd),
    monthlyProgress,
  ]
}

/** Remaining monthly margin split into calendar weeks, using the same operator capacity
 * as the current goal card. Rounding is reconciled in the final week. */
export function remainingWeeklyMarginGoals(data: ErpData, today: string, remainingMargin: number) {
  const settings = data.plannerSettings
  const operators = settings.operators.filter(operator => operator.active)
  const capacity = (day: string) => operators.length
    ? operators.reduce((sum, operator) => sum + workingMinutesForDate(day, settings, operator), 0)
    : Number(isWorkingDate(day, settings))
  const monthKey = today.slice(0, 7)
  const [year, monthNumber] = monthKey.split('-').map(Number)
  const monthEnd = monthKey + '-' + String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')
  const weeks: Array<{ start: string; end: string; minutes: number; amount: number }> = []
  for (let start = today; start <= monthEnd;) {
    const sunday = addDays(goalWeekStart(start), 6)
    const end = sunday < monthEnd ? sunday : monthEnd
    let minutes = 0
    for (let day = start; day <= end; day = addDays(day, 1)) minutes += capacity(day)
    weeks.push({ start, end, minutes, amount: 0 })
    start = addDays(end, 1)
  }
  const totalMinutes = weeks.reduce((sum, week) => sum + week.minutes, 0)
  const remainingCents = Math.round(Math.max(0, remainingMargin) * 100)
  if (totalMinutes > 0) {
    let allocated = 0
    weeks.forEach((week, index) => {
      const cents = index === weeks.length - 1 ? remainingCents - allocated
        : Math.round(remainingCents * week.minutes / totalMinutes)
      allocated += cents
      week.amount = cents / 100
    })
  }
  return { weeks, totalMinutes, unallocated: totalMinutes > 0 ? 0 : remainingCents / 100 }
}
