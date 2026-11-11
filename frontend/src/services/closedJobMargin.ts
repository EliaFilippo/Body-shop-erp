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

function directCostBreakdown(job: RepairJob, recordedParts?: number) {
  let parts = knownAmount(recordedParts) ? recordedParts : 0
  let other = 0
  let partsComplete = true
  let otherComplete = true
  let partsEstimated = false
  for (const line of job.lines) {
    if (isProductionLabourLine(line) || line.category === 'materiali' || line.quantity <= 0) continue
    const unitCost = line.budgetDirectUnitCost
    if (line.category === 'ricambi') {
      if (knownAmount(recordedParts)) continue
      if (knownAmount(unitCost)) {
        parts += line.quantity * unitCost
        partsEstimated = true
      } else partsComplete = false
    } else if (knownAmount(unitCost)) other += line.quantity * unitCost
    else otherComplete = false
  }
  return { partsCents: partsComplete ? cents(parts) : null, otherDirectCents: otherComplete ? cents(other) : null, partsEstimated }
}

export function closedJobDirectCosts(job: RepairJob, recordedParts?: number) {
  const { partsCents, otherDirectCents } = directCostBreakdown(job, recordedParts)
  return partsCents === null || otherDirectCents === null ? null : partsCents + otherDirectCents
}

export function closedJobMargin(job: RepairJob, hourlyCost: number, operators: PlannerOperator[] = [], recordedMaterials?: number, recordedParts?: number) {
  const { complete, workedSeconds, materials } = deliveredJobReport(job)
  const revenueCents = knownAmount(job.taxableAmount) ? cents(job.taxableAmount) : null
  const hourlyRevenue = complete && workedSeconds > 0 && revenueCents !== null
    ? revenueCents / 100 * 3600 / workedSeconds
    : null
  const { partsCents, otherDirectCents, partsEstimated } = directCostBreakdown(job, recordedParts)

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
  const materialCents = knownAmount(actualMaterials) ? cents(actualMaterials) : null
  const laborCents = complete && Number.isFinite(hourlyCost) && hourlyCost > 0 ? cents(workedSeconds / 3600 * hourlyCost) : null
  const marginCents = revenueCents !== null && materialCents !== null && partsCents !== null && otherDirectCents !== null
    && externalHoursComplete && laborCents !== null
    ? revenueCents - materialCents - partsCents - otherDirectCents - laborCents - externalLaborCents
    : null

  return { complete, workedSeconds, revenueCents, hourlyRevenue, marginCents, externalHoursComplete, externalLabor,
    materialsToConfirm, materialCents, laborCents, partsCents, otherDirectCents, partsEstimated }
}
