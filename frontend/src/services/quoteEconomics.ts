import type { AcceptanceQuote, EstimateLine, NightlyEconomicSnapshot, PlannerSettings } from '../types'
import { damageQuoteError, damageLineForSave } from './damageQuote'
import { calculateQuoteHourBudget } from './quoteHourBudget'
import type { marginTargetRate } from './marginTargetRate'
import { monthlyTargetRate } from './monthlyTargetRate'

type QuoteEconomicStatus = 'unknown' | 'loss' | 'break-even' | 'below-target' | 'on-target' | 'no-target'
const round = (value:number) => Math.round(value * 100) / 100

/** Office preview only: never changes prices, phase allowances or customer documents. */
export function quoteEconomics(quote:AcceptanceQuote, settings:PlannerSettings, nightly?:NightlyEconomicSnapshot, marginTarget?: ReturnType<typeof marginTargetRate>) {
 const budget = calculateQuoteHourBudget(quote,settings)
 const revenueTarget = monthlyTargetRate(settings,quote.monthKey,nightly)
 const target = marginTarget ? { ...revenueTarget, hourlyRate: marginTarget.hourlyRate } : revenueTarget
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
 const costError = budget.structure.productiveHours <= 0 ? 'Configura le ore produttive in Impostazioni → Costi e tariffe interne.'
  : budget.structure.totalMonthlyCosts <= 0 ? 'Completa i costi mensili di personale e struttura in Impostazioni → Costi e tariffe interne.' : ''
 const hours = minutes / 60
 const hourlyRevenue = hours > 0 ? round(budget.revenue / hours) : null
 // Payroll is already included in the monthly average: do not add operator hourly costs again.
 const hourlyCost = !costError ? budget.structure.allInRate : null
 const personnelAndStructureCost = !timingError && hourlyCost !== null ? round(hours * hourlyCost) : null
 const totalCost = personnelAndStructureCost !== null ? round(budget.materialsCost + budget.directCosts + personnelAndStructureCost) : null
 const margin = totalCost !== null ? round(budget.revenue - totalCost) : null
 const breakEvenRevenue = personnelAndStructureCost !== null && budget.materialPercent < 100
  ? round((personnelAndStructureCost + budget.directCosts) / (1 - budget.materialPercent / 100)) : null
 const status:QuoteEconomicStatus = margin === null ? 'unknown' : margin < 0 ? 'loss' : margin === 0 ? 'break-even'
  : target.hourlyRate === null ? 'no-target' : hourlyRevenue! < target.hourlyRate ? 'below-target' : 'on-target'
 return {revenue:budget.revenue,minutes,hourlyRevenue,target,maxMinutes:!costError ? budget.baseMaxMinutes : null,targetMinutes:!costError ? budget.baseTargetMinutes : null,materialPercent:budget.materialPercent,materialsCost:budget.materialsCost,
  directCosts:budget.directCosts,hourlyCost,personnelAndStructureCost,totalCost,margin,breakEvenRevenue,status,timingError,costError}
}
