import type { ErpData } from '../types'
import { closedPlanningWork, waitingPartsPlanningWork } from './closedPlanningWork'
import { deliveredWorkPhases } from './deliveredJobReport'
import { phaseManWorkedMinutes } from './planner'
import { toRomePlanningClock } from './romePlanningClock'
import { supportsOperatorDuty } from './operatorSkills'
import { phaseDisplayName } from './workCycle'
import { addDays, workingMinutesForDate } from './workCalendar'

/** Compare confirmed residual work with the slots actually assigned by the planner. */
export function workCoverage(data: ErpData, today: string, now: string) {
  const through = addDays(today, 6)
  const closed = closedPlanningWork(data).jobIds
  const waiting = waitingPartsPlanningWork(data).jobIds
  const programs = new Map<string, number>()
  const byDuty = new Map<string, { duty: string; residual: number; scheduled: number; blocked: number; untimed: number }>()
  const settings = data.plannerSettings
  const operators = new Map(settings.operators.filter(operator => operator.active).map(operator => [operator.id, operator]))
  const plannerNow = toRomePlanningClock(now)
  const openPhases = new Map((data.jobs ?? []).filter(job => !closed.has(job.id) && !waiting.has(job.id)
    && job.status !== 'Pronta consegna' && job.status !== 'In attesa').flatMap(job =>
      deliveredWorkPhases(job).filter(phase => !['Completata', 'Bloccata'].includes(phase.status))
        .map(phase => [job.id + '/' + phase.id, phase] as const)))
  const seen = new Set<string>()
  for (const program of data.operatorPrograms ?? []) {
    const operator = operators.get(program.operatorId)
    if (!operator || program.date < today || program.date > through) continue
    let capacity = workingMinutesForDate(program.date, settings, operator)
    for (const task of program.tasks) {
      const key = task.jobId + '/' + task.phaseId
      const phase = openPhases.get(key)
      if (!phase || !supportsOperatorDuty(operator, phase.requiredSkill || phase.name) || seen.has(task.id) || task.endAt <= plannerNow) continue
      const slotRemaining = (Date.parse(task.endAt) - Math.max(Date.parse(task.startAt), Date.parse(plannerNow))) / 60_000
      const minutes = Math.max(0, Math.min(capacity, task.plannedMinutes, slotRemaining))
      seen.add(task.id)
      capacity -= minutes
      programs.set(key, (programs.get(key) ?? 0) + minutes)
    }
  }
  for (const job of data.jobs ?? []) {
    if (closed.has(job.id) || job.status === 'Pronta consegna') continue
    const groups = new Map<string, ReturnType<typeof deliveredWorkPhases>>()
    for (const phase of deliveredWorkPhases(job)) {
      if (phase.status === 'Completata') continue
      const key = phase.sharedTimeKey ?? phase.id
      const existing = groups.get(key)
      if (existing) existing.push(phase)
      else groups.set(key, [phase])
    }
    for (const phases of groups.values()) {
      const phase = phases[0]
      const duty = phases.map(item => phaseDisplayName(item.name)).join(' / ')
      const row = byDuty.get(duty) ?? { duty, residual: 0, scheduled: 0, blocked: 0, untimed: 0 }
      const budget = phase.sharedTimeMinutes ?? phases.reduce((sum, item) => sum + Math.max(0, item.estimatedMinutes), 0)
      const members = phase.sharedTimeKey ? job.phases.filter(item => item.sharedTimeKey === phase.sharedTimeKey) : phases
      const worked = members.reduce((sum, item) => sum + Math.max(item.actualMinutes || 0, (item.tabletWorkedSeconds ?? 0) / 60, phaseManWorkedMinutes(item, now)), 0)
      const residual = Math.max(0, budget - worked)
      if (budget <= 0) row.untimed += 1
      row.residual += residual
      if (job.status === 'In attesa' || waiting.has(job.id) || phases.every(item => item.status === 'Bloccata')) row.blocked += residual
      else row.scheduled += Math.min(residual, phases.reduce((sum, item) => sum + (programs.get(job.id + '/' + item.id) ?? 0), 0))
      byDuty.set(duty, row)
    }
  }
  return [...byDuty.values()].sort((a, b) => b.residual - a.residual || a.duty.localeCompare(b.duty))
}
