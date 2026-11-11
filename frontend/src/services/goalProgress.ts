import type { ErpData } from '../types'
import { closedJobPartsCost, closedJobMargin, operatorHourlyCost, recordedPhaseLabor } from './closedJobMargin'
import { deliveredWorkPhases } from './deliveredJobReport'
import { historicalRevenues, isRealizedInvoice } from './historicalActuals'
import { calculateJobMaterialMargin, recordedJobVehicleCosts } from './jobMaterialCosts'
import type { VehicleWork } from './productionPlanningState'
import { isVehicleStatusSemantic } from './vehicleStatuses'
import { addDays, isWorkingDate, workingMinutesForDate } from './workCalendar'

const romeDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayOf = (timestamp?: string) => timestamp && Number.isFinite(Date.parse(timestamp))
  ? romeDate.format(new Date(timestamp)) : undefined
const federicaOfficeMinutes = 4 * 60
const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100)

export function calculateGoalProgress(data: ErpData, today = romeDate.format(new Date()), vehicleWork?: readonly VehicleWork[]) {
  const settings = data.plannerSettings
  const month = today.slice(0, 7)
  const monthGoal = Math.max(0, settings.monthlyMarginGoal ?? 0)
  const monday = addDays(today, -((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7))
  const week = Array.from({ length: 7 }, (_, index) => addDays(monday, index))
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

  const production: Array<{ date: string; marginCents: number | null; provisional: boolean }> = []
  const vehicles = new Map(data.vehicles.map(vehicle => [vehicle.id, vehicle]))
  const jobsByVehicle = new Map<string, number>()
  for (const job of data.jobs ?? []) {
    if (job.vehicleId) jobsByVehicle.set(job.vehicleId, (jobsByVehicle.get(job.vehicleId) ?? 0) + 1)
  }
  for (const job of data.jobs ?? []) {
    const vehicle = job.vehicleId ? vehicles.get(job.vehicleId) : undefined
    if (job.status === 'Annullata' || (vehicle && isVehicleStatusSemantic(settings, vehicle.status, 'cancelled'))) continue
    const uniqueVehicleJob = vehicle && jobsByVehicle.get(vehicle.id) === 1
    const vehicleDelivery = uniqueVehicleJob && isVehicleStatusSemantic(settings, vehicle.status, 'delivered')
      ? dayOf(vehicle.deliveredAt) : undefined
    const matchingDelivery = vehicleDelivery && vehicleDelivery >= job.entryDate ? vehicleDelivery : undefined
    const deliveryDate = job.status === 'Consegnata' ? dayOf(job.deliveredAt) ?? matchingDelivery : matchingDelivery
    const materials = calculateJobMaterialMargin(job)
    const costs = deliveryDate && vehicle ? recordedJobVehicleCosts(vehicle, job, data.jobs ?? [], deliveryDate) : undefined
    const materialCost = materials.actualMaterials ?? costs?.materials ?? materials.estimatedMaterials
    const { partsCents, partsEstimated } = closedJobPartsCost(job, costs?.parts)
    const provisional = materials.actualMaterials === null || partsEstimated
    const netBeforeLabor = Number.isFinite(job.taxableAmount) && partsCents !== null && Number.isFinite(materialCost)
      ? cents(job.taxableAmount) - partsCents - cents(materialCost) : null
    const phases = deliveredWorkPhases(job)
    const sharedCounts = new Map<string, number>()
    for (const phase of phases) {
      if (phase.sharedTimeKey && !phase.notRequired) sharedCounts.set(phase.sharedTimeKey, (sharedCounts.get(phase.sharedTimeKey) ?? 0) + 1)
    }
    const weights = phases.map(phase => phase.notRequired ? 0 : Math.max(0, phase.sharedTimeKey && phase.sharedTimeMinutes !== undefined
      ? phase.sharedTimeMinutes / (sharedCounts.get(phase.sharedTimeKey) ?? 1) : phase.estimatedMinutes || 0))
    const totalWeight = weights.reduce((a, b) => a + b, 0)
    let creditedMargin = 0
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
      creditedMargin += marginCents ?? 0
      production.push({ date, marginCents, provisional: provisional || !deliveryDate })
    })
    if (deliveryDate && deliveryDate <= today) {
      const closed = closedJobMargin(job, settings.operators, materialCost, costs?.parts)
      const marginCents = closed.marginCents === null ? null : closed.marginCents - creditedMargin
      production.push({ date: deliveryDate, marginCents, provisional })
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
  const outsideCosts: Array<{ date: string; seconds: number | null; costCents: number | null }> = []
  for (let date = monday < month + '-01' ? monday : month + '-01'; date <= today; date = addDays(date, 1)) {
    for (const operator of federica) {
      const productionMinutes = workingMinutesForDate(date, currentCalendar, operator)
      if (productionMinutes <= 0) continue
      const recorded = vehicleSeconds.get(`${operator.id}/${date}`)
      const seconds = vehicleWork === undefined && recorded === undefined
        ? null : federicaOfficeMinutes * 60 + Math.max(0, productionMinutes * 60 - (recorded ?? 0))
      const rate = operatorHourlyCost(operator)
      const costCents = seconds === null || (seconds > 0 && rate === null)
        ? null : cents(seconds / 3600 * (rate ?? 0))
      outsideCosts.push({ date, seconds, costCents })
    }
  }
  const billed = [
    ...data.invoices.filter(isRealizedInvoice).map(invoice => ({ date: invoice.issueDate, amount: invoice.taxableAmount || 0 })),
    ...historicalRevenues(data),
  ]
  const period = (label: string, start: string, goal: number) => {
    const includes = (date: string) => date >= start && date <= today
    const recognized = production.filter(entry => includes(entry.date))
    const expenses = outsideCosts.filter(entry => includes(entry.date))
    const offVehicleCostCents = expenses.reduce((sum, entry) => sum + (entry.costCents ?? 0), 0)
    const done = (recognized.reduce((sum, entry) => sum + (entry.marginCents ?? 0), 0) - offVehicleCostCents) / 100
    const offVehicleTimeIncomplete = expenses.some(entry => entry.seconds === null)
    const offVehicleCostIncomplete = expenses.some(entry => entry.costCents === null)
    const incomplete = recognized.some(entry => entry.marginCents === null) || offVehicleCostIncomplete
    const provisional = recognized.some(entry => entry.marginCents !== null && entry.provisional)
    const hasMargin = !incomplete || recognized.some(entry => entry.marginCents !== null) || offVehicleCostCents > 0
    const invoiced = billed.reduce((sum, entry) => includes(entry.date) ? sum + entry.amount : sum, 0)
    const target = cents(goal) / 100
    return { label, goal: target, done, billed: cents(invoiced) / 100, incomplete, provisional, hasMargin,
      offVehicleHours: expenses.reduce((sum, entry) => sum + (entry.seconds ?? 0), 0) / 3600,
      offVehicleCost: offVehicleCostCents / 100, offVehicleCostIncomplete, offVehicleTimeIncomplete,
      gap: Math.max(0, cents(target - done)) / 100, percent: target > 0 && !incomplete ? 100 * done / target : null }
  }
  return [
    period('Oggi', today, dailyGoal(today)),
    period('Settimana', monday, week.reduce((sum, day) => sum + dailyGoal(day), 0)),
    period('Mese', month + '-01', monthGoal),
  ]
}
