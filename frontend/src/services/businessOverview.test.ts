import { describe, expect, it } from 'vitest'
import type { ErpData } from '../types'
import { calculateBusinessOverviewSnapshot, calculateCustomerRankingSnapshot } from './businessOverview'

const makeInvoice = (id: string, issueDate: string, dueDate: string, total: number, collectedAmount: number) => ({
  id,
  customerId: 'c1',
  number: id,
  issueDate,
  dueDate,
  paymentMethod: 'Bonifico' as const,
  lines: [],
  taxableAmount: total,
  vatAmount: 0,
  total,
  collectedAmount,
  ribaAllocatedAmount: 0,
  status: collectedAmount < total ? 'Da incassare' as const : 'Incassata' as const,
  notes: '',
  createdAt: issueDate,
  updatedAt: issueDate,
})

const makeVehicle = (id: string, deliveredAt?: string, requestedDeliveryDate?: string, status: 'consegnata' | 'in lavorazione' = 'in lavorazione') => ({
  id,
  customerId: 'c1',
  plate: id,
  make: 'Ford',
  model: 'Focus',
  color: 'Nero',
  year: '2024',
  vin: 'VIN',
  mileage: '10000',
  status,
  coneNumber: null,
  estimatedHours: 8,
  workedHours: 8,
  plannedEntryDate: '2026-08-01',
  requestedDeliveryDate: requestedDeliveryDate ?? '2026-08-10',
  calculatedDeliveryDate: '2026-08-10',
  expectedRevenue: 1000,
  expectedMargin: 300,
  partsStatus: 'Disponibili' as const,
  blockReason: '',
  manualPlanningDate: '2026-08-01',
  createdAt: '2026-08-01T00:00:00.000Z',
  deliveredAt,
})

describe('business overview', () => {
  it('aggregates revenue, costs, margin and collections for the selected period', () => {
    const data = {
      customers: [],
      vehicles: [
        {
          ...makeVehicle('A', '2026-08-04T00:00:00.000Z', '2026-08-03', 'consegnata'),
          costEntries: [{ id: 'ce1', usedAt: '2026-08-02', category: 'ricambi', description: 'Parafanghi', quantity: 1, unit: 'pz', unitCost: 200, discount: 0, total: 200, vatRate: 22, note: '', createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' }],
        },
        {
          ...makeVehicle('B', undefined, '2026-08-15', 'in lavorazione'),
        },
      ],
      rail: [],
      coneHistory: [],
      plannerSettings: { operators: [], workingDays: [1, 2, 3, 4, 5], efficiencyPercent: 100, safetyMarginPercent: 10, holidays: [], closures: [], absences: [], monthlyRevenueGoal: 10000, ownerWithdrawalAmount: 3000, ownerWithdrawalPlannedDate: '2026-08-31', monthlyMarginGoal: 3000 },
      plannerAssignments: [],
      invoices: [makeInvoice('inv-1', '2026-08-01', '2026-08-10', 1000, 400), makeInvoice('inv-2', '2026-07-30', '2026-08-01', 300, 300)],
      bankAccounts: [],
      ribaBatches: [],
      financialEvents: [],
      financeSettings: { defaultVatRate: 22, defaultPaymentDays: 30, minimumProjectedBalance: 0, laborHourlyCost: 45, laborHoursBase: 'effettive', laborOperatorById: {}, marginThresholds: { positive: 15, low: 5, breakEven: 0 } },
    } as ErpData

    const snapshot = calculateBusinessOverviewSnapshot(data, 'mese', '2026-08-15')

    expect(snapshot.hasData).toBe(true)
    expect(snapshot.current.revenue).toBe(1000)
    expect(snapshot.current.cost).toBe(200)
    expect(snapshot.current.margin).toBe(800)
    expect(snapshot.current.expectedCollections).toBe(600)
    expect(snapshot.current.deliveredVehicles).toBe(1)
    expect(snapshot.current.lateVehicles).toBe(1)
    expect(snapshot.points[0].revenue).toBe(1000)
    expect(snapshot.points[0].cost).toBe(0)
    expect(snapshot.points[0].margin).toBe(1000)
    expect(snapshot.points.find((point) => point.cost === 200)?.cost).toBe(200)
    expect(snapshot.previous.revenue).toBe(300)
  })

  it('ranks customers by real revenue, margin and worked vehicles for the selected period', () => {
    const data = {
      customers: [
        { id: 'c1', type: 'Privato' as const, name: 'Mario Rossi', phone: '', email: '', taxId: '', address: '', createdAt: '2026-08-01T00:00:00.000Z' },
        { id: 'c2', type: 'Concessionario' as const, name: 'Auto Bellini', phone: '', email: '', taxId: '', address: '', createdAt: '2026-08-01T00:00:00.000Z' },
      ],
      vehicles: [
        {
          ...makeVehicle('A', '2026-08-04T00:00:00.000Z', '2026-08-03', 'consegnata'),
          customerId: 'c1',
          costEntries: [{ id: 'ce1', usedAt: '2026-08-02', category: 'ricambi', description: 'Parafanghi', quantity: 1, unit: 'pz', unitCost: 200, discount: 0, total: 200, vatRate: 22, note: '', createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' }],
        },
        {
          ...makeVehicle('B', undefined, '2026-08-15', 'in lavorazione'),
          customerId: 'c2',
        },
      ],
      rail: [],
      coneHistory: [],
      plannerSettings: { operators: [], workingDays: [1, 2, 3, 4, 5], efficiencyPercent: 100, safetyMarginPercent: 10, holidays: [], closures: [], absences: [], monthlyRevenueGoal: 10000, ownerWithdrawalAmount: 3000, ownerWithdrawalPlannedDate: '2026-08-31', monthlyMarginGoal: 3000 },
      plannerAssignments: [],
      invoices: [makeInvoice('inv-1', '2026-08-01', '2026-08-10', 1000, 400)],
      bankAccounts: [],
      ribaBatches: [],
      financialEvents: [],
      financeSettings: { defaultVatRate: 22, defaultPaymentDays: 30, minimumProjectedBalance: 0, laborHourlyCost: 45, laborHoursBase: 'effettive', laborOperatorById: {}, marginThresholds: { positive: 15, low: 5, breakEven: 0 } },
    } as ErpData

    const ranking = calculateCustomerRankingSnapshot(data, 'mese', '2026-08-15')

    expect(ranking).toHaveLength(2)
    expect(ranking[0].customerId).toBe('c1')
    expect(ranking[0].revenue).toBe(1000)
    expect(ranking[0].margin).toBe(800)
    expect(ranking[0].averageJobValue).toBe(1000)
    expect(ranking[0].vehicleCount).toBe(1)
    expect(ranking[1].customerId).toBe('c2')
    expect(ranking[1].revenue).toBe(0)
    expect(ranking[1].vehicleCount).toBe(1)
  })

  it('returns an empty-state snapshot when no real data exists for the selected period', () => {
    const data = {
      customers: [],
      vehicles: [],
      rail: [],
      coneHistory: [],
      plannerSettings: { operators: [], workingDays: [1, 2, 3, 4, 5], efficiencyPercent: 100, safetyMarginPercent: 10, holidays: [], closures: [], absences: [], monthlyRevenueGoal: 10000, ownerWithdrawalAmount: 3000, ownerWithdrawalPlannedDate: '2026-08-31', monthlyMarginGoal: 3000 },
      plannerAssignments: [],
      invoices: [],
      bankAccounts: [],
      ribaBatches: [],
      financialEvents: [],
      financeSettings: { defaultVatRate: 22, defaultPaymentDays: 30, minimumProjectedBalance: 0, laborHourlyCost: 45, laborHoursBase: 'effettive', laborOperatorById: {}, marginThresholds: { positive: 15, low: 5, breakEven: 0 } },
    } as ErpData

    const snapshot = calculateBusinessOverviewSnapshot(data, 'anno', '2026-08-15')

    expect(snapshot.hasData).toBe(false)
    expect(snapshot.points).toHaveLength(0)
    expect(snapshot.current.revenue).toBe(0)
  })
})
