import type { PlannerSettings, RepairJob, Vehicle } from '../types'
import { closedJobMargin } from './closedJobMargin'
import { quoteStructureRate } from './quoteHourBudget'
import { finalizedJobCosts } from './finalizedJobCosts'
import { isProductionLabourLine } from './liveProduction'

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100)
/** Operating result before company taxes; overhead is allocated, never claimed as an actual tax-net profit. */
export function vehicleOperatingProfit(vehicle: Vehicle, job: RepairJob, jobs: RepairJob[], settings: PlannerSettings) {
  const {finalized,date,costs} = finalizedJobCosts(job,vehicle,jobs,settings)
  const closed = closedJobMargin(job, settings.operators, costs?.materials, costs?.parts, finalized)
  const structure = quoteStructureRate(settings, date?.slice(0, 7))
  const overheadCents = finalized && structure.error ? 0 : !structure.error && closed.complete ? cents(closed.workedSeconds / 3600 * structure.rate) : null
  const directLines = job.lines.filter(line => !isProductionLabourLine(line) && line.category !== 'ricambi' && line.category !== 'materiali' && line.quantity > 0)
  const missingOther = !finalized && costs?.other === undefined && directLines.some(line => line.budgetDirectUnitCost === undefined)
  const otherCents = missingOther ? null : cents(costs?.other ?? (finalized ? 0 : directLines.reduce((sum, line) => sum + Math.max(0,line.budgetDirectUnitCost ?? 0) * line.quantity, 0)))
  const contributionCents = closed.marginCents !== null && otherCents !== null ? closed.marginCents - otherCents : null
  const profitCents = closed.marginCents !== null && overheadCents !== null && otherCents !== null
    ? closed.marginCents - overheadCents - otherCents : null
  const materialsEstimated = !finalized && job.materialActualCost === undefined && costs?.materials === undefined
  return { ...closed, contributionCents, overheadCents, otherCents, profitCents, structureRate: structure.rate,
    percent: profitCents !== null && job.taxableAmount > 0 ? profitCents / job.taxableAmount : null,
    materialsEstimated, partsEstimated: closed.partsEstimated,
    otherEstimated: !finalized && costs?.other === undefined && directLines.length > 0,
    missing: finalized ? [] : [closed.phasesWithoutTime.length > 0 && `tempi non registrati: ${closed.phasesWithoutTime.join(', ')}`,
      !closed.laborComplete && closed.phasesWithoutTime.length === 0 && 'attribuzioni o costi orari degli operatori', closed.materialCents === null && 'materiali',
      closed.partsCents === null && 'ricambi', !!structure.error && 'costi di struttura e capacità produttiva', missingOther && 'altri costi diretti'].filter(Boolean) as string[] }
}
