import type { ErpData, JobPhase, PlannerOperator, RepairJob } from '../types'
import { quoteOperatorRate, quoteStructureRate } from './quoteHourBudget'
import { prefersOperatorDuty } from './operatorSkills'
import { addWorkingMinutes, getOperatorWorkingIntervals, nextWorkingInstant } from './workCalendar'

/** Economic preference only: never changes the quote or starts an operator's timer. */
export function rankPhaseOperators<T extends { operator: PlannerOperator; nextAt: string }>(
  data: ErpData, job: RepairJob, phase: JobPhase, candidates: T[], minutes: number, floor: string, ready: string,
): { operators: T[]; reason: string } {
  const support = candidates.find(c => c.operator.id === phase.supportOperatorId && c.operator.id !== phase.preferredOperatorId)
  if (phase.supportOperatorId && !support) {
    const primary = rankPhaseOperators(data, job, { ...phase, supportOperatorId: undefined }, candidates, minutes, floor, ready)
    return { operators: primary.operators.slice(0, 1), reason: `${primary.reason} · affiancamento non disponibile` }
  }
  if (support) {
    const primary = rankPhaseOperators(data, job, { ...phase, supportOperatorId: undefined }, candidates.filter(c => c.operator.id !== support.operator.id), minutes, floor, ready)
    return { operators: primary.operators.length ? [...primary.operators.slice(0, 1), support] : [], reason: `${primary.reason} · secondo operatore scelto dall’ufficio` }
  }
  if (phase.preferredOperatorId) return {
    operators: candidates.filter(c => c.operator.id === phase.preferredOperatorId), reason: 'Operatore scelto dall’ufficio',
  }
  const workingNames = (phase.operatorAssignments ?? []).filter(a => a.activityStatus === 'Attivo' && !a.endedAt).map(a => a.operatorName)
  if (workingNames.length) return { operators: candidates.filter(c => workingNames.includes(c.operator.name)), reason: 'Prosegue il lavoro degli operatori già attivi' }
  const day = [floor, ready].sort().at(-1)!.slice(0, 10)
  const present = candidates.filter(c => getOperatorWorkingIntervals(day, data.plannerSettings, c.operator).length > 0
    && nextWorkingInstant([floor, ready].sort().at(-1)!, data.plannerSettings, c.operator).slice(0, 10) === day)
  const preferred = present.filter(c => prefersOperatorDuty(c.operator, phase.requiredSkill || phase.name))
  if (preferred.length) return { operators: [...preferred].sort((a,b) => a.nextAt.localeCompare(b.nextAt)),
    reason: 'Precedenza per mansione: operatore presente; sostituzione automatica in assenza' }
  if (present.length) candidates = present
  const structure = quoteStructureRate(data.plannerSettings, floor.slice(0, 7))
  const marginPercent = Math.min(100, Math.max(0, data.plannerSettings.internalCostSettings?.minimumMarginPercent ?? 0))
  const materialsPercent = Math.min(100, Math.max(0, data.plannerSettings.internalCostSettings?.budgetMaterialsPercent ?? 20))
  const materials = job.lines.filter(l => ['carrozzeria', 'verniciatura', 'meccanica'].includes(l.category))
    .reduce((sum, l) => sum + Math.max(0, l.taxableAmount) * materialsPercent / 100, 0)
  const directLines = job.lines.filter(l => ['ricambi', 'servizi esterni', 'altre'].includes(l.category) || (l.category === 'materiali' && l.budgetDirectUnitCost !== undefined))
  const missingDirectCost = directLines.some(l => l.quantity > 0 && l.unitPrice > 0 && l.budgetDirectUnitCost === undefined)
  const direct = directLines.reduce((sum, l) => sum + Math.max(0, l.quantity) * Math.max(0, l.budgetDirectUnitCost ?? 0), 0)
  // Reserve structure and the configured target margin across the whole planned job.
  const hours = job.phases.filter(p => !p.notRequired && p.name !== 'Consegna').reduce((sum, p) => sum + Math.max(0, p.estimatedMinutes), 0) / 60
  const available = job.taxableAmount * (1 - marginPercent / 100) - materials - direct
  const byStart = [...candidates].sort((a, b) => a.nextAt.localeCompare(b.nextAt) || a.operator.id.localeCompare(b.operator.id))
  const finish = (c: T) => {
    const start = [c.nextAt, floor, ready].sort().at(-1)!
    return addWorkingMinutes(nextWorkingInstant(start, data.plannerSettings, c.operator), minutes, data.plannerSettings, c.operator)
  }
  const deadline = job.agreedDeliveryDate || job.expectedDeliveryDate
  const onTime = deadline ? byStart.filter(c => finish(c).slice(0, 10) <= deadline) : byStart
  const earliestFinishDay = byStart.length ? byStart.map(c => finish(c).slice(0, 10)).sort()[0] : ''
  const pool = onTime.length ? onTime : byStart.filter(c => finish(c).slice(0, 10) === earliestFinishDay)
  if (structure.error || missingDirectCost || hours <= 0) return { operators: pool, reason: 'Automatico: dati economici incompleti, primo operatore disponibile' }
  const configured = pool.filter(c => !quoteOperatorRate(data.plannerSettings, c.operator.id).error)
  if (!configured.length) return { operators: pool, reason: 'Automatico: costi operatori da configurare' }
  const rate = (c: T) => quoteOperatorRate(data.plannerSettings, c.operator.id).rate
  const affordable = configured.filter(c => hours * (structure.rate + rate(c)) <= available + 0.001)
  const selected = affordable.length ? affordable : configured
  selected.sort((a, b) => (affordable.length ? rate(b) - rate(a) : rate(a) - rate(b)) || a.nextAt.localeCompare(b.nextAt) || a.operator.id.localeCompare(b.operator.id))
  return { operators: selected, reason: affordable.length
    ? 'Automatico per margine: operatore più costoso sostenibile sul tempo previsto'
    : 'Margine insufficiente sul tempo previsto: operatore meno costoso disponibile' }
}
