import type { JobPhase, PlannerOperator, RepairJob } from '../types'
import { deliveredJobReport, deliveredPhaseTime, deliveredWorkPhases } from './deliveredJobReport'

const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100)
const knownAmount = (amount: number | undefined): amount is number =>
  typeof amount === 'number' && Number.isFinite(amount) && amount >= 0

export function operatorHourlyCost(operator: PlannerOperator) {
  const rate = operator.costMode === 'external-extra' ? operator.externalHourlyCost ?? operator.hourlyCost : operator.hourlyCost
  return knownAmount(rate) && rate > 0 ? rate : null
}

export function recordedPhaseLabor(phase: JobPhase, operators: PlannerOperator[]) {
  const { closed, assignmentsComplete } = deliveredPhaseTime(phase)
  const workers = closed.filter(assignment => assignment.workedMinutes > 0).map(assignment => {
    const name = assignment.operatorName.trim()
    const byId = operators.find(operator => assignment.id === 'tablet:' + operator.id)
    const byName = operators.filter(operator => operator.name.trim().toLowerCase() === name.toLowerCase())
    const operator = byId ?? (byName.length === 1 ? byName[0] : undefined)
    return {
      id: operator?.id ?? 'unmatched:' + name.toLowerCase(), name: operator?.name ?? name,
      seconds: assignment.workedMinutes * 60, rate: operator ? operatorHourlyCost(operator) : null,
    }
  })
  return { workers, complete: assignmentsComplete && workers.every(worker => worker.rate !== null) }
}

export function closedJobPartsCost(job: RepairJob, recordedParts?: number) {
  if (knownAmount(recordedParts)) return { partsCents: cents(recordedParts), availablePartsCents: cents(recordedParts), partsEstimated: false }
  let parts = 0
  let partsEstimated = false
  let missingPartsCost = false
  for (const line of job.lines) {
    if (line.category !== 'ricambi' || line.quantity <= 0) continue
    if (knownAmount(line.budgetDirectUnitCost)) {
      parts += line.quantity * line.budgetDirectUnitCost
      partsEstimated = true
    } else {
      missingPartsCost = true
    }
  }
  return { partsCents: missingPartsCost ? null : cents(parts), availablePartsCents: cents(parts), partsEstimated }
}

export function closedJobMargin(job: RepairJob, operators: PlannerOperator[], recordedMaterials?: number, recordedParts?: number) {
  const { complete, workedSeconds, materials } = deliveredJobReport(job)
  const revenueCents = knownAmount(job.taxableAmount) ? cents(job.taxableAmount) : null
  const hourlyRevenue = complete && workedSeconds > 0 && revenueCents !== null
    ? revenueCents / 100 * 3600 / workedSeconds
    : null
  const { partsCents, availablePartsCents, partsEstimated } = closedJobPartsCost(job, recordedParts)

  const workers = new Map<string, ReturnType<typeof recordedPhaseLabor>['workers'][number]>()
  let laborComplete = complete
  const phasesWithoutTime = new Set<string>()
  for (const phase of deliveredWorkPhases(job)) {
    if (!deliveredPhaseTime(phase).timeComplete) phasesWithoutTime.add(phase.name)
    const labor = recordedPhaseLabor(phase, operators)
    if (!labor.complete) laborComplete = false
    for (const worker of labor.workers) {
      const total = workers.get(worker.id)
      if (total) total.seconds += worker.seconds
      else workers.set(worker.id, { ...worker })
    }
  }
  const operatorLabor = [...workers.values()].map(({ id, name, seconds, rate }) => ({
    id, name, seconds, costCents: rate === null ? null : cents(seconds / 3600 * rate),
  }))
  const availableLaborCents = operatorLabor.reduce((sum, worker) => sum + (worker.costCents ?? 0), 0)
  const laborCents = laborComplete ? availableLaborCents : null
  const materialCost = materials.actualMaterials ?? recordedMaterials
    ?? (job.lines.length > 0 ? materials.estimatedMaterials : undefined)
  const materialCents = knownAmount(materialCost) ? cents(materialCost) : null
  const materialsToConfirm = materials.actualMaterials === null && materialCents !== null
  const marginCents = revenueCents !== null && materialCents !== null && partsCents !== null && laborCents !== null
    ? revenueCents - materialCents - partsCents - laborCents
    : null

  const availableMarginCents = revenueCents === null ? null
    : revenueCents - (materialCents ?? 0) - availablePartsCents - availableLaborCents

  return { complete, workedSeconds, revenueCents, hourlyRevenue, marginCents, laborComplete, operatorLabor,
    materialsToConfirm, materialCents, laborCents, partsCents, partsEstimated, phasesWithoutTime: [...phasesWithoutTime],
    availableMarginCents, availableLaborCents, availablePartsCents }
}
