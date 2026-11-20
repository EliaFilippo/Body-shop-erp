import type { AcceptanceQuote, EstimateLine, NightlyEconomicSnapshot, PlannerSettings } from '../types'
import { damageQuoteError, damageLineForSave } from './damageQuote'
import { calculateQuoteHourBudget } from './quoteHourBudget'
import type { marginTargetRate } from './marginTargetRate'
import { monthlyTargetRate } from './monthlyTargetRate'
import { operatorHourlyCost } from './closedJobMargin'
import { quoteCustomerLines } from './quotePricing'

type QuoteEconomicStatus = 'unknown' | 'loss' | 'break-even' | 'below-target' | 'on-target' | 'no-target'
const round = (value:number) => Math.round(value * 100) / 100

/** Office preview only: never changes prices, phase allowances or customer documents. */
export function quoteEconomics(quote:AcceptanceQuote, settings:PlannerSettings, nightly?:NightlyEconomicSnapshot, marginTarget?: ReturnType<typeof marginTargetRate>) {
 const budget = calculateQuoteHourBudget(quote,settings)
 const revenueTarget = monthlyTargetRate(settings,quote.monthKey,nightly)
 const goal = Math.max(0, settings.monthlyGoalHistory?.find(r => r.monthKey === quote.monthKey)?.marginGoal ?? settings.monthlyMarginGoal ?? 0)
 const target = { ...revenueTarget, hours: marginTarget?.hours ?? revenueTarget.hours, isResidual: !!marginTarget, goal: marginTarget?.remainingMargin ?? goal,
  hourlyRate: marginTarget?.marginHourlyRate ?? (marginTarget ? null : goal > 0 && revenueTarget.hours > 0 ? Math.ceil(goal / revenueTarget.hours * 100) / 100 : null) }
 // Pricing uses entered technical durations even while a manual phase is being assigned.
 // Shared panel allowances are counted once, and a blank extra phase contributes nothing.
 const positive = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value ?? 0) : 0
 const lineMinutes = (line: EstimateLine) => line.manualPhaseTimes
  ? damageLineForSave(line).manualPhaseTimes!.reduce((sum, item) => sum + positive(item.minutes), 0)
  : line.minorDamageTimes ? Object.values(line.minorDamageTimes).reduce((sum, value) => sum + positive(value), 0) * (line.calculationType === 'per-panel' ? line.quantity : 1)
  : positive(line.lineTotalMinutes ?? line.estimatedMinutes)
 const laborMinutes = budget.plannedMinutes - budget.rows.reduce((sum, row) => sum + row.minutes, 0)
 const hasWash = (quote.damageLines ?? []).some(line => line.manualPhaseTimes?.some(item => item.phase === 'Lavaggio esterno' && item.minutes > 0) || line.categoryOrPhase === 'Lavaggio esterno')
 const minutes = Math.round((quote.damageLines ?? []).reduce((sum, line) => sum + lineMinutes(line), 0) + laborMinutes
  + (!hasWash && quote.selectedPhases?.includes('Lavaggio esterno') ? settings.eliasExteriorWashMinutes ?? 25 : 0))
 const incomplete = damageQuoteError(quote.damageLines ?? [])
 const timingError = incomplete || (!quote.damageLines?.length || minutes <= 0 ? 'Aggiungi le lavorazioni e completa i tempi tecnici.' : '')
 const hours = minutes / 60
 const hourlyRevenue = hours > 0 ? round(budget.revenue / hours) : null
 const active = settings.operators.filter(op => op.active)
 const averageRates = active.map(operatorHourlyCost)
 const average = averageRates.length && averageRates.every(rate => rate !== null) ? averageRates.reduce<number>((sum, rate) => sum + (rate ?? 0), 0) / averageRates.length : null
 const rateFor = (id?: string) => id ? settings.operators.find(op => op.id === id) : undefined
 const laborRate = (id?: string) => { const op = rateFor(id); return op ? operatorHourlyCost(op) : id ? null : average }
 let labor = 0, laborValid = true, assignedMinutes = 0
 for (const line of quote.damageLines ?? []) {
  const duration = lineMinutes(line)
  const rate = laborRate(line.budgetOperatorId || quote.budgetOperatorId)
  assignedMinutes += duration
  if (duration > 0 && rate === null) laborValid = false
  labor += duration / 60 * (rate ?? 0)
 }
 const extraRate = laborRate(quote.budgetOperatorId)
 const extraMinutes = Math.max(0, minutes - assignedMinutes)
 if (extraMinutes > 0 && extraRate === null) laborValid = false
 labor += extraMinutes / 60 * (extraRate ?? 0)
 const missingDirect = quoteCustomerLines(quote).some(line => ['parts','external','other'].includes(line.kind) && line.quantity > 0 && line.unitCost === undefined)
 const costError = !laborValid ? 'Completa i costi orari degli operatori per stimare la manodopera.' : missingDirect ? 'Completa i costi diretti del preventivo.' : ''
 const hourlyCost = hours > 0 && !costError ? labor / hours : null
 const personnelAndStructureCost = !timingError && hourlyCost !== null ? round(labor) : null
 const totalCost = personnelAndStructureCost !== null ? round(budget.materialsCost + budget.directCosts + personnelAndStructureCost) : null
 const margin = totalCost !== null ? round(budget.revenue - totalCost) : null
 const marginHourly = margin !== null && hours > 0 ? round(margin / hours) : null
 const breakEvenRevenue = null
 const status:QuoteEconomicStatus = margin === null ? 'unknown' : margin < 0 ? 'loss' : margin === 0 ? 'break-even'
  : target.hourlyRate === null ? 'no-target' : marginHourly! < target.hourlyRate ? 'below-target' : 'on-target'
 // The labor cost varies with duration: solve (revenue - materials - direct) / hours - laborRate >= margin target.
 const denominator = target.hourlyRate !== null && hourlyCost !== null ? target.hourlyRate + hourlyCost : null
 const objectiveMinutes = denominator !== null && denominator > 0 && !timingError
  ? Math.max(0, Math.floor((budget.revenue - budget.materialsCost - budget.directCosts) / denominator * 60 + 1e-8)) : null
 const objectiveDelta = objectiveMinutes === null || timingError ? null : objectiveMinutes - minutes
 const objectiveHourlyDelta = target.hourlyRate !== null && marginHourly !== null && !timingError ? round(marginHourly - target.hourlyRate) : null
 return {marginHourly,objectiveHourlyDelta,objectiveMinutes,objectiveDelta,revenue:budget.revenue,minutes,hourlyRevenue,target,maxMinutes:!costError ? budget.baseMaxMinutes : null,targetMinutes:!costError ? budget.baseTargetMinutes : null,materialPercent:budget.materialPercent,materialsCost:budget.materialsCost,
  directCosts:budget.directCosts,hourlyCost,personnelAndStructureCost,totalCost,margin,breakEvenRevenue,status,timingError,costError}
}
