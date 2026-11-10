import { expect, it } from 'vitest'
import type { ErpData, JobPhase, RepairJob } from '../types'
import { emptyData } from './erp'
import { calculateGoalProgress } from './goalProgress'

it('attribuisce il valore alle fasi completate e alla consegna senza contarlo due volte', () => {
  const data: ErpData = structuredClone(emptyData)
  data.plannerSettings.monthlyRevenueGoal = 20_000
  const phase = { name: 'Stuccatura', estimatedMinutes: 60, status: 'Completata', completedAt: '2026-11-09T09:00:00Z' } as JobPhase
  const job = { id: 'j1', status: 'In lavorazione', taxableAmount: 500,
    phases: [phase, { ...phase, name: 'Verniciatura', status: 'In lavorazione' }] } as RepairJob
  data.jobs = [job]
  expect(calculateGoalProgress(data, '2026-11-10').map(({ done }) => done)).toEqual([0, 250, 250])
  data.jobs = [{ ...job, status: 'Consegnata', deliveredAt: '2026-11-10T10:00:00Z' }]
  expect(calculateGoalProgress(data, '2026-11-10').map(({ done, billed }) => [done, billed])).toEqual([[250, 0], [500, 0], [500, 0]])
})
