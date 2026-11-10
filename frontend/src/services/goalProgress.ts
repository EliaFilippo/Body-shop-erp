import type { ErpData } from '../types'
import { historicalRevenues, isRealizedInvoice } from './historicalActuals'
import { isVehicleStatusSemantic } from './vehicleStatuses'
import { addDays, isWorkingDate, workingMinutesForDate } from './workCalendar'

const romeDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayOf = (timestamp?: string) => timestamp && Number.isFinite(Date.parse(timestamp))
  ? romeDate.format(new Date(timestamp)) : undefined
const round = (amount: number) => Math.round(amount * 100) / 100

export function calculateGoalProgress(data: ErpData, today = romeDate.format(new Date())) {
  const settings = data.plannerSettings
  const monthGoal = Math.max(0, settings.monthlyRevenueGoal || 0)
  const month = today.slice(0, 7)
  const monday = addDays(today, -((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7))
  const week = Array.from({ length: 7 }, (_, index) => addDays(monday, index))
  const nightly = data.nightlyPlanning?.economics
  const snapshots = [nightly, ...(data.nightlyPlanning?.economicsHistory ?? [])].sort((a, b) =>
    (b?.plannedFor ?? '').localeCompare(a?.plannedFor ?? ''))
  const operators = settings.operators.filter(operator => operator.active)
  const capacity = (date: string) => operators.length
    ? operators.reduce((sum, operator) => sum + workingMinutesForDate(date, settings, operator), 0)
    : Number(isWorkingDate(date, settings))
  const dailyGoal = (date: string) => {
    for (const snapshot of snapshots) {
      const value = snapshot?.dailyGoals.find(day => day.date === date)?.revenueGoal
      if (value != null) return value
    }
    const monthKey = date.slice(0, 7)
    const first = monthKey + '-01'
    const [year, monthNumber] = monthKey.split('-').map(Number)
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
    const monthCapacity = Array.from({ length: days }, (_, index) => capacity(addDays(first, index))).reduce((a, b) => a + b, 0)
    return monthCapacity > 0 ? monthGoal * capacity(date) / monthCapacity : 0
  }

  const production: Array<{ date: string; amount: number }> = []
  const vehicles = new Map(data.vehicles.map(vehicle => [vehicle.id, vehicle]))
  for (const job of data.jobs ?? []) {
    const vehicle = job.vehicleId ? vehicles.get(job.vehicleId) : undefined
    if (job.status === 'Annullata' || (vehicle && isVehicleStatusSemantic(settings, vehicle.status, 'cancelled'))) continue
    const revenue = Math.max(0, job.taxableAmount || 0)
    const phases = job.phases.filter(phase => !phase.notRequired && phase.name !== 'Consegna')
    const sharedCounts = new Map<string, number>()
    for (const phase of phases) {
      if (phase.sharedTimeKey) sharedCounts.set(phase.sharedTimeKey, (sharedCounts.get(phase.sharedTimeKey) ?? 0) + 1)
    }
    const weights = phases.map(phase => Math.max(0, phase.sharedTimeKey && phase.sharedTimeMinutes !== undefined
      ? phase.sharedTimeMinutes / (sharedCounts.get(phase.sharedTimeKey) ?? 1) : phase.estimatedMinutes || 0))
    const totalWeight = weights.reduce((a, b) => a + b, 0)
    let credited = 0
    const delivered = job.status === 'Consegnata' || (vehicle && isVehicleStatusSemantic(settings, vehicle.status, 'delivered'))
    const deliveryDate = delivered ? dayOf(job.deliveredAt || vehicle?.deliveredAt) : undefined
    phases.forEach((phase, index) => {
      const date = phase.status === 'Completata' ? dayOf(phase.completedAt || phase.endedAt) : undefined
      if (!date || date > today || (deliveryDate && date > deliveryDate) || totalWeight <= 0) return
      const amount = revenue * weights[index] / totalWeight
      credited += amount
      production.push({ date, amount })
    })
    if (deliveryDate && deliveryDate <= today) production.push({ date: deliveryDate, amount: Math.max(0, revenue - credited) })
  }
  const billed = [
    ...data.invoices.filter(isRealizedInvoice).map(invoice => ({ date: invoice.issueDate, amount: invoice.taxableAmount || 0 })),
    ...historicalRevenues(data),
  ]
  const period = (label: string, start: string, goal: number) => {
    const sum = (entries: typeof production) => round(entries.reduce((total, entry) =>
      entry.date >= start && entry.date <= today ? total + entry.amount : total, 0))
    const done = sum(production)
    return { label, goal: round(goal), done, billed: sum(billed), gap: round(Math.max(0, goal - done)), percent: goal > 0 ? 100 * done / goal : null }
  }
  return [
    period('Oggi', today, dailyGoal(today)),
    period('Settimana', monday, week.reduce((sum, day) => sum + dailyGoal(day), 0)),
    period('Mese', month + '-01', monthGoal),
  ]
}
