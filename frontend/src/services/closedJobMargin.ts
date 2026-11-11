import type { PlannerOperator, RepairJob } from '../types'
import { deliveredJobReport, deliveredWorkPhases } from './deliveredJobReport'
import { isProductionLabourLine } from './liveProduction'

const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100)
const knownAmount = (amount: number | undefined): amount is number =>
  typeof amount === 'number' && Number.isFinite(amount) && amount >= 0

export function closedJobMargin(job: RepairJob, hourlyCost: number, operators: PlannerOperator[] = []) {
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

  const externalOperators = operators.filter(operator => operator.costMode === 'external-extra')
  const externalWork = new Map<string, { name: string; seconds: number; rate: number }>()
  let externalHoursComplete = true
  for (const phase of externalOperators.length ? deliveredWorkPhases(job) : []) {
    const signedSeconds = phase.tabletWorkedSeconds
    const assignments = (phase.operatorAssignments ?? []).filter(assignment =>
      assignment.endedAt && knownAmount(assignment.workedMinutes)
      && (!knownAmount(signedSeconds) || assignment.id.startsWith('tablet:')))
    if (knownAmount(signedSeconds)
      && Math.abs(assignments.reduce((sum, assignment) => sum + assignment.workedMinutes * 60, 0) - signedSeconds) > 0.5) {
      externalHoursComplete = false
    }
    for (const assignment of assignments) {
      if (assignment.workedMinutes === 0) continue
      const operator = externalOperators.find(candidate => assignment.id.startsWith('tablet:')
        ? assignment.id === 'tablet:' + candidate.id
        : candidate.name.trim().toLowerCase() === assignment.operatorName.trim().toLowerCase())
      if (!operator) continue
      const rate = operator.externalHourlyCost ?? operator.hourlyCost ?? 0
      if (!knownAmount(rate) || rate === 0) externalHoursComplete = false
      const total = externalWork.get(operator.id) ?? { name: operator.name, seconds: 0, rate }
      total.seconds += assignment.workedMinutes * 60
      externalWork.set(operator.id, total)
    }
  }
  const externalLabor = [...externalWork.values()].map(({ name, seconds, rate }) => ({
    name, seconds, costCents: knownAmount(rate) && rate > 0 ? cents(seconds / 3600 * rate) : null,
  }))
  const externalLaborCents = externalLabor.reduce((sum, row) => sum + (row.costCents ?? 0), 0)

  const actualMaterials = materials.actualMaterials ?? undefined
  const marginCents = complete && revenueCents !== null && knownAmount(actualMaterials)
    && directCostsComplete && externalHoursComplete && Number.isFinite(hourlyCost) && hourlyCost > 0
    ? revenueCents - cents(actualMaterials) - cents(directCost) - cents(workedSeconds / 3600 * hourlyCost) - externalLaborCents
    : null

  return { complete, workedSeconds, revenueCents, hourlyRevenue, marginCents, externalHoursComplete, externalLabor }
}
