import { describe, expect, it } from 'vitest'
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
