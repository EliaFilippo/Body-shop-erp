import { expect, it } from 'vitest'
import type { NightlyEconomicSnapshot } from '../types'
import { emptyData } from './erp'
import { marginTargetRate } from './marginTargetRate'

it('updates the hourly revenue needed immediately when the margin goal changes', () => {
  const data = structuredClone(emptyData)
  data.plannerSettings.monthlyRevenueGoal = 1
  data.plannerSettings.monthlyMarginGoal = 10_000
  data.plannerSettings.internalCostSettings = {
    internalHourlyRate: 0, minimumMarginPercent: 0, useManualHourlyRate: true, manualHourlyRate: 55, budgetMaterialsPercent: 20,
  }
  data.plannerSettings.operators = [
    { id: 'internal', name: 'Interno', hourlyCost: 30, active: true, dailyHours: 8 },
    { id: 'martin', name: 'Martin', active: true, dailyHours: 8, costMode: 'external-extra', externalHourlyCost: 40 },
  ]
  data.nightlyPlanning = {
    ...data.nightlyPlanning!, economics: { monthKey: '2026-11', plannedFor: '2026-11-11', remainingProductiveHours: 400 } as NightlyEconomicSnapshot,
  }
  const progress = { done: 2_000, incomplete: false }
  expect(marginTargetRate(data, '2026-11', '2026-11-11', progress)).toMatchObject({
    remainingMargin: 8000, hours: 400, hourlyCost: 35, hourlyRate: 68.75,
  })
  data.plannerSettings.monthlyMarginGoal = 14_000
  expect(marginTargetRate(data, '2026-11', '2026-11-11', progress)).toMatchObject({
    remainingMargin: 12000, hourlyRate: 81.25,
  })
})
