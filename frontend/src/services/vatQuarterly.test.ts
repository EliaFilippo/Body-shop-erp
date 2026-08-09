import { describe, expect, it } from 'vitest'
import type { ErpData, Invoice } from '../types'
import { calculateCashFlowSnapshot } from './cashflow'
import { calculateEconomicGoalSnapshot } from './economic'
import { addVatQuarterAdjustment, createPayableEntry, createVatQuarterF24Payable, setVatQuarterConfirmation } from './finance'
import { emptyData } from './erp'
import { calculateVatQuarterDetail, calculateVatQuarterOutflows, calculateVatQuarterSnapshot } from './vatQuarterly'

const baseData = (): ErpData => ({
  ...structuredClone(emptyData),
  plannerSettings: {
    ...structuredClone(emptyData.plannerSettings),
    ownerWithdrawalAmount: 0,
  },
  bankAccounts: [{
    id: 'b1',
    name: 'Banca',
    iban: 'IT00TEST',
    creditLimit: 20000,
    blockOverLimit: false,
    minimumBalanceAlert: 0,
    currentBalance: 10000,
    createdAt: '2026-01-01T00:00:00.000Z',
  }],
  invoices: [],
  payables: [],
  financialEvents: [],
  vatQuarterlyRecords: [],
})

const invoice = (id: string, issueDate: string, vatAmount: number): Invoice => ({
  id,
  customerId: 'c1',
  number: `FAT-${id}`,
  issueDate,
  dueDate: issueDate,
  paymentMethod: 'Bonifico',
  lines: [],
  taxableAmount: 1000,
  vatAmount,
  total: 1000 + vatAmount,
  collectedAmount: 0,
  ribaAllocatedAmount: 0,
  status: 'Da incassare',
  notes: '',
  createdAt: `${issueDate}T00:00:00.000Z`,
  updatedAt: `${issueDate}T00:00:00.000Z`,
})

describe('iva trimestrale', () => {
  it('calcola stima trimestre con IVA a debito e detraibile', () => {
    const data = createPayableEntry({
      ...baseData(),
      invoices: [invoice('1', '2026-02-10', 220), invoice('2', '2026-03-05', 330)],
    }, {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Ricambi',
      supplierName: 'Ricambi SRL',
      invoiceNumber: 'RF-1',
      invoiceDate: '2026-02-12',
      taxableAmount: 1000,
      vatAmount: 110,
      vatDeductibilityMode: 'full',
      vatDeductibilityPercent: 100,
      totalAmount: 1110,
      paymentMethod: 'Bonifico',
      dueDate: '2026-03-20',
      installments: [{ installmentNo: 1, amount: 1110, dueDate: '2026-03-20' }],
      notes: '',
    })

    const snapshot = calculateVatQuarterSnapshot(data, '2026-Q1')
    expect(snapshot.vatDebit).toBe(550)
    expect(snapshot.vatCredit).toBe(110)
    expect(snapshot.estimatedPayable).toBe(440)
    expect(snapshot.amountForPlanning).toBe(440)
  })

  it('gestisce detraibilità parziale e nulla su fatture fornitori', () => {
    const withPartial = createPayableEntry(baseData(), {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Spesa promiscua',
      supplierName: 'Fornitore A',
      invoiceNumber: 'RF-2',
      invoiceDate: '2026-05-10',
      taxableAmount: 1000,
      vatAmount: 220,
      vatDeductibilityMode: 'partial',
      vatDeductibilityPercent: 40,
      totalAmount: 1220,
      paymentMethod: 'Bonifico',
      dueDate: '2026-05-31',
      installments: [{ installmentNo: 1, amount: 1220, dueDate: '2026-05-31' }],
      notes: '',
    })
    const withNone = createPayableEntry(withPartial, {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Spesa non detraibile',
      supplierName: 'Fornitore B',
      invoiceNumber: 'RF-3',
      invoiceDate: '2026-05-15',
      taxableAmount: 500,
      vatAmount: 110,
      vatDeductibilityMode: 'none',
      totalAmount: 610,
      paymentMethod: 'Bonifico',
      dueDate: '2026-05-31',
      installments: [{ installmentNo: 1, amount: 610, dueDate: '2026-05-31' }],
      notes: '',
    })

    const snapshot = calculateVatQuarterSnapshot(withNone, '2026-Q2')
    expect(snapshot.vatCredit).toBe(88)
  })

  it('applica rettifiche manuali positive/negative alla stima', () => {
    const base = {
      ...baseData(),
      invoices: [invoice('3', '2026-07-02', 220)],
    }
    const withPlus = addVatQuarterAdjustment(base, { quarterKey: '2026-Q3', note: 'Conguaglio', amount: 30 })
    const withBoth = addVatQuarterAdjustment(withPlus, { quarterKey: '2026-Q3', note: 'Nota credito', amount: -20 })

    const snapshot = calculateVatQuarterSnapshot(withBoth, '2026-Q3')
    expect(snapshot.adjustments).toBe(10)
    expect(snapshot.estimatedPayable).toBe(230)
  })

  it('conferma importo commercialista e usa override nel planning', () => {
    const estimated = {
      ...baseData(),
      invoices: [invoice('4', '2026-11-10', 500)],
    }
    const confirmed = setVatQuarterConfirmation(estimated, {
      quarterKey: '2026-Q4',
      confirmedAmount: 420,
      accountantNote: 'Confermato',
      dueDate: '2027-02-16',
    })

    const snapshot = calculateVatQuarterSnapshot(confirmed, '2026-Q4')
    expect(snapshot.confirmedAmount).toBe(420)
    expect(snapshot.amountForPlanning).toBe(420)
  })

  it('genera F24 dal trimestre e azzera doppio conteggio stima in cash flow e obiettivo', () => {
    const withEstimate = setVatQuarterConfirmation({
      ...baseData(),
      invoices: [invoice('5', '2026-02-10', 660)],
    }, {
      quarterKey: '2026-Q1',
      confirmedAmount: 660,
      dueDate: '2026-05-16',
    })

    const beforeCashflow = calculateCashFlowSnapshot(withEstimate, '2026-05-01')
    const beforeEconomic = calculateEconomicGoalSnapshot(withEstimate, '2026-05-01')

    const withF24 = createVatQuarterF24Payable(withEstimate, {
      quarterKey: '2026-Q1',
      dueDate: '2026-05-16',
      installments: [{ installmentNo: 1, amount: 660, dueDate: '2026-05-16' }],
    })

    const snapshot = calculateVatQuarterSnapshot(withF24, '2026-Q1')
    const afterCashflow = calculateCashFlowSnapshot(withF24, '2026-05-01')
    const afterEconomic = calculateEconomicGoalSnapshot(withF24, '2026-05-01')

    expect(snapshot.linkedPayableId).toBeTruthy()
    expect(snapshot.amountForPlanning).toBe(0)
    expect(afterCashflow.windows[0].outflow).toBe(beforeCashflow.windows[0].outflow)
    expect(afterEconomic.plannedCosts).toBe(beforeEconomic.plannedCosts)
  })

  it('cambia trimestre correttamente e aggiorna outflow per scadenza', () => {
    const data = setVatQuarterConfirmation({
      ...baseData(),
      invoices: [invoice('6', '2026-08-01', 300), invoice('7', '2026-11-01', 500)],
    }, {
      quarterKey: '2026-Q3',
      confirmedAmount: 250,
      dueDate: '2026-11-16',
    })

    const q3 = calculateVatQuarterSnapshot(data, '2026-Q3')
    const q4 = calculateVatQuarterSnapshot(data, '2026-Q4')
    const outflows = calculateVatQuarterOutflows(data)

    expect(q3.amountForPlanning).toBe(250)
    expect(q4.estimatedPayable).toBe(500)
    expect(outflows.some((item) => item.quarterKey === '2026-Q3' && item.amount === 250)).toBe(true)
    expect(outflows.some((item) => item.quarterKey === '2026-Q4' && item.amount === 500)).toBe(true)
  })

  it('evita duplicazione F24 per lo stesso trimestre', () => {
    const initial = setVatQuarterConfirmation(baseData(), {
      quarterKey: '2026-Q2',
      confirmedAmount: 300,
      dueDate: '2026-08-16',
    })
    const created = createVatQuarterF24Payable(initial, {
      quarterKey: '2026-Q2',
      installments: [{ installmentNo: 1, amount: 300, dueDate: '2026-08-16' }],
    })

    expect(() => createVatQuarterF24Payable(created, {
      quarterKey: '2026-Q2',
      installments: [{ installmentNo: 1, amount: 300, dueDate: '2026-08-16' }],
    })).toThrowError('Per questo trimestre IVA esiste già un F24 collegato.')
  })

  it('mantiene allineati i totali del dettaglio con i KPI del trimestre', () => {
    const withInvoices = {
      ...baseData(),
      invoices: [
        invoice('8', '2026-02-10', 220),
        invoice('9', '2026-03-02', 110),
        { ...invoice('10', '2026-03-03', 70), status: 'Stornata' as const, notes: 'Nota credito cliente' },
      ],
    }
    const withSupplierA = createPayableEntry(withInvoices, {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Acquisto A',
      supplierName: 'Fornitore A',
      invoiceNumber: 'FA-1',
      invoiceDate: '2026-01-20',
      taxableAmount: 1000,
      vatAmount: 220,
      vatDeductibilityMode: 'full',
      totalAmount: 1220,
      paymentMethod: 'Bonifico',
      dueDate: '2026-02-20',
      installments: [{ installmentNo: 1, amount: 1220, dueDate: '2026-02-20' }],
      notes: '',
    })
    const withSupplierB = createPayableEntry(withSupplierA, {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Acquisto B',
      supplierName: 'Fornitore B',
      invoiceNumber: 'FB-1',
      invoiceDate: '2026-02-25',
      taxableAmount: 500,
      vatAmount: 110,
      vatDeductibilityMode: 'partial',
      vatDeductibilityPercent: 50,
      totalAmount: 610,
      paymentMethod: 'Bonifico',
      dueDate: '2026-03-25',
      installments: [{ installmentNo: 1, amount: 610, dueDate: '2026-03-25' }],
      notes: '',
    })
    const withSupplierC = createPayableEntry(withSupplierB, {
      kind: 'supplier-invoice',
      category: 'fornitori',
      description: 'Acquisto C',
      supplierName: 'Fornitore C',
      invoiceNumber: 'FC-1',
      invoiceDate: '2026-03-10',
      taxableAmount: 400,
      vatAmount: 88,
      vatDeductibilityMode: 'none',
      totalAmount: 488,
      paymentMethod: 'Bonifico',
      dueDate: '2026-03-31',
      installments: [{ installmentNo: 1, amount: 488, dueDate: '2026-03-31' }],
      notes: '',
    })
    const data = addVatQuarterAdjustment(withSupplierC, {
      quarterKey: '2026-Q1',
      note: 'Conguaglio',
      amount: -15,
    })

    const snapshot = calculateVatQuarterSnapshot(data, '2026-Q1')
    const detail = calculateVatQuarterDetail(data, '2026-Q1')

    expect(detail.debitTotal).toBe(snapshot.vatDebit)
    expect(detail.creditTotal).toBe(snapshot.vatCredit)
    expect(detail.adjustmentsTotal).toBe(snapshot.adjustments)
    expect(detail.estimatedNet).toBe(snapshot.estimatedNet)
    expect(detail.estimatedPayable).toBe(snapshot.estimatedPayable)
  })
})
