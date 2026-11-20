import type { PlannerSettings, RepairJob, Vehicle } from '../types'
import { closedJobMargin } from './closedJobMargin'
import { recordedJobVehicleCosts } from './jobMaterialCosts'
import { quoteStructureRate } from './quoteHourBudget'
import { isProductionLabourLine } from './liveProduction'

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100)
/** Operating result before company taxes; overhead is allocated, never claimed as an actual tax-net profit. */
export function vehicleOperatingProfit(vehicle: Vehicle, job: RepairJob, jobs: RepairJob[], settings: PlannerSettings) {
  const stamp = job.deliveredAt || vehicle.deliveredAt
  const date = stamp && Number.isFinite(Date.parse(stamp))
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date(stamp)) : undefined
  const costs = date ? recordedJobVehicleCosts(vehicle, job, jobs, date) : undefined
  const closed = closedJobMargin(job, settings.operators, costs?.materials, costs?.parts)
  const structure = quoteStructureRate(settings, date?.slice(0, 7))
  const overheadCents = !structure.error && closed.complete ? cents(closed.workedSeconds / 3600 * structure.rate) : null
  const directLines = job.lines.filter(line => !isProductionLabourLine(line) && line.category !== 'ricambi' && line.category !== 'materiali' && line.quantity > 0)
  const missingOther = costs?.other === undefined && directLines.some(line => line.budgetDirectUnitCost === undefined)
  const otherCents = missingOther ? null : cents(costs?.other ?? directLines.reduce((sum, line) => sum + Math.max(0,line.budgetDirectUnitCost ?? 0) * line.quantity, 0))
  const profitCents = closed.marginCents !== null && overheadCents !== null && otherCents !== null
    ? closed.marginCents - overheadCents - otherCents : null
  const materialsEstimated = job.materialActualCost === undefined && costs?.materials === undefined
  return { ...closed, overheadCents, otherCents, profitCents, structureRate: structure.rate,
    percent: profitCents !== null && job.taxableAmount > 0 ? profitCents / job.taxableAmount : null,
    materialsEstimated, partsEstimated: closed.partsEstimated,
    otherEstimated: costs?.other === undefined && directLines.length > 0,
    missing: [!closed.laborComplete && 'ore, attribuzioni o costi orari', closed.materialCents === null && 'materiali',
      closed.partsCents === null && 'ricambi', overheadCents === null && 'costi di struttura e capacità produttiva', missingOther && 'altri costi diretti'].filter(Boolean) as string[] }
}
