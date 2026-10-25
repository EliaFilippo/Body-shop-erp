import type { AcceptanceQuote, EstimateLine, PlannerSettings } from '../types'
import { damageQuoteError } from './damageQuote'
import { calculateQuoteHourBudget } from './quoteHourBudget'
import { monthlyTargetRate } from './monthlyTargetRate'
import { buildSelectedWorkCycle } from './workCycle'

type QuoteEconomicStatus = 'unknown' | 'loss' | 'break-even' | 'below-target' | 'on-target' | 'no-target'
const round = (value:number) => Math.round(value * 100) / 100

/** Office preview only: never changes prices, phase allowances or customer documents. */
export function quoteEconomics(quote:AcceptanceQuote, settings:PlannerSettings) {
 const budget = calculateQuoteHourBudget(quote,settings)
 const target = monthlyTargetRate(settings,quote.monthKey)
 const phases = buildSelectedWorkCycle((quote.damageLines ?? []) as EstimateLine[],quote.selectedPhases ?? [],settings.eliasExteriorWashMinutes ?? 25)
 const minutes = phases.reduce((sum,phase)=>sum+(phase.notRequired ? 0 : phase.estimatedMinutes),0)
 const incomplete = damageQuoteError(quote.damageLines ?? [])
 const timingError = incomplete || (!quote.damageLines?.length || minutes <= 0 ? 'Aggiungi le lavorazioni e completa i tempi tecnici.' : '')
 const costError = budget.structure.productiveHours <= 0 ? 'Configura le ore produttive in Impostazioni → Costi e tariffe interne.'
  : budget.structure.excludedPayroll <= 0 || budget.structure.monthlyOverhead <= 0 ? 'Completa i costi mensili di personale e struttura in Impostazioni → Costi e tariffe interne.' : ''
 const hours = minutes / 60
 const hourlyRevenue = !timingError && hours > 0 ? round(budget.revenue / hours) : null
 // Payroll is already included in the monthly average: do not add operator hourly costs again.
 const hourlyCost = !costError ? budget.structure.allInRate : null
 const personnelAndStructureCost = !timingError && hourlyCost !== null ? round(hours * hourlyCost) : null
 const totalCost = personnelAndStructureCost !== null ? round(budget.materialsCost + budget.directCosts + personnelAndStructureCost) : null
 const margin = totalCost !== null ? round(budget.revenue - totalCost) : null
 const breakEvenRevenue = personnelAndStructureCost !== null && budget.materialPercent < 100
  ? round((personnelAndStructureCost + budget.directCosts) / (1 - budget.materialPercent / 100)) : null
 const status:QuoteEconomicStatus = margin === null ? 'unknown' : margin < 0 ? 'loss' : margin === 0 ? 'break-even'
  : target.hourlyRate === null ? 'no-target' : hourlyRevenue! < target.hourlyRate ? 'below-target' : 'on-target'
 return {revenue:budget.revenue,minutes,hourlyRevenue,target,materialPercent:budget.materialPercent,materialsCost:budget.materialsCost,
  directCosts:budget.directCosts,hourlyCost,personnelAndStructureCost,totalCost,margin,breakEvenRevenue,status,timingError,costError}
}
