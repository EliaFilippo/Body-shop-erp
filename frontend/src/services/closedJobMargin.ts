import type { JobPhase, PlannerOperator, RepairJob } from '../types'
import { deliveredJobReport, deliveredWorkPhases } from './deliveredJobReport'
import { isProductionLabourLine } from './liveProduction'

const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100)
const knownAmount = (amount: number | undefined): amount is number =>
  typeof amount === 'number' && Number.isFinite(amount) && amount >= 0

export function recordedPhaseWork(phase: JobPhase, externalOperators: PlannerOperator[]) {
  const signed = knownAmount(phase.tabletWorkedSeconds)
  const assignments = (phase.operatorAssignments ?? []).filter(assignment =>
    assignment.endedAt && knownAmount(assignment.workedMinutes)
    && (!signed || assignment.id.startsWith('tablet:')))
  const recordedSeconds = assignments.reduce((sum, assignment) => sum + assignment.workedMinutes * 60, 0)
  const signedSeconds = phase.tabletWorkedSeconds
  let externalHoursComplete = !externalOperators.length || !knownAmount(signedSeconds)
    || Math.abs(recordedSeconds - signedSeconds) <= 0.5
  const external = assignments.flatMap(assignment => {
    if (!assignment.workedMinutes) return []
    const operator = externalOperators.find(candidate => assignment.id.startsWith('tablet:')
      ? assignment.id === 'tablet:' + candidate.id
      : candidate.name.trim().toLowerCase() === assignment.operatorName.trim().toLowerCase())
    if (!operator) return []
    const rate = operator.externalHourlyCost ?? operator.hourlyCost ?? 0
    if (!knownAmount(rate) || rate === 0) externalHoursComplete = false
    return [{ operator, seconds: assignment.workedMinutes * 60, rate }]
  })
  const seconds = knownAmount(signedSeconds) ? signedSeconds
    : assignments.length && assignments.length === phase.operatorAssignments?.length ? recordedSeconds : null
  return { seconds, external, externalHoursComplete }
}

export function closedJobDirectCosts(job: RepairJob) {
  let directCost = 0
  for (const line of job.lines) {
    if (isProductionLabourLine(line) || line.category === 'materiali' || line.quantity <= 0) continue
    if (!knownAmount(line.budgetDirectUnitCost)) return null
    directCost += line.quantity * line.budgetDirectUnitCost
  }
  return cents(directCost)
}

export function closedJobMargin(job: RepairJob, hourlyCost: number, operators: PlannerOperator[] = [], recordedMaterials?: number) {
  const { complete, workedSeconds, materials } = deliveredJobReport(job)
  const revenueCents = knownAmount(job.taxableAmount) ? cents(job.taxableAmount) : null
  const hourlyRevenue = complete && workedSeconds > 0 && revenueCents !== null
    ? revenueCents / 100 * 3600 / workedSeconds
    : null
  const directCostCents = closedJobDirectCosts(job)

  const externalOperators = operators.filter(operator => operator.costMode === 'external-extra')
  const externalWork = new Map<string, { name: string; seconds: number; rate: number }>()
  let externalHoursComplete = true
  for (const phase of externalOperators.length ? deliveredWorkPhases(job) : []) {
    const work = recordedPhaseWork(phase, externalOperators)
    if (!work.externalHoursComplete) externalHoursComplete = false
    for (const { operator, seconds, rate } of work.external) {
      const total = externalWork.get(operator.id) ?? { name: operator.name, seconds: 0, rate }
      total.seconds += seconds
      externalWork.set(operator.id, total)
    }
  }
  const externalLabor = [...externalWork.values()].map(({ name, seconds, rate }) => ({
    name, seconds, costCents: knownAmount(rate) && rate > 0 ? cents(seconds / 3600 * rate) : null,
  }))
  const externalLaborCents = externalLabor.reduce((sum, row) => sum + (row.costCents ?? 0), 0)

  const materialsToConfirm = materials.actualMaterials === null && knownAmount(recordedMaterials)
  const actualMaterials = materials.actualMaterials ?? recordedMaterials
  const marginCents = complete && revenueCents !== null && knownAmount(actualMaterials)
    && directCostCents !== null && externalHoursComplete && Number.isFinite(hourlyCost) && hourlyCost > 0
    ? revenueCents - cents(actualMaterials) - directCostCents - cents(workedSeconds / 3600 * hourlyCost) - externalLaborCents
    : null

  return { complete, workedSeconds, revenueCents, hourlyRevenue, marginCents, externalHoursComplete, externalLabor, materialsToConfirm }
}
