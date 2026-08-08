import type { ErpData, FinanceSettings, PlannerSettings, Vehicle } from '../types'
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

export interface MonthlyGoalProjection {
  goalRevenue: number
  actualRevenue: number
  deltaRevenue: number
  projectedEndRevenue: number
  remainingWorkingDays: number
  dailyRevenueNeeded: number
  monthKey: string
}

export interface VehicleEconomicSnapshot {
  taxableRevenue: number
  estimatedMaterials: number
  actualMaterials: number
  laborCost: number
  externalCosts: number
  otherCosts: number
  totalDirectCosts: number
  grossMargin: number
  grossMarginPercent: number
  predictedMargin: number
  realMargin: number
  previewDifference: number
  economicState: 'positive' | 'low' | 'break-even' | 'loss'
  lossLabel: string
  estimatedLaborHours: number
  effectiveLaborHours: number
  isEstimatedLaborCost: boolean
}

export interface CostLineSummary {
  taxableAmount: number
  vatAmount: number
  totalAmount: number
  margin: number
}

export interface ExecutiveDashboardSnapshot {
  availableLiquidity: number
  monthlyRevenue: number
  monthlyCollected: number
  monthlyGoal: number
  monthlyDeviation: number
  projectedEndRevenue: number
  projectedCollections: {
    days30: number
    days60: number
    days90: number
  }
  vehiclesPresent: number
  vehiclesInProgress: number
  vehiclesReady: number
  vehiclesLate: number
  todaysDeliveries: number
  todaysPickups: number
  freeCones: number
  occupiedCones: number
  blockedVehicles: number
  missingPartsVehicles: number
  priorityNotifications: string[]
}

const round = (value: number) => Math.round(value * 100) / 100
const normalizeStatus = (value: string) => value.trim().toLowerCase()

export function calculateEconomicSummary(
  vehicles: Vehicle[],
  settings: PlannerSettings,
  referenceDate = todayKey(),
): EconomicSummary {
  const month = referenceDate.slice(0, 7)
  const scheduled = vehicles.filter((vehicle) =>
    normalizeStatus(vehicle.status) !== 'consegnata'
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

export function calculateMonthlyGoalProjection(
  vehicles: Vehicle[],
  settings: PlannerSettings,
  referenceDate = todayKey(),
): MonthlyGoalProjection {
  const summary = calculateEconomicSummary(vehicles, settings, referenceDate)
  const monthKey = referenceDate.slice(0, 7)
  const projectedEndRevenue = Math.max(0, summary.plannedRevenue + Math.max(0, summary.dailyRevenueNeeded) * summary.remainingWorkingDays)
  return {
    goalRevenue: round(summary.goal),
    actualRevenue: round(summary.plannedRevenue),
    deltaRevenue: round(Math.max(0, summary.goal - summary.plannedRevenue)),
    projectedEndRevenue: round(projectedEndRevenue),
    remainingWorkingDays: summary.remainingWorkingDays,
    dailyRevenueNeeded: summary.dailyRevenueNeeded,
    monthKey,
  }
}

export function calculateExecutiveDashboardSnapshot(
  data: ErpData,
  referenceDate = todayKey(),
): ExecutiveDashboardSnapshot {
  const monthKey = referenceDate.slice(0, 7)
  const currentDay = referenceDate.slice(0, 10)
  const openInvoices = data.invoices.filter((invoice) => !['Incassata', 'Stornata'].includes(invoice.status))
  const monthInvoices = data.invoices.filter((invoice) => invoice.issueDate.startsWith(monthKey))
  const monthEvents = data.financialEvents.filter((event) => event.type === 'Incasso definitivo' && event.date.startsWith(monthKey))
  const availableLiquidity = data.bankAccounts.reduce((sum, account) => sum + account.currentBalance, 0)
  const monthlyRevenue = monthInvoices.reduce((sum, invoice) => sum + invoice.total, 0)
  const monthlyCollected = monthEvents.reduce((sum, event) => sum + event.amount, 0)
  const monthSummary = calculateEconomicSummary(data.vehicles, data.plannerSettings, referenceDate)
  const monthProjection = calculateMonthlyGoalProjection(data.vehicles, data.plannerSettings, referenceDate)
  const projectedCollections = {
    days30: openInvoices.filter((invoice) => {
      const due = new Date(`${invoice.dueDate}T12:00:00`).getTime()
      const nowMs = new Date(`${currentDay}T12:00:00`).getTime()
      const diff = Math.ceil((due - nowMs) / 86400000)
      return diff >= 0 && diff <= 30
    }).reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0),
    days60: openInvoices.filter((invoice) => {
      const due = new Date(`${invoice.dueDate}T12:00:00`).getTime()
      const nowMs = new Date(`${currentDay}T12:00:00`).getTime()
      const diff = Math.ceil((due - nowMs) / 86400000)
      return diff >= 0 && diff <= 60
    }).reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0),
    days90: openInvoices.filter((invoice) => {
      const due = new Date(`${invoice.dueDate}T12:00:00`).getTime()
      const nowMs = new Date(`${currentDay}T12:00:00`).getTime()
      const diff = Math.ceil((due - nowMs) / 86400000)
      return diff >= 0 && diff <= 90
    }).reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0),
  }
  const vehiclesPresent = data.vehicles.filter((vehicle) => normalizeStatus(vehicle.status) !== 'consegnata').length
  const vehiclesInProgress = data.vehicles.filter((vehicle) => normalizeStatus(vehicle.status) === 'in lavorazione').length
  const vehiclesReady = data.vehicles.filter((vehicle) => normalizeStatus(vehicle.status) === 'pronta').length
  const vehiclesLate = data.vehicles.filter((vehicle) => normalizeStatus(vehicle.status) !== 'consegnata' && vehicle.requestedDeliveryDate && vehicle.requestedDeliveryDate < currentDay).length
  const todaysDeliveries = data.vehicles.filter((vehicle) => vehicle.requestedDeliveryDate === currentDay && normalizeStatus(vehicle.status) !== 'consegnata').length
  const todaysPickups = data.vehicles.filter((vehicle) => vehicle.deliveredAt?.slice(0, 10) === currentDay).length
  const occupiedCones = data.vehicles.filter((vehicle) => vehicle.coneNumber !== null).length
  const freeCones = 30 - occupiedCones
  const blockedVehicles = data.vehicles.filter((vehicle) => vehicle.blockReason.trim() || vehicle.partsStatus === 'Mancanti').length
  const missingPartsVehicles = data.vehicles.filter((vehicle) => vehicle.partsStatus === 'Mancanti').length
  const priorityNotifications = [
    monthSummary.missingRevenue > 0 ? `Obiettivo mensile ancora da raggiungere: € ${monthSummary.missingRevenue.toLocaleString('it-IT')}` : '',
    vehiclesLate > 0 ? `${vehiclesLate} vetture in ritardo sulla consegna richiesta` : '',
    blockedVehicles > 0 ? `${blockedVehicles} pratiche bloccate da ricambi o annotazioni` : '',
    missingPartsVehicles > 0 ? `${missingPartsVehicles} ricambi mancanti` : '',
    availableLiquidity < (data.financeSettings.minimumProjectedBalance || 0) ? `Liquidità disponibile inferiore alla soglia impostata: € ${availableLiquidity.toLocaleString('it-IT')}` : '',
  ].filter(Boolean)

  return {
    availableLiquidity: round(availableLiquidity),
    monthlyRevenue: round(monthlyRevenue),
    monthlyCollected: round(monthlyCollected),
    monthlyGoal: round(monthSummary.goal),
    monthlyDeviation: round(monthProjection.deltaRevenue),
    projectedEndRevenue: round(monthProjection.projectedEndRevenue),
    projectedCollections: {
      days30: round(projectedCollections.days30),
      days60: round(projectedCollections.days60),
      days90: round(projectedCollections.days90),
    },
    vehiclesPresent: vehiclesPresent,
    vehiclesInProgress: vehiclesInProgress,
    vehiclesReady: vehiclesReady,
    vehiclesLate: vehiclesLate,
    todaysDeliveries: todaysDeliveries,
    todaysPickups: todaysPickups,
    freeCones,
    occupiedCones,
    blockedVehicles,
    missingPartsVehicles,
    priorityNotifications,
  }
}

export function calculateCostLineSummary(entries: Vehicle['costEntries'] = [], taxableRevenue = 0): CostLineSummary {
  const taxableAmount = (entries ?? []).reduce((sum, entry) => sum + (entry.total || 0), 0)
  const vatAmount = (entries ?? []).reduce((sum, entry) => sum + ((entry.total || 0) * ((entry.vatRate || 0) / 100)), 0)
  const totalAmount = taxableAmount + vatAmount
  return {
    taxableAmount: round(taxableAmount),
    vatAmount: round(vatAmount),
    totalAmount: round(totalAmount),
    margin: round(taxableRevenue - totalAmount),
  }
}

export function calculateVehicleEconomicSnapshot(
  vehicle: Vehicle,
  financeSettings: FinanceSettings,
): VehicleEconomicSnapshot {
  const taxableRevenue = vehicle.expectedRevenue || 0
  const entries = vehicle.costEntries ?? []
  const materialEntries = entries.filter((entry) => [
    'vernice',
    'trasparente',
    'fondo',
    'stucco',
    'carta abrasiva',
    'nastro e materiale da mascheratura',
    'minuteria',
    'ricambi',
    'materiali di lucidatura',
    'materiale verniciatura',
    'meccanica',
    'cristalli',
    'pneumatici',
    'lucidatura',
  ].includes(entry.category))
  const actualMaterials = materialEntries.reduce((sum, entry) => sum + (entry.total || 0), 0)
  const externalCosts = entries
    .filter((entry) => ['lavorazioni esterne', 'manodopera esterna'].includes(entry.category))
    .reduce((sum, entry) => sum + (entry.total || 0), 0)
  const otherCosts = entries
    .filter((entry) => ['lavaggio', 'trasporto', 'smaltimento', 'altro', 'noleggio'].includes(entry.category))
    .reduce((sum, entry) => sum + (entry.total || 0), 0)
  const estimatedHours = vehicle.estimatedHours || 0
  const effectiveHours = vehicle.workedHours || 0
  const laborHourlyRate = financeSettings.laborHourlyCost ?? 45
  const laborCost = effectiveHours * laborHourlyRate
  const totalDirectCosts = actualMaterials + laborCost + externalCosts + otherCosts
  const grossMargin = taxableRevenue - totalDirectCosts
  const grossMarginPercent = taxableRevenue ? round((grossMargin / taxableRevenue) * 100) : 0
  const predictedMargin = vehicle.expectedMargin || 0
  const realMargin = grossMargin
  const previewDifference = realMargin - predictedMargin
  const thresholds = { positive: 15, low: 5, breakEven: 0 }
  const state = previewDifference >= thresholds.positive
    ? 'positive'
    : previewDifference >= thresholds.low
      ? 'low'
      : previewDifference >= thresholds.breakEven
        ? 'break-even'
        : 'loss'
  return {
    taxableRevenue: round(taxableRevenue),
    estimatedMaterials: round(actualMaterials),
    actualMaterials: round(actualMaterials),
    laborCost: round(laborCost),
    externalCosts: round(externalCosts),
    otherCosts: round(otherCosts),
    totalDirectCosts: round(totalDirectCosts),
    grossMargin: round(grossMargin),
    grossMarginPercent,
    predictedMargin: round(predictedMargin),
    realMargin: round(realMargin),
    previewDifference: round(previewDifference),
    economicState: state,
    lossLabel: grossMargin < 0 ? 'PERDITA' : 'UTILI',
    estimatedLaborHours: round(estimatedHours),
    effectiveLaborHours: round(effectiveHours),
    isEstimatedLaborCost: effectiveHours <= 0,
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
