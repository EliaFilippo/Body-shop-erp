import { describe, expect, it } from 'vitest'
import type { ErpData, PlannerSettings, Vehicle } from '../types'
import { calculateCostLineSummary, calculateEconomicGoalSnapshot, calculateEconomicSummary, calculateExecutiveDashboardSnapshot, calculateMonthlyGoalProjection, calculateVehicleEconomicSnapshot, vehicleEconomicImpact } from './economic'

const settings: PlannerSettings = {
  operators: [{ id: 'op', name: 'Filippo', dailyHours: 8, active: true }],
  workingDays: [1, 2, 3, 4, 5], efficiencyPercent: 100, safetyMarginPercent: 10,
  holidays: [], closures: [], absences: [], monthlyRevenueGoal: 10000, monthlyMarginGoal: 3000,
  monthlyRevenueGoalMode: 'automatic', monthlyRevenueGoalSuggested: 10000, monthlyRevenueGoalManual: null, ownerWithdrawalAmount: 3000, ownerWithdrawalPlannedDate: '2026-07-31', ownerWithdrawalSettledMonthKey: null, ownerWithdrawalSettledAt: null, economicSafetyMarginPercent: 10,
}
const car = (id: string, revenue: number, hours: number): Vehicle => ({
  id, customerId: 'c', plate: id, make: '', model: '', color: '', year: '', vin: '', mileage: '',
  status: 'Accettata', coneNumber: null, priority: 'Normale', deliveryDate: '2026-07-31',
  estimatedHours: hours, workedHours: 0, plannedEntryDate: '2026-07-27',
  requestedDeliveryDate: '2026-07-31', calculatedDeliveryDate: '', expectedRevenue: revenue,
  expectedMargin: revenue * .3, partsStatus: 'Disponibili', blockReason: '', manualPlanningDate: '',
  createdAt: '2026-07-20T00:00:00.000Z',
})

describe('executive dashboard', () => {
  it('calcola i KPI reali da dati persistenti e finanziari', () => {
    const data: ErpData = {
      customers: [], vehicles: [
        { ...car('A', 4000, 20), status: 'In lavorazione', requestedDeliveryDate: '2026-07-27', plannedEntryDate: '2026-07-27', blockReason: 'Ricambio mancante', partsStatus: 'Mancanti', coneNumber: 1 },
        { ...car('B', 3000, 10), status: 'Pronta', requestedDeliveryDate: '2026-07-27', plannedEntryDate: '2026-07-27', coneNumber: 2 },
        { ...car('C', 2000, 5), status: 'Consegnata', requestedDeliveryDate: '2026-07-27', plannedEntryDate: '2026-07-27', deliveredAt: '2026-07-27T00:00:00.000Z', coneNumber: null },
      ], rail: [],
      coneHistory: [],
      plannerSettings: settings,
      plannerAssignments: [],
      invoices: [
        {
          id: 'i1', customerId: 'c', number: 'F-1', issueDate: '2026-07-02', dueDate: '2026-07-30', paymentMethod: 'Bonifico', lines: [], taxableAmount: 4000, vatAmount: 880, total: 4880, collectedAmount: 3000, ribaAllocatedAmount: 0, status: 'Da incassare', notes: '', createdAt: '2026-07-02T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z',
        },
      ],
      bankAccounts: [{ id: 'b1', name: 'Banca', iban: '', creditLimit: 0, blockOverLimit: false, minimumBalanceAlert: 0, currentBalance: 12500, createdAt: '2026-07-02T00:00:00.000Z' }],
      ribaBatches: [],
      financialEvents: [
        { id: 'f1', type: 'Incasso definitivo', date: '2026-07-10', amount: 3000, customerId: 'c', invoiceId: 'i1', ribaBatchId: undefined, bankAccountId: 'b1', note: '', createdAt: '2026-07-10T00:00:00.000Z' },
      ],
      financeSettings: {
        defaultVatRate: 22,
        defaultPaymentDays: 30,
        minimumProjectedBalance: 0,
        laborHourlyCost: 45,
        laborHoursBase: 'effettive',
        laborOperatorById: {},
        marginThresholds: { positive: 15, low: 5, breakEven: 0 },
      },
    } as ErpData
    const result = calculateExecutiveDashboardSnapshot(data, '2026-07-27')
    expect(result.availableLiquidity).toBe(12500)
    expect(result.monthlyRevenue).toBe(4880)
    expect(result.monthlyCollected).toBe(3000)
    expect(result.vehiclesPresent).toBe(2)
    expect(result.vehiclesInProgress).toBe(1)
    expect(result.vehiclesReady).toBe(1)
    expect(result.occupiedCones).toBe(2)
    expect(result.freeCones).toBe(28)
    expect(result.blockedVehicles).toBe(1)
    expect(result.missingPartsVehicles).toBe(1)
    expect(result.priorityNotifications.length).toBeGreaterThan(0)
  })
})

describe('commessa economica', () => {
  it('sommaria imponibile, iva, totale e margine per più righe di costo', () => {
    const result = calculateCostLineSummary([
      { id: 'ce1', usedAt: '2026-07-27', category: 'ricambi', description: 'Parafanghi', supplier: 'Fornitore', quantity: 2, unit: 'pz', unitCost: 50, discount: 0, total: 100, vatRate: 22, documentNo: 'DOC-1', note: '', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' },
      { id: 'ce2', usedAt: '2026-07-27', category: 'lavorazioni esterne', description: 'Lucidatura', supplier: 'Esterno', quantity: 1, unit: 'ora', unitCost: 120, discount: 0, total: 120, vatRate: 10, documentNo: 'DOC-2', note: '', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' },
    ], 2000)
    expect(result.taxableAmount).toBe(220)
    expect(result.vatAmount).toBe(34)
    expect(result.totalAmount).toBe(254)
    expect(result.margin).toBe(1746)
  })

  it('calcola ricavi, costi diretti, utile/perdita e margine percentuale per singola vettura', () => {
    const vehicle = car('A', 4000, 20)
    vehicle.costEntries = [{
      id: 'ce1', usedAt: '2026-07-27', category: 'ricambi', description: 'Parafanghi', supplier: 'Fornitore', quantity: 2, unit: 'pz', unitCost: 50, discount: 0, total: 100, vatRate: 22, documentNo: 'DOC-1', note: '', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z',
    }, {
      id: 'ce2', usedAt: '2026-07-27', category: 'lavorazioni esterne', description: 'Lucidatura', supplier: 'Esterno', quantity: 1, unit: 'ora', unitCost: 120, discount: 0, total: 120, vatRate: 22, documentNo: 'DOC-2', note: '', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z',
    }]
    vehicle.workedHours = 10
    const result = calculateVehicleEconomicSnapshot(vehicle, {
      defaultVatRate: 22,
      defaultPaymentDays: 30,
      minimumProjectedBalance: 0,
      laborHourlyCost: 1,
      laborHoursBase: 'effettive',
      laborOperatorById: {},
      marginThresholds: { positive: 15, low: 5, breakEven: 0 },
    })
    expect(result.taxableRevenue).toBe(4000)
    expect(result.actualMaterials).toBe(100)
    expect(result.externalCosts).toBe(120)
    expect(result.laborCost).toBe(10)
    expect(result.totalDirectCosts).toBe(230)
    expect(result.grossMargin).toBe(3770)
    expect(result.grossMarginPercent).toBe(94.25)
    expect(result.lossLabel).toBe('UTILI')
  })
})

describe('obiettivo economico', () => {
  it('calcola percentuale, importo e ore ancora necessarie da valori reali', () => {
    const result = calculateEconomicSummary([car('A', 4000, 20)], settings, '2026-07-27')
    expect(result.plannedRevenue).toBe(4000)
    expect(result.reachedPercent).toBe(40)
    expect(result.missingRevenue).toBe(6000)
    expect(result.productiveHoursNeeded).toBe(30)
    expect(result.remainingWorkingDays).toBe(5)
    expect(result.dailyRevenueNeeded).toBe(1200)
  })

  it('dichiara il carico sufficiente quando raggiunge l’obiettivo', () => {
    expect(calculateEconomicSummary([car('A', 11000, 30)], settings, '2026-07-27').sufficient).toBe(true)
  })

  it('calcola l’impatto economico di una nuova vettura', () => {
    const impact = vehicleEconomicImpact([car('A', 4000, 20)], [car('A', 4000, 20), car('B', 3000, 10)], settings, '2026-07-27')
    expect(impact).toMatchObject({ addedRevenue: 3000, addedMargin: 900, newReachedPercent: 70, sufficient: false })
  })

  it('confronta obiettivo e risultato e propone la previsione di fine mese', () => {
    const projection = calculateMonthlyGoalProjection([car('A', 4000, 20)], settings, '2026-07-27')
    expect(projection.goalRevenue).toBe(10000)
    expect(projection.actualRevenue).toBe(4000)
    expect(projection.deltaRevenue).toBe(6000)
    expect(projection.projectedEndRevenue).toBe(10000)
    expect(projection.remainingWorkingDays).toBe(5)
    expect(projection.dailyRevenueNeeded).toBe(1200)
  })

  it('calcola un obiettivo dinamico automatico partendo da costi reali e spese previste', () => {
    const data: ErpData = {
      customers: [],
      vehicles: [{ ...car('A', 4000, 20), costEntries: [{ id: 'c1', usedAt: '2026-07-27', category: 'ricambi', description: 'Ricambi', supplier: 'Fornitore', quantity: 1, unit: 'pz', unitCost: 500, discount: 0, total: 500, vatRate: 22, documentNo: 'D-1', note: '', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' }] }],
      coneHistory: [],
      plannerSettings: { ...settings, monthlyRevenueGoalMode: 'automatic', ownerWithdrawalAmount: 1000, ownerWithdrawalPlannedDate: '2026-07-31', economicSafetyMarginPercent: 20 },
      plannerAssignments: [],
      invoices: [{ id: 'i1', customerId: 'c', number: 'F-1', issueDate: '2026-07-27', dueDate: '2026-08-10', paymentMethod: 'Bonifico', lines: [], taxableAmount: 2000, vatAmount: 440, total: 2440, collectedAmount: 0, ribaAllocatedAmount: 0, status: 'Da incassare', notes: '', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' }],
      bankAccounts: [],
      ribaBatches: [],
      financialEvents: [{ id: 'e1', type: 'Uscita prevista', date: '2026-07-27', amount: 250, note: 'Spesa prevista', createdAt: '2026-07-27T00:00:00.000Z' }],
      financeSettings: {
        defaultVatRate: 22,
        defaultPaymentDays: 30,
        minimumProjectedBalance: 0,
        laborHourlyCost: 45,
        laborHoursBase: 'effettive',
        laborOperatorById: {},
        marginThresholds: { positive: 15, low: 5, breakEven: 0 },
      },
    } as ErpData

    const snapshot = calculateEconomicGoalSnapshot(data, '2026-07-27')
    expect(snapshot.mode).toBe('automatic')
    expect(snapshot.realCosts).toBe(500)
    expect(snapshot.plannedCosts).toBe(250)
    expect(snapshot.suggestedRevenueGoal).toBe(1500)
    expect(snapshot.appliedRevenueGoal).toBe(1500)
    expect(snapshot.revenueRealized).toBe(2440)
    expect(snapshot.residualNeed).toBe(0)
    expect(snapshot.status).toBe('ok')
  })

  it('mantiene il valore manuale ma conserva il suggerimento automatico', () => {
    const snapshot = calculateEconomicGoalSnapshot({
      customers: [],
      vehicles: [],
      coneHistory: [],
      plannerSettings: {
        ...settings,
        monthlyRevenueGoalMode: 'custom',
        monthlyRevenueGoalManual: 18000,
        monthlyRevenueGoalSuggested: 12000,
        monthlyRevenueGoal: 18000,
      },
      plannerAssignments: [],
      invoices: [],
      bankAccounts: [],
      ribaBatches: [],
      financialEvents: [],
      financeSettings: {
        defaultVatRate: 22,
        defaultPaymentDays: 30,
        minimumProjectedBalance: 0,
        laborHourlyCost: 45,
        laborHoursBase: 'effettive',
        laborOperatorById: {},
        marginThresholds: { positive: 15, low: 5, breakEven: 0 },
      },
    } as ErpData, '2026-07-27')

    expect(snapshot.mode).toBe('custom')
    expect(snapshot.customRevenueGoal).toBe(18000)
    expect(snapshot.appliedRevenueGoal).toBe(18000)
    expect(snapshot.suggestedRevenueGoal).toBe(3300)
  })
})
