import type { RepairJob } from '../types'
import { deliveredJobReport } from './deliveredJobReport'
import { isProductionLabourLine } from './liveProduction'

const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100)
const knownAmount = (amount: number | undefined): amount is number =>
  typeof amount === 'number' && Number.isFinite(amount) && amount >= 0

export function closedJobMargin(job: RepairJob, hourlyCost: number) {
  const { complete, workedSeconds, materials } = deliveredJobReport(job)
  const revenueCents = knownAmount(job.taxableAmount) ? cents(job.taxableAmount) : null
  const hourlyRevenue = complete && workedSeconds > 0 && revenueCents !== null
    ? revenueCents / 100 * 3600 / workedSeconds
    : null

  let directCost = 0
  let directCostsComplete = true
  for (const line of job.lines) {
    if (isProductionLabourLine(line) || line.category === 'materiali' || line.quantity <= 0) continue
    if (!knownAmount(line.budgetDirectUnitCost)) {
      directCostsComplete = false
      continue
    }
    directCost += line.quantity * line.budgetDirectUnitCost
  }

  const actualMaterials = materials.actualMaterials ?? undefined
  const marginCents = complete && revenueCents !== null && knownAmount(actualMaterials)
    && directCostsComplete && Number.isFinite(hourlyCost) && hourlyCost > 0
    ? revenueCents - cents(actualMaterials) - cents(directCost) - cents(workedSeconds / 3600 * hourlyCost)
    : null

  return { complete, workedSeconds, revenueCents, hourlyRevenue, marginCents }
}
