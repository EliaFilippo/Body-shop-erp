import { describe, expect, it } from 'vitest'
import type { PlannerSettings } from '../types'
import { buildAcceptanceQuoteSummary, createDefaultQuote, calculateMonthlyHourlyRate } from './acceptance'

const settings: PlannerSettings = {
  operators: [
    { id: 'op-1', name: 'Mario', dailyHours: 8, active: true },
    { id: 'op-2', name: 'Luca', dailyHours: 8, active: true },
  ],
  workingDays: [1, 2, 3, 4, 5],
  efficiencyPercent: 80,
  safetyMarginPercent: 15,
  holidays: [],
  closures: [],
  absences: [],
  monthlyRevenueGoal: 24000,
  monthlyMarginGoal: null,
}

describe('accettazione preventiva', () => {
  it('calcola la tariffa oraria mensile dalle ore produttive disponibili', () => {
    const result = calculateMonthlyHourlyRate(settings, '2026-08', '2026-08-03')
    expect(result.rate).toBe(24000 / (5 * 2 * 8 * 0.8))
    expect(result.productiveHours).toBe(5 * 2 * 8 * 0.8)
  })

  it('crea un preventivo con materiale consumo inizialmente al 20% della manodopera', () => {
    const quote = createDefaultQuote(settings, '2026-08', 100)
    const summary = buildAcceptanceQuoteSummary(quote)
    expect(summary.materials.total).toBe(7500)
    expect(summary.total).toBeCloseTo(54900)
    expect(summary.marginPercent).toBeCloseTo(18.03)
  })
})
