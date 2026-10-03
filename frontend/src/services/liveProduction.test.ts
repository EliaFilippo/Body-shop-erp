import { describe, expect, it, vi } from 'vitest'
import { applyLivePhaseChecks, interpolateHours, liveCountdown, prepareLiveJob, productionRpc, type LiveClock, type HoursReport } from './liveProduction'
import { emptyData } from './erp'
import type { RepairJob } from '../types'

const clock: LiveClock = { jobId: 'j', plate: 'TEST', number: '1', remainingSeconds: 7200,
  remainingPercent: 100, activeCount: 2, ownStatus: 'running', operators: [] }
describe('tablet budget clock', () => {
  it('imports a signed phase into the office workflow once and restores it after a stale overwrite', () => {
    const data = structuredClone(emptyData)
    data.jobs = [{ id: 'j', history: [], phases: [{ id: 'p', name: 'Preparazione', status: 'Da fare' }] } as unknown as RepairJob]
    const check = { jobId: 'j', phaseId: 'p', checkedBy: 'Mario', checkedAt: '2026-10-03T10:00:00Z', workedSeconds: 7200 }
    const next = applyLivePhaseChecks(data, [check])
    expect(next.jobs![0].phases[0]).toMatchObject({ status: 'Completata', completedByName: 'Mario', tabletWorkedSeconds: 7200 })
    expect(next.jobs![0].history[0].actor).toBe('Mario')
    expect(data.jobs[0].phases[0].status).toBe('Da fare')
    expect(applyLivePhaseChecks(next, [check])).toBe(next)
    next.jobs![0].phases[0].status = 'Da fare'
    expect(applyLivePhaseChecks(next, [check]).jobs![0].history).toHaveLength(1)
  })
  it('shows different individual capacity on one shared budget and consumes both with the whole team', () => {
    const a = { ...clock, remainingSeconds: 3600, ownRemainingSeconds: 8640, ownBurnFactor: 120 / 50 }
    const b = { ...clock, remainingSeconds: 3600, ownRemainingSeconds: 120 / 70 * 3600, ownBurnFactor: 120 / 70 }
    expect(liveCountdown(a, 60).individualSeconds).toBe(8496)
    expect(liveCountdown(b, 60).individualSeconds).toBeCloseTo(120 / 70 * 3540)
    expect(liveCountdown(a, 60).seconds).toBe(liveCountdown(b, 60).seconds)
    expect(liveCountdown(a, 2880).warning).toBe(true)
    expect(liveCountdown(b, 2880).warning).toBe(true)
  })
  it('updates daily productive hours and overtime across the configured threshold, preserving pauses', () => {
    const report: HoursReport = { operatorId: 'a', name: 'A', serverNow: '', from: '2026-10-03', to: '2026-10-03', workedSeconds: 28770,
      ordinarySeconds: 28770, extraSeconds: 0, unconfigured: false,
      days: [{ date: '2026-10-03', workedSeconds: 28770, plannedSeconds: 28800, ordinarySeconds: 28770, extraSeconds: 0, running: true }] }
    expect(interpolateHours(report, 90)).toMatchObject({ workedSeconds: 28860, ordinarySeconds: 28800, extraSeconds: 60 })
    report.days[0].running = false
    expect(interpolateHours(report, 90).workedSeconds).toBe(28770)
    report.days[0].plannedSeconds = null
    expect(interpolateHours(report, 90)).toMatchObject({ ordinarySeconds: null, extraSeconds: null, unconfigured: true })
  })
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
