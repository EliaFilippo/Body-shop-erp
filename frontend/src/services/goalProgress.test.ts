import { expect, it } from 'vitest'
import type { JobPhase, RepairJob } from '../types'
import { emptyData } from './erp'
import { calculateGoalProgress } from './goalProgress'

function makeReportJob() {
  return { id: 'j1', status: 'Pianificata', taxableAmount: 500, lines: [], phases: [] } as unknown as RepairJob
}

const completedPhase: JobPhase = {
  id: 'body', name: 'Stuccatura', estimatedMinutes: 60, actualMinutes: 60,
  status: 'Completata', notes: '', blockedReason: '', completedAt: '2026-11-09T09:00:00Z',
  tabletWorkedSeconds: 3600,
  operatorAssignments: [{
    id: 'tablet:martin', operatorName: 'Martin', workedMinutes: 60, activityStatus: 'Concluso',
    startedAt: '2026-11-09T08:00:00Z', endedAt: '2026-11-09T09:00:00Z',
  }],
}

it('subtracts Martin, internal labor and materials and reconciles delivery without counting them twice', () => {
  const data = structuredClone(emptyData)
  data.plannerSettings.monthlyRevenueGoal = 20_000
  data.plannerSettings.monthlyMarginGoal = 3_000
  data.plannerSettings.internalCostSettings = {
    internalHourlyRate: 0, minimumMarginPercent: 0, useManualHourlyRate: true, manualHourlyRate: 30,
  }
  data.plannerSettings.operators = [{
    id: 'martin', name: 'Martin', costMode: 'external-extra', externalHourlyCost: 40, dailyHours: 8, active: true,
  }]
  const job = makeReportJob()
  job.status = 'In lavorazione'
  job.materialActualCost = { amount: 100, at: '', note: '' }
  const other = { ...completedPhase.operatorAssignments[0], id: 'tablet:other', operatorName: 'Altro',
    startedAt: '2026-11-10T08:00:00Z', endedAt: '2026-11-10T09:00:00Z' }
  job.phases = [completedPhase, { ...completedPhase, id: 'paint', name: 'Verniciatura', status: 'In lavorazione',
    completedAt: undefined, operatorAssignments: [other] }]
  data.jobs = [job]
  expect(calculateGoalProgress(data, '2026-11-10').map(({ done }) => done)).toEqual([0, 130, 130])
  job.phases[1] = { ...job.phases[1], status: 'Completata', completedAt: other.endedAt }
  job.status = 'Consegnata'
  job.deliveredAt = '2026-11-10T10:00:00Z'
  const result = calculateGoalProgress(data, '2026-11-10')
  expect(result.map(({ done, billed }) => [done, billed])).toEqual([[170, 0], [300, 0], [300, 0]])
  expect(result[2]).toMatchObject({ goal: 3000, gap: 2700, percent: 10, incomplete: false })
})

it('marks the period incomplete when a signed phase has hours without operator attribution', () => {
  const data = structuredClone(emptyData)
  data.plannerSettings.operators = [{
    id: 'martin', name: 'Martin', costMode: 'external-extra', externalHourlyCost: 40, dailyHours: 8, active: true,
  }]
  const job = makeReportJob()
  job.status = 'In lavorazione'
  job.phases = [{ ...completedPhase, operatorAssignments: [] }]
  data.jobs = [job]
  expect(calculateGoalProgress(data, '2026-11-09')[0]).toMatchObject({
    incomplete: true, hasMargin: false, percent: null,
  })
})
