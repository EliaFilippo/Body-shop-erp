import { describe, expect, it } from 'vitest'
import type { ErpData, Vehicle } from '../types'
import { buildCalendarEvents, calculateCashFlowSnapshot, calculateCreditControl } from './cashflow'
import { emptyData } from './erp'
import { setVatQuarterConfirmation } from './finance'

const vehicle = (id: string, customerId: string): Vehicle => ({
  id,
  customerId,
  plate: `AA${id}BB`,
  make: 'Fiat',
  model: '500',
  color: 'Bianco',
  year: '2023',
  vin: `VIN${id}`,
  mileage: '10000',
  status: 'in lavorazione',
  coneNumber: null,
  estimatedHours: 10,
  workedHours: 4,
  plannedEntryDate: '2026-02-01',
  requestedDeliveryDate: '2026-02-10',
  calculatedDeliveryDate: '2026-02-10',
  expectedRevenue: 800,
  expectedMargin: 250,
  partsStatus: 'Disponibili',
  blockReason: '',
  manualPlanningDate: '2026-02-01',
  costEntries: [],
  createdAt: '2026-02-01T00:00:00.000Z',
})

const baseData = (): ErpData => ({
  ...structuredClone(emptyData),
  customers: [
    { id: 'c1', type: 'Privato', name: 'Cliente A', phone: '', email: '', taxId: '', address: '', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c2', type: 'Privato', name: 'Cliente B', phone: '', email: '', taxId: '', address: '', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  vehicles: [
    { ...vehicle('1', 'c1'), requestedDeliveryDate: '2026-02-02', costEntries: [{ id: 'cost1', usedAt: '2026-02-10', category: 'ricambi', description: 'Ricambio', quantity: 1, unit: 'pz', unitCost: 300, discount: 0, total: 300, vatRate: 22, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }] },
    vehicle('2', 'c2'),
  ],
  invoices: [
    {
      id: 'inv1',
      customerId: 'c1',
      number: 'FAT-1',
      issueDate: '2026-02-01',
      dueDate: '2026-02-20',
      paymentMethod: 'Bonifico',
      lines: [],
      taxableAmount: 1000,
      vatAmount: 220,
      total: 1220,
      collectedAmount: 220,
      ribaAllocatedAmount: 0,
      status: 'Da incassare',
      notes: '',
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    },
    {
      id: 'inv2',
      customerId: 'c2',
      number: 'FAT-2',
      issueDate: '2026-01-01',
      dueDate: '2026-02-05',
      paymentMethod: 'Bonifico',
      lines: [],
      taxableAmount: 500,
      vatAmount: 110,
      total: 610,
      collectedAmount: 0,
      ribaAllocatedAmount: 0,
      status: 'Insoluta',
      notes: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-12T00:00:00.000Z',
    },
  ],
  bankAccounts: [{
    id: 'b1',
    name: 'Banca Uno',
    iban: 'IT00',
    creditLimit: 10000,
    blockOverLimit: true,
    minimumBalanceAlert: 0,
    currentBalance: 2000,
    createdAt: '2026-01-01T00:00:00.000Z',
  }],
  ribaBatches: [{
    id: 'r1',
    number: 'RIBA-1',
    bankAccountId: 'b1',
    presentationDate: '2026-02-01',
    dueDate: '2026-02-25',
    allocations: [{ id: 'ra1', invoiceId: 'inv1', amount: 300 }],
    total: 300,
    advancedAmount: 0,
    advanceDate: '',
    fees: 0,
    interest: 0,
    status: 'Presentata',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  }],
  quotes: [{
    id: 'q1',
    number: 'PREV-2026-00001',
    customerId: 'c1',
    vehicleId: '1',
    issueDate: '2026-02-01',
    dueDate: '2026-02-18',
    status: 'inviato',
    lines: [{ id: 'ql1', description: 'Intervento', quantity: 1, unitPrice: 300, vatRate: 22, discountRate: 0, taxableAmount: 300, vatAmount: 66, total: 366 }],
    taxableAmount: 300,
    vatAmount: 66,
    total: 366,
    notes: '',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  }],
  financialEvents: [
    { id: 'f1', type: 'Incasso definitivo', date: '2026-02-09', amount: 400, note: 'Incasso', createdAt: '2026-02-09T00:00:00.000Z' },
    { id: 'f2', type: 'Uscita prevista', date: '2026-02-22', amount: 250, note: 'Uscita', createdAt: '2026-02-09T00:00:00.000Z' },
  ],
})

describe('cashflow and credit control', () => {
  it('gestisce il caso no-data senza errori', () => {
    const snapshot = calculateCashFlowSnapshot(structuredClone(emptyData), '2026-02-10')
    expect(snapshot.baseLiquidity).toBeNull()
    expect(snapshot.windows).toHaveLength(3)
    expect(snapshot.expected).toBe(0)
    expect(snapshot.overdue).toBe(0)
    expect(snapshot.points[0].label).toBe('Oggi')
  })

  it('calcola proiezioni 30/60/90 con entrate, uscite, scaduti e rischio', () => {
    const snapshot = calculateCashFlowSnapshot(baseData(), '2026-02-10')
    expect(snapshot.baseLiquidity).toBe(2000)
    expect(snapshot.windows[0].days).toBe(30)
    expect(snapshot.windows[0].inflow).toBeGreaterThan(0)
    expect(snapshot.windows[1].days).toBe(60)
    expect(snapshot.windows[2].days).toBe(90)
    expect(snapshot.overdue).toBe(610)
    expect(snapshot.atRisk).toBeGreaterThanOrEqual(610)
  })

  it('calcola credit control e filtra i clienti critici', () => {
    const rows = calculateCreditControl(baseData(), { state: 'all' }, '2026-02-10')
    expect(rows).toHaveLength(2)
    expect(rows[0].openCredit).toBeGreaterThan(0)

    const critical = calculateCreditControl(baseData(), { state: 'critical' }, '2026-02-10')
    expect(critical.some((row) => row.critical)).toBe(true)

    const regular = calculateCreditControl(baseData(), { state: 'regular' }, '2026-02-10')
    expect(regular.every((row) => !row.critical)).toBe(true)
  })

  it('genera calendario con scadenze fatture, RIBA e risposte preventivi', () => {
    const events = buildCalendarEvents(baseData(), '2026-02-10', 'mese')
    expect(events.some((event) => event.type === 'invoice-due')).toBe(true)
    expect(events.some((event) => event.type === 'payment-expected')).toBe(true)
    expect(events.some((event) => event.type === 'riba-due')).toBe(true)
    expect(events.some((event) => event.type === 'response-needed')).toBe(true)
  })

  it('integra IVA trimestrale confermata nel cash flow e nel calendario', () => {
    const data = setVatQuarterConfirmation(baseData(), {
      quarterKey: '2026-Q1',
      confirmedAmount: 500,
      dueDate: '2026-05-16',
    })

    const snapshot = calculateCashFlowSnapshot(data, '2026-05-01')
    const events = buildCalendarEvents(data, '2026-05-01', 'mese')

    expect(snapshot.windows[0].outflow).toBe(3500)
    expect(events.some((event) => event.type === 'vat-quarter' && event.amount === 500)).toBe(true)
  })
})
