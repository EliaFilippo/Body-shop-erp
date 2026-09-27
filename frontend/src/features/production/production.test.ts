import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { loadDatabase, saveDatabase } from '../../services/database'
import { emptyData } from '../../services/erp'
import {
  buildTodayInShopSnapshot,
  markVehicleReady,
  isFinancialViewRestricted,
  moveProductionPhase,
  pauseProductionTimer,
  reportProductionIssue,
  resumeProductionTimer,
  resolveVehicleBlock,
  signalVehicleBlock,
  startProductionTimer,
  startVehiclePhase,
  stopProductionTimer,
  syncProductionJobsFromVehicles,
  timerMinutesByVehicleAndPhase,
  paceStateByVehicle,
  runProductionDelayControl,
} from './production'

function seedData() {
  const base = structuredClone(emptyData)
  base.customers = [{
    id: 'c1',
    type: 'Privato',
    name: 'Mario Rossi',
    phone: '3331234567',
    email: '',
    taxId: '',
    address: '',
    createdAt: new Date().toISOString(),
  }]
  base.vehicles = [{
    id: 'v1',
    customerId: 'c1',
    plate: 'AB123CD',
    make: 'Fiat',
    model: 'Panda',
    color: 'Bianco',
    year: '2020',
    vin: 'VIN123',
    mileage: '50000',
    status: 'in lavorazione',
    deliveryDate: '',
    estimatedHours: 8,
    workedHours: 0,
    plannedEntryDate: '2026-01-02',
    requestedDeliveryDate: '2099-12-31',
    calculatedDeliveryDate: '',
    expectedRevenue: 1000,
    expectedMargin: 300,
    partsStatus: 'Disponibili',
    blockReason: '',
    coneNumber: null,
    priority: 'Alta',
    manualPlanningDate: '',
    createdAt: new Date().toISOString(),
  }]
  return syncProductionJobsFromVehicles(base)
}

describe('production tablet workflow', () => {
  it('moves phase and writes history', () => {
    const data = seedData()
    const moved = moveProductionPhase(data, {
      vehicleId: 'v1',
      nextPhase: 'Verniciatura',
      operator: { role: 'production', operatorId: 'op1', operatorName: 'Operatore 1' },
    })
    expect(moved.production?.jobs[0].phase).toBe('Verniciatura')
    expect(moved.production?.phaseHistory[0].previousPhase).toBe('Preparazione')
    expect(moved.production?.phaseHistory[0].nextPhase).toBe('Verniciatura')
  })

  it('handles timer start pause resume stop', () => {
    const data = seedData()
    const started = startProductionTimer(data, {
      vehicleId: 'v1',
      phase: 'Preparazione',
      operator: { role: 'production', operatorId: 'op1', operatorName: 'Operatore 1' },
    })
    const logId = started.production?.workLogs[0].id as string
    expect(started.production?.workLogs[0].status).toBe('running')

    const paused = pauseProductionTimer(started, logId)
    expect(paused.production?.workLogs[0].status).toBe('paused')

    const resumed = resumeProductionTimer(paused, logId)
    expect(resumed.production?.workLogs[0].status).toBe('running')

    const stopped = stopProductionTimer(resumed, logId)
    expect(stopped.production?.workLogs[0].status).toBe('completed')
    expect(timerMinutesByVehicleAndPhase(stopped, 'v1', 'Preparazione')).toBeGreaterThanOrEqual(0)
  })

  it('creates production report', () => {
    const data = seedData()
    const next = reportProductionIssue(data, {
      vehicleId: 'v1',
      type: 'ricambio mancante',
      note: 'Paraurti non disponibile in magazzino.',
      operator: { role: 'production', operatorId: 'op1', operatorName: 'Operatore 1' },
    })
    expect(next.production?.reports.length).toBe(1)
    expect(next.production?.reports[0].resolvedAt).toBeUndefined()
  })

  it('blocks finance access for production role', () => {
    expect(isFinancialViewRestricted({ role: 'production', operatorId: 'op1', operatorName: 'Operatore 1' })).toBe(true)
    expect(isFinancialViewRestricted({ role: 'office', operatorId: 'op2', operatorName: 'Ufficio' })).toBe(false)
  })

  it('builds today snapshot with overdue and alerts', () => {
    const data = seedData()
    data.production!.jobs[0].promisedAt = '2000-01-01'
    const withReport = reportProductionIssue(data, {
      vehicleId: 'v1',
      type: 'problema tecnico',
      note: 'Sensore difettoso.',
      operator: { role: 'production', operatorId: 'op1', operatorName: 'Operatore 1' },
    })
    const snapshot = buildTodayInShopSnapshot(withReport)
    expect(snapshot.alertsOpen).toBe(1)
    expect(snapshot.overdue).toBe(1)
    expect(snapshot.phaseCards.some((card) => card.jobs.length > 0)).toBe(true)
  })

  it('signals and resolves block updating vehicle state', () => {
    const data = seedData()
    const blocked = signalVehicleBlock(data, 'v1', 'ricambio mancante', 'Specchio non disponibile', { role: 'production', operatorId: 'op1', operatorName: 'Operatore 1' })
    expect(blocked.vehicles[0].blockReason).toBe('Specchio non disponibile')
    expect(blocked.vehicles[0].partsStatus).toBe('Mancanti')
    const reportId = blocked.production?.reports[0].id as string
    const resolved = resolveVehicleBlock(blocked, reportId)
    expect(resolved.vehicles[0].blockReason).toBe('')
    expect(resolved.vehicles[0].partsStatus).toBe('Disponibili')
  })

  it('starts and marks vehicle ready with synced status', () => {
    const data = seedData()
    const started = startVehiclePhase(data, 'v1', { role: 'production', operatorId: 'op1', operatorName: 'Operatore 1' })
    expect(started.production?.jobs[0].phase).not.toBe('Da iniziare')
    const ready = markVehicleReady(started, 'v1', { role: 'production', operatorId: 'op1', operatorName: 'Operatore 1' })
    expect(ready.production?.jobs[0].phase).toBe('Pronta')
    expect(ready.vehicles[0].status).toBe('pronta')
  })
})

function isoMinutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function seedDelayControlData(metric: 'calendar' | 'man-hours' = 'calendar') {
  const data = seedData()
  data.plannerSettings.phaseTrackingMetric = metric
  data.plannerSettings.operators = [
    { id: 'op1', name: 'Operatore 1', dailyHours: 8, active: true, skills: ['lattoneria'] },
    { id: 'op2', name: 'Operatore 2', dailyHours: 8, active: true, skills: ['lattoneria'] },
  ]
  data.production!.jobs[0].phase = 'Lattoneria'
  data.jobs = [{
    id: 'job-1',
    number: 'COMM-00001',
    estimateId: null,
    customerId: 'c1',
    vehicleId: 'v1',
    plate: 'AB123CD',
    coneNumber: 1,
    entryDate: '2026-01-02',
    expectedDeliveryDate: '2099-12-31',
    priority: 'Alta',
    responsible: 'Capo',
    status: 'In lavorazione',
    companyName: 'Cliente',
    contactName: 'Mario Rossi',
    notes: '',
    blocks: [],
    lines: [],
    phases: [{
      id: 'phase-lattoneria',
      name: 'Lattoneria',
      status: 'In lavorazione',
      estimatedMinutes: 180,
      actualMinutes: 0,
      notes: '',
      blockedReason: '',
      operatorAssignments: [{
        id: 'assign-1',
        operatorName: 'Operatore 1',
        startedAt: isoMinutesAgo(60),
        workedMinutes: 0,
        activityStatus: 'Attivo',
      }],
    }],
    qualityChecklist: [],
    taxableAmount: 0,
    vatAmount: 0,
    total: 0,
    progressPercent: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  }]
  return data
}

describe('production real-time delay control', () => {
  it('fase sotto l\'80% resta IN ORARIO', () => {
    const data = seedDelayControlData('calendar')
    data.jobs![0].phases[0].operatorAssignments[0].startedAt = isoMinutesAgo(120)
    const next = runProductionDelayControl(data, 'Test')
    const pace = paceStateByVehicle(next, 'v1')
    expect(pace?.consumedPercent).toBeLessThan(80)
    expect(pace?.level).toBe('IN ORARIO')
  })

  it('raggiungimento soglia di attenzione a 80%', () => {
    const data = seedDelayControlData('calendar')
    data.jobs![0].phases[0].operatorAssignments[0].startedAt = isoMinutesAgo(144)
    const next = runProductionDelayControl(data, 'Test')
    const pace = paceStateByVehicle(next, 'v1')
    expect(pace?.consumedPercent).toBeGreaterThanOrEqual(80)
    expect(pace?.level).toBe('A RISCHIO')
    expect(pace?.preAlertAt).toBeTruthy()
  })

  it('superamento tempo preventivato entra IN RITARDO', () => {
    const data = seedDelayControlData('calendar')
    data.jobs![0].phases[0].operatorAssignments[0].startedAt = isoMinutesAgo(210)
    const next = runProductionDelayControl(data, 'Test')
    const pace = paceStateByVehicle(next, 'v1')
    expect(pace?.level).toBe('IN RITARDO')
    expect(pace?.delayedAt).toBeTruthy()
  })

  it('calcolo minuti di ritardo corretto', () => {
    const data = seedDelayControlData('calendar')
    data.jobs![0].phases[0].operatorAssignments[0].startedAt = isoMinutesAgo(207)
    const next = runProductionDelayControl(data, 'Test')
    const pace = paceStateByVehicle(next, 'v1')
    expect(Math.max(0, (pace?.workedMinutes ?? 0) - (pace?.estimatedMinutes ?? 0))).toBeGreaterThanOrEqual(27)
  })

  it('due operatori contemporanei: calendar e man-hours restano distinti', () => {
    const calendarData = seedDelayControlData('calendar')
    calendarData.jobs![0].phases[0].estimatedMinutes = 120
    calendarData.jobs![0].phases[0].operatorAssignments = [
      { id: 'a1', operatorName: 'Operatore 1', startedAt: isoMinutesAgo(102), workedMinutes: 0, activityStatus: 'Attivo' },
      { id: 'a2', operatorName: 'Operatore 2', startedAt: isoMinutesAgo(102), workedMinutes: 0, activityStatus: 'Attivo' },
    ]
    const calendarResult = runProductionDelayControl(calendarData, 'Test')
    expect(paceStateByVehicle(calendarResult, 'v1')?.level).toBe('A RISCHIO')

    const manHoursData = seedDelayControlData('man-hours')
    manHoursData.jobs![0].phases[0].estimatedMinutes = 120
    manHoursData.jobs![0].phases[0].operatorAssignments = [
      { id: 'a1', operatorName: 'Operatore 1', startedAt: isoMinutesAgo(102), workedMinutes: 0, activityStatus: 'Attivo' },
      { id: 'a2', operatorName: 'Operatore 2', startedAt: isoMinutesAgo(102), workedMinutes: 0, activityStatus: 'Attivo' },
    ]
    const manHoursResult = runProductionDelayControl(manHoursData, 'Test')
    expect(paceStateByVehicle(manHoursResult, 'v1')?.level).toBe('IN RITARDO')
  })

  it('ricalcolo automatico del programma su ritardo', () => {
    const data = seedDelayControlData('calendar')
    data.jobs![0].phases[0].operatorAssignments[0].startedAt = isoMinutesAgo(220)
    const next = runProductionDelayControl(data, 'Ritardo test')
    expect((next.operatorProgramRevision ?? 0)).toBeGreaterThan(0)
    expect((next.operatorProgramHistory ?? []).length).toBeGreaterThan(0)
  })

  it('persistenza stato ritardo dopo refresh', async () => {
    const data = seedDelayControlData('calendar')
    data.jobs![0].phases[0].operatorAssignments[0].startedAt = isoMinutesAgo(230)
    const next = runProductionDelayControl(data, 'Persistenza test')
    await saveDatabase(next)
    const loaded = await loadDatabase()
    const pace = paceStateByVehicle(loaded, 'v1')
    expect(pace?.level).toBe('IN RITARDO')
    expect((loaded.production?.paceHistory ?? []).length).toBeGreaterThan(0)
  })
})
