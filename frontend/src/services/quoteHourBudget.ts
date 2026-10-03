import type { AcceptanceQuote, EstimateLine, PlannerSettings } from '../types'
import { calculateInternalProductiveCapacity } from './workflow'

const safe = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
const round = (value: number) => Math.round(value * 100) / 100
const percent = (value: unknown, fallback: number) => Math.min(100, safe(value ?? fallback))

export function quoteStructureRate(settings: PlannerSettings) {
  const items = settings.internalCostSettings?.monthlyCostItems ?? []
  const payrollCovered = (item: typeof items[number]) => item.coveredByOperatorRates ?? item.category === 'personale'
  const monthlyOverhead = round(items.reduce((sum, item) => sum + (item.active && !payrollCovered(item) ? safe(item.monthlyAmount) : 0), 0))
  const excludedPayroll = round(items.reduce((sum, item) => sum + (item.active && payrollCovered(item) ? safe(item.monthlyAmount) : 0), 0))
  const capacity = calculateInternalProductiveCapacity(settings)
  const hours = capacity.theoreticalHours * percent(capacity.efficiencyPercent, 0) / 100
  const manual = settings.internalCostSettings?.budgetUseManualStructureRate === true
  const rate = manual ? safe(settings.internalCostSettings?.budgetManualStructureRate) : hours > 0 ? monthlyOverhead / hours : 0
  return { monthlyOverhead, excludedPayroll, productiveHours: round(hours), rate, manual,
    error: rate <= 0 ? 'Configura i costi di struttura e le ore produttive in Impostazioni → Costi e tariffe interne.' : '' }
}

export function quoteOperatorRate(settings: PlannerSettings, operatorId?: string) {
  const operator = settings.operators.find((item) => item.id === operatorId && item.active)
  const rate = operator?.costMode === 'external-extra' ? safe(operator.externalHourlyCost ?? operator.hourlyCost) : safe(operator?.hourlyCost)
  return { operator, rate, error: !operator ? 'Seleziona un operatore attivo.' : rate <= 0 ? `Inserisci il costo orario di ${operator.name} in Impostazioni → Planner e tempi.` : '' }
}

export function calculateQuoteHourBudget(quote: AcceptanceQuote, settings: PlannerSettings) {
  const structure = quoteStructureRate(settings)
  const materialPercent = percent(settings.internalCostSettings?.budgetMaterialsPercent, 20)
  const marginPercent = percent(settings.internalCostSettings?.minimumMarginPercent, 0)
  const laborExtras = quote.lines.filter((line) => line.kind === 'labor')
  const rawRows = (quote.damageLines ?? []).map((line) => ({ line, revenue: safe(line.quantity * line.unitPrice - line.discount), minutes: safe(line.estimatedMinutes) }))
  const extraRevenue = laborExtras.reduce((sum, line) => sum + safe(line.quantity) * safe(line.unitPrice), 0)
  const grossSales = rawRows.reduce((sum, row) => sum + row.revenue, 0) + quote.lines.filter((line) => line.kind !== 'discount').reduce((sum, line) => sum + safe(line.quantity) * safe(line.unitPrice), 0)
  const discount = Math.min(grossSales, quote.lines.filter((line) => line.kind === 'discount').reduce((sum, line) => sum + safe(line.quantity) * safe(line.unitPrice), 0))
  const salesFactor = grossSales > 0 ? 1 - discount / grossSales : 1
  const revenue = round(grossSales - discount)
  const materialsBase = (rawRows.reduce((sum, row) => sum + row.revenue, 0) + extraRevenue) * salesFactor
  const materialsCost = round(materialsBase * materialPercent / 100)
  const directLines = quote.lines.filter((line) => ['parts', 'external', 'other'].includes(line.kind))
  const directCosts = round(directLines.reduce((sum, line) => sum + safe(line.quantity) * safe(line.unitCost), 0))
  const missingDirectCost = directLines.find((line) => line.quantity > 0 && line.unitPrice > 0 && !safe(line.unitCost))
  // La riga materiali fatturata è un ricavo, il consumo stimato è calcolato una sola volta.
  const available = round(revenue - materialsCost - directCosts)
  const defaultOperator = quoteOperatorRate(settings, quote.budgetOperatorId)
  const rows = rawRows.map(({ line, revenue: amount, minutes }) => {
    const operator = quoteOperatorRate(settings, line.budgetOperatorId || quote.budgetOperatorId)
    const combinedRate = structure.rate + operator.rate
    const net = amount * salesFactor
    const material = net * materialPercent / 100
    const cap = (budget: number) => !structure.error && !operator.error && combinedRate > 0 ? Math.max(0, Math.floor(budget / combinedRate * 60 + 1e-8)) : null
    return { lineId: line.id, panelId: line.panelId, panelName: line.panelName, operatorId: operator.operator?.id, operatorName: operator.operator?.name,
      structureRate: structure.rate, operatorRate: operator.rate, combinedRate, revenue: round(net), materialsCost: round(material),
      maxMinutes: cap(net - material), targetMinutes: cap(net - material - net * marginPercent / 100), minutes,
      laborCost: minutes / 60 * combinedRate, error: structure.error || operator.error }
  })
  const extraMinutes = laborExtras.reduce((sum, line) => sum + safe(line.quantity) * 60, 0)
  const plannedMinutes = rows.reduce((sum, row) => sum + row.minutes, 0) + extraMinutes
  const plannedLaborCost = rows.reduce((sum, row) => sum + row.laborCost, 0) + extraMinutes / 60 * (structure.rate + defaultOperator.rate)
  const error = structure.error || rows.find((row) => row.error)?.error || (extraMinutes > 0 || !rows.length ? defaultOperator.error : '')
    || (missingDirectCost ? `Completa il costo interno di ${missingDirectCost.description}.` : '')
  const costLive = round(materialsCost + directCosts + plannedLaborCost)
  const margin = round(revenue - costLive)
  // Con operatori diversi, la capacità totale deriva dai budget ripartiti per pannello.
  const operators = new Set(rows.map((row) => row.operatorId))
  if (extraMinutes || extraRevenue) operators.add(defaultOperator.operator?.id)
  const singleRate = rows.length && operators.size === 1 ? rows[0].combinedRate : structure.rate + defaultOperator.rate
  const primaryBudget = rows.reduce((sum, row) => sum + row.revenue - row.materialsCost, 0)
  const residualBudget = available - primaryBudget
  const residualError = Math.abs(residualBudget) > .02 && operators.size > 1 && defaultOperator.error
  const finalError = error || (residualError ? 'Seleziona l’operatore di riferimento anche per gli altri importi.' : '')
  const cap = (value: number) => !finalError && singleRate > 0 ? Math.max(0, Math.floor(value / singleRate * 60 + 1e-8)) : null
  const multipleCap = (target: boolean) => {
    if (finalError || rows.some((row) => (target ? row.targetMinutes : row.maxMinutes) === null)) return null
    const residual = residualBudget - (target ? (revenue - rows.reduce((sum, row) => sum + row.revenue, 0)) * marginPercent / 100 : 0)
    return Math.max(0, rows.reduce((sum, row) => sum + (target ? row.targetMinutes! : row.maxMinutes!), 0) + (singleRate > 0 ? Math.floor(residual / singleRate * 60 + 1e-8) : 0))
  }
  return { structure, materialPercent, marginPercent, revenue, materialsCost, directCosts, available, plannedMinutes, costLive, margin,
    error: finalError, rows, maxMinutes: operators.size <= 1 ? cap(available) : multipleCap(false),
    targetMinutes: operators.size <= 1 ? cap(available - revenue * marginPercent / 100) : multipleCap(true),
    fullyTimed: rawRows.every((row) => row.minutes > 0),
    comparisons: settings.operators.filter((operator) => operator.active).map((operator) => {
      const cost = quoteOperatorRate(settings, operator.id)
      const combined = structure.rate + cost.rate
      return { id: operator.id, name: operator.name, operatorRate: cost.rate, combinedRate: combined,
        maxMinutes: !structure.error && !cost.error && !missingDirectCost && combined > 0 ? Math.max(0, Math.floor(available / combined * 60 + 1e-8)) : null }
    }) }
}

export function budgetLineSnapshot(line: EstimateLine, quote: AcceptanceQuote, settings: PlannerSettings): EstimateLine {
  const result = calculateQuoteHourBudget(quote, settings)
  const row = result.rows.find((item) => item.lineId === line.id)
  if (!row || row.error) return line
  const laborCost = round(row.laborCost)
  const cost = laborCost + row.materialsCost
  return { ...line, budgetOperatorId: row.operatorId, budgetStructureRate: row.structureRate, budgetOperatorRate: row.operatorRate,
    budgetMaterialsCost: row.materialsCost, budgetMaterialsPercent: result.materialPercent, internalHourlyRateUsed: row.combinedRate, internalCostAmount: cost,
    theoreticalMarginAmount: round(row.revenue - cost), theoreticalMarginPercent: row.revenue ? round((row.revenue - cost) / row.revenue * 100) : 0 }
}
