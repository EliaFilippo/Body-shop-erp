import { describe, expect, it } from 'vitest'
import type { ErpData, Vehicle } from '../types'
import {
  calculateDocumentLines,
  calculateDocumentTotals,
  convertAcceptedQuoteToInvoice,
  createDocumentMessage,
  createQuoteDocument,
  invoiceDocumentStatus,
  registerCommunication,
  syncInvoiceDocumentStatuses,
  updateQuoteStatus,
} from './documents'
import { emptyData } from './erp'

const vehicle = (id: string, customerId: string): Vehicle => ({
  id,
  customerId,
  plate: 'AA123BB',
  make: 'Ford',
  model: 'Focus',
  color: 'Nero',
  year: '2022',
  vin: 'VIN123',
  mileage: '20000',
  status: 'Consegnata',
  coneNumber: null,
  estimatedHours: 10,
  workedHours: 8,
  plannedEntryDate: '2026-01-01',
  requestedDeliveryDate: '2026-01-10',
  calculatedDeliveryDate: '2026-01-10',
  expectedRevenue: 1000,
  expectedMargin: 300,
  partsStatus: 'Disponibili',
  blockReason: '',
  manualPlanningDate: '2026-01-01',
  billingStatus: 'Da fatturare',
  createdAt: '2026-01-01T00:00:00.000Z',
})

const baseData = (): ErpData => ({
  ...structuredClone(emptyData),
  customers: [{
    id: 'c1',
    type: 'Privato',
    name: 'Mario Rossi',
    phone: '333',
    email: 'mario@example.com',
    taxId: 'RSSMRA',
    address: 'Via Roma 1',
    usualPaymentMethod: 'Bonifico',
    paymentDays: 60,
    createdAt: '2026-01-01T00:00:00.000Z',
  }],
  vehicles: [vehicle('v1', 'c1')],
})

describe('documents', () => {
  it('calcola imponibile, IVA e totale con quantità e sconto', () => {
    const lines = calculateDocumentLines([
      { description: 'Verniciatura', quantity: 2, unitPrice: 100, vatRate: 22, discountRate: 10 },
    ])

    expect(lines[0].taxableAmount).toBe(180)
    expect(lines[0].vatAmount).toBe(39.6)
    expect(lines[0].total).toBe(219.6)

    const totals = calculateDocumentTotals(lines)
    expect(totals).toEqual({ taxableAmount: 180, vatAmount: 39.6, total: 219.6 })
  })

  it('crea preventivo con progressivo automatico e permette il cambio stato', () => {
    const data = createQuoteDocument(baseData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      issueDate: '2026-01-10',
      validityDays: 30,
      lines: [{ description: 'Riparazione paraurti', quantity: 1, unitPrice: 500, vatRate: 22 }],
    })

    expect(data.quotes).toHaveLength(1)
    expect(data.quotes?.[0].number).toMatch(/^PREV-\d{4}-00001$/)
    expect(data.documentCounters?.quote).toBe(1)

    const updated = updateQuoteStatus(data, data.quotes![0].id, 'inviato')
    expect(updated.quotes?.[0].status).toBe('inviato')
  })

  it('converte preventivo accettato in fattura mantenendo importi e data scadenza', () => {
    const withQuote = createQuoteDocument(baseData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      issueDate: '2026-01-10',
      lines: [{ description: 'Riparazione completa', quantity: 1, unitPrice: 1000, vatRate: 22 }],
      status: 'accettato',
    })

    const quote = withQuote.quotes![0]
    const converted = convertAcceptedQuoteToInvoice(withQuote, {
      quoteId: quote.id,
      issueDate: '2026-01-10',
    })

    expect(converted.invoices).toHaveLength(1)
    expect(converted.invoices[0].taxableAmount).toBe(1000)
    expect(converted.invoices[0].vatAmount).toBe(220)
    expect(converted.invoices[0].total).toBe(1220)
    expect(converted.invoices[0].dueDate).toBe('2026-03-11')
    expect(converted.invoices[0].quoteId).toBe(quote.id)
    expect(converted.documentCounters?.invoice).toBe(1)
    expect(converted.quotes?.[0].invoiceId).toBe(converted.invoices[0].id)
  })

  it('gestisce stati documento fattura emessa/parziale/pagata/scaduta', () => {
    const data = createQuoteDocument(baseData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      issueDate: '2026-01-10',
      lines: [{ description: 'Intervento', quantity: 1, unitPrice: 300, vatRate: 22 }],
      status: 'accettato',
    })
    const converted = convertAcceptedQuoteToInvoice(data, { quoteId: data.quotes![0].id, issueDate: '2026-01-10' })
    const invoice = converted.invoices[0]

    expect(invoiceDocumentStatus(invoice, '2026-01-11')).toBe('emessa')
    expect(invoiceDocumentStatus({ ...invoice, collectedAmount: 100 }, '2026-01-11')).toBe('parzialmente pagata')
    expect(invoiceDocumentStatus({ ...invoice, collectedAmount: invoice.total }, '2026-01-11')).toBe('pagata')
    expect(invoiceDocumentStatus(invoice, '2026-12-01')).toBe('scaduta')

    const synced = syncInvoiceDocumentStatuses({
      ...converted,
      invoices: [
        { ...invoice, collectedAmount: 0, dueDate: '2026-01-20', status: 'Da incassare' },
        { ...invoice, id: 'inv2', number: 'FAT-TEST-2', collectedAmount: 50, status: 'Da incassare' },
        { ...invoice, id: 'inv3', number: 'FAT-TEST-3', collectedAmount: invoice.total, status: 'Da incassare' },
      ],
    }, '2026-02-01')

    expect(synced.invoices[0].documentStatus).toBe('scaduta')
    expect(synced.invoices[1].documentStatus).toBe('parzialmente pagata')
    expect(synced.invoices[2].documentStatus).toBe('pagata')
    expect(synced.invoices[2].status).toBe('Incassata')
  })

  it('genera e registra comunicazioni senza dipendenze esterne', () => {
    const message = createDocumentMessage({
      channel: 'email',
      documentType: 'preventivo',
      customerName: 'Mario Rossi',
      plate: 'AA123BB',
      number: 'PREV-2026-00010',
      total: 1200,
      dueDate: '2026-02-01',
    })

    expect(message.text).toContain('preventivo PREV-2026-00010')
    expect(message.link.startsWith('mailto:')).toBe(true)

    const stored = registerCommunication(baseData(), {
      channel: 'email',
      documentType: 'preventivo',
      documentId: 'q1',
      customerId: 'c1',
      vehicleId: 'v1',
      message: message.text,
      target: 'mario@example.com',
    })

    expect(stored.communications).toHaveLength(1)
    expect(stored.communications?.[0].channel).toBe('email')
  })
})
