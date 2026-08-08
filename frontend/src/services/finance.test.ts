import { describe, expect, it } from 'vitest'
import type { ErpData, Vehicle } from '../types'
import {
  calculateDueDate,
  createInvoice,
  createRibaBatch,
  invoiceResidual,
  markRibaInsolvent,
  registerRibaAdvance,
  settleRibaBatch,
} from './finance'
import { emptyData } from './erp'

const vehicle = (id: string, customerId: string): Vehicle => ({
  id,
  customerId,
  plate: `AA${id}BB`,
  make: 'Alfa Romeo',
  model: 'Giulia',
  color: 'Nero',
  year: '2024',
  vin: `VIN${id}`,
  mileage: '10000',
  status: 'Consegnata',
  coneNumber: null,
  estimatedHours: 10,
  workedHours: 8,
  plannedEntryDate: '2026-03-01',
  requestedDeliveryDate: '2026-03-10',
  calculatedDeliveryDate: '2026-03-10',
  expectedRevenue: 1000,
  expectedMargin: 300,
  partsStatus: 'Disponibili',
  blockReason: '',
  manualPlanningDate: '2026-03-01',
  billingStatus: 'Da fatturare',
  createdAt: '2026-03-01T00:00:00.000Z',
})

const makeData = (): ErpData => ({
  ...structuredClone(emptyData),
  customers: [{
    id: 'c1',
    type: 'Privato',
    name: 'Cliente',
    phone: '',
    email: '',
    taxId: '',
    address: '',
    usualPaymentMethod: 'R.I.B.A.',
    paymentDays: 30,
    createdAt: '2026-03-01T00:00:00.000Z',
  }],
  vehicles: [vehicle('1', 'c1')],
  bankAccounts: [{
    id: 'b1',
    name: 'Banca Test',
    iban: 'IT00X',
    creditLimit: 5000,
    blockOverLimit: true,
    minimumBalanceAlert: 0,
    currentBalance: 1000,
    createdAt: '2026-03-01T00:00:00.000Z',
  }],
})

describe('finance core rules', () => {
  it('calcola scadenze a 30/60/90 giorni', () => {
    expect(calculateDueDate('2026-03-01', 30)).toBe('2026-03-31')
    expect(calculateDueDate('2026-03-01', 60)).toBe('2026-04-30')
    expect(calculateDueDate('2026-03-01', 90)).toBe('2026-05-30')
  })

  it('crea fattura e mantiene residuo corretto prima e dopo RIBA', () => {
    const data = createInvoice(makeData(), {
      customerId: 'c1',
      vehicleIds: ['1'],
      number: 'FAT-001',
      issueDate: '2026-03-01',
    })
    const invoice = data.invoices[0]
    expect(invoiceResidual(invoice)).toBe(invoice.total)

    const withRiba = createRibaBatch(data, {
      number: 'RIBA-001',
      bankAccountId: 'b1',
      presentationDate: '2026-03-02',
      dueDate: invoice.dueDate,
      allocations: [{ invoiceId: invoice.id, amount: invoice.total }],
    })

    expect(withRiba.invoices[0].status).toBe('Inserita in R.I.B.A.')
    expect(invoiceResidual(withRiba.invoices[0])).toBe(0)
  })

  it('registra anticipo e poi incasso definitivo della distinta RIBA', () => {
    const data = createInvoice(makeData(), {
      customerId: 'c1',
      vehicleIds: ['1'],
      number: 'FAT-002',
      issueDate: '2026-03-01',
    })
    const withRiba = createRibaBatch(data, {
      number: 'RIBA-002',
      bankAccountId: 'b1',
      presentationDate: '2026-03-02',
      dueDate: data.invoices[0]?.dueDate ?? '2026-03-31',
      allocations: [{ invoiceId: data.invoices[0].id, amount: data.invoices[0].total }],
    })
    const batch = withRiba.ribaBatches[0]

    const advanced = registerRibaAdvance(withRiba, batch.id, batch.total, '2026-03-03', 20, 10)
    expect(advanced.ribaBatches[0].status).toBe('Anticipata')
    expect(advanced.invoices[0].status).toBe('Anticipata')

    const settled = settleRibaBatch(advanced, batch.id, '2026-03-31')
    expect(settled.ribaBatches[0].status).toBe('Chiusa')
    expect(settled.invoices[0].status).toBe('Incassata')
    expect(settled.invoices[0].collectedAmount).toBe(settled.invoices[0].total)
  })

  it('riapre il credito in caso di insoluto', () => {
    const data = createInvoice(makeData(), {
      customerId: 'c1',
      vehicleIds: ['1'],
      number: 'FAT-003',
      issueDate: '2026-03-01',
    })
    const withRiba = createRibaBatch(data, {
      number: 'RIBA-003',
      bankAccountId: 'b1',
      presentationDate: '2026-03-02',
      dueDate: data.invoices[0]?.dueDate ?? '2026-03-31',
      allocations: [{ invoiceId: data.invoices[0].id, amount: 600 }],
    })
    const insolvent = markRibaInsolvent(withRiba, withRiba.ribaBatches[0].id, '2026-04-01')

    expect(insolvent.ribaBatches[0].status).toBe('Insoluta')
    expect(insolvent.invoices[0].status).toBe('Insoluta')
    expect(insolvent.invoices[0].ribaAllocatedAmount).toBe(0)
  })
})
