import { describe, expect, it, vi } from 'vitest'
import { liveCountdown, prepareLiveJob, productionRpc, type LiveClock } from './liveProduction'
import { emptyData } from './erp'
import type { RepairJob } from '../types'

const clock: LiveClock = { jobId: 'j', plate: 'TEST', number: '1', remainingSeconds: 7200,
  remainingPercent: 100, activeCount: 2, ownStatus: 'running', operators: [] }
describe('tablet budget clock', () => {
  it('uses authoritative shared team time and crosses the warning threshold precisely', () => {
    expect(liveCountdown(clock, 5760)).toMatchObject({ seconds: 1440, percent: 20, warning: true })
    expect(liveCountdown(clock, 5759).warning).toBe(false)
    expect(liveCountdown(clock, 8000)).toMatchObject({ seconds: 0, percent: 0, exhausted: true })
    expect(liveCountdown({ ...clock, activeCount: 0 }, 8000)).toMatchObject({ seconds: 7200, percent: 100 })
  })
  it('prepares a vehicle budget net of VAT, materials, parts and external costs, with individual operator rates', () => {
    const data = structuredClone(emptyData)
    data.plannerSettings.internalCostSettings = { internalHourlyRate: 0, minimumMarginPercent: 0, budgetMaterialsPercent: 20, budgetUseManualStructureRate: true, budgetManualStructureRate: 30 }
    data.plannerSettings.operators = [{ id: 'a', name: 'A', active: true, dailyHours: 8, hourlyCost: 20 }, { id: 'b', name: 'B', active: true, dailyHours: 8, hourlyCost: 30 }]
    const job = { status: 'In lavorazione', taxableAmount: 200, lines: [
      { category: 'carrozzeria', quantity: 1, unitPrice: 150, discount: 0 },
      { category: 'ricambi', quantity: 1, unitPrice: 50, discount: 0, budgetDirectUnitCost: 40 },
    ] } as RepairJob
    expect(prepareLiveJob(data, job)).toMatchObject({ budget: 130, materials: 30, directCosts: 40, operators: [{ id: 'a', rate: 50 }, { id: 'b', rate: 60 }] })
    job.lines[1].quantity = 2
    expect(prepareLiveJob(data, job).directCosts).toBe(80)
    delete job.lines[1].budgetDirectUnitCost
    expect(() => prepareLiveJob(data, job)).toThrow('costi diretti')
    data.plannerSettings.operators[0].hourlyCost = 0
    expect(() => prepareLiveJob(data, job)).toThrow('costo orario')
  })
  it('does not fabricate an offline success and reports a missing backend clearly', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 'PGRST202' }), { status: 404 }))
    await expect(productionRpc('production_live_feed', {}, { accessToken: 'token' } as never, { url: 'https://example.test', anonKey: 'public' }, fetcher)).rejects.toThrow('attivata su Supabase')
  })
})
