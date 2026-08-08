import type {
  CommunicationChannel,
  CommunicationEntry,
  DocumentLine,
  ErpData,
  Invoice,
  InvoiceDocumentStatus,
  InvoiceLine,
  PaymentMethod,
  QuoteDocument,
  QuoteStatus,
  Vehicle,
} from '../types'

const id = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const todayKey = () => new Date().toISOString().slice(0, 10)
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export interface DocumentLineInput {
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
  discountRate?: number
}

export interface DocumentTotals {
  taxableAmount: number
  vatAmount: number
  total: number
}

export interface QuoteCreateInput {
  customerId: string
  vehicleId: string
  acceptanceId?: string
  issueDate?: string
  dueDate?: string
  validityDays?: number
  number?: string
  status?: QuoteStatus
  notes?: string
  lines: DocumentLineInput[]
}

export interface InvoiceFromQuoteInput {
  quoteId: string
  issueDate?: string
  dueDate?: string
  paymentMethod?: PaymentMethod
  number?: string
  vatMode?: 'from-lines' | 'from-default'
}

export interface QuoteToJobImpact {
  vehicleId: string
  previousRevenue: number
  nextRevenue: number
  previousMargin: number
  nextMargin: number
}

const computeDueDate = (issueDate: string, days: number) => {
  const date = new Date(`${issueDate}T12:00:00`)
  if (Number.isNaN(date.getTime())) throw new Error('Data non valida.')
  date.setDate(date.getDate() + Math.max(0, days))
  return date.toISOString().slice(0, 10)
}

const nextNumber = (prefix: string, value: number) => {
  const year = todayKey().slice(0, 4)
  return `${prefix}-${year}-${String(value + 1).padStart(5, '0')}`
}

export function calculateDocumentLines(lines: DocumentLineInput[]): DocumentLine[] {
  return lines.map((line) => {
    const quantity = Math.max(0, Number(line.quantity) || 0)
    const unitPrice = Math.max(0, Number(line.unitPrice) || 0)
    const vatRate = Math.max(0, Number(line.vatRate) || 0)
    const discountRate = Math.max(0, Number(line.discountRate) || 0)
    const gross = quantity * unitPrice
    const discounted = gross * (1 - discountRate / 100)
    const taxableAmount = round(discounted)
    const vatAmount = round(taxableAmount * vatRate / 100)
    return {
      id: id(),
      description: line.description.trim(),
      quantity,
      unitPrice,
      vatRate,
      discountRate,
      taxableAmount,
      vatAmount,
      total: round(taxableAmount + vatAmount),
    }
  })
}

export function calculateDocumentTotals(lines: DocumentLine[]): DocumentTotals {
  const taxableAmount = round(lines.reduce((sum, line) => sum + line.taxableAmount, 0))
  const vatAmount = round(lines.reduce((sum, line) => sum + line.vatAmount, 0))
  return {
    taxableAmount,
    vatAmount,
    total: round(taxableAmount + vatAmount),
  }
}

export function createQuoteDocument(data: ErpData, input: QuoteCreateInput): ErpData {
  const customer = data.customers.find((item) => item.id === input.customerId)
  if (!customer) throw new Error('Cliente non trovato.')
  const vehicle = data.vehicles.find((item) => item.id === input.vehicleId)
  if (!vehicle) throw new Error('Vettura non trovata.')
  if (vehicle.customerId !== customer.id) throw new Error('La vettura selezionata non appartiene al cliente indicato.')
  if (!input.lines.length) throw new Error('Inserisci almeno una riga nel preventivo.')

  const lines = calculateDocumentLines(input.lines)
  if (lines.some((line) => !line.description || line.quantity <= 0)) {
    throw new Error('Ogni riga deve avere descrizione e quantità maggiore di zero.')
  }

  const issueDate = input.issueDate ?? todayKey()
  const dueDate = input.dueDate ?? computeDueDate(issueDate, input.validityDays ?? 30)
  const counters = data.documentCounters ?? { quote: 0, invoice: 0 }
  const number = (input.number?.trim() || nextNumber('PREV', counters.quote)).toUpperCase()
  if ((data.quotes ?? []).some((item) => item.number === number)) throw new Error('Numero preventivo già presente.')

  const totals = calculateDocumentTotals(lines)
  const createdAt = now()
  const quote: QuoteDocument = {
    id: id(),
    number,
    customerId: customer.id,
    vehicleId: vehicle.id,
    acceptanceId: input.acceptanceId,
    issueDate,
    dueDate,
    status: input.status ?? 'bozza',
    lines,
    taxableAmount: totals.taxableAmount,
    vatAmount: totals.vatAmount,
    total: totals.total,
    notes: input.notes?.trim() ?? '',
    createdAt,
    updatedAt: createdAt,
  }

  return {
    ...data,
    quotes: [quote, ...(data.quotes ?? [])],
    documentCounters: {
      ...counters,
      quote: counters.quote + 1,
    },
  }
}

export function updateQuoteStatus(data: ErpData, quoteId: string, status: QuoteStatus): ErpData {
  const quote = (data.quotes ?? []).find((item) => item.id === quoteId)
  if (!quote) throw new Error('Preventivo non trovato.')
  return {
    ...data,
    quotes: (data.quotes ?? []).map((item) => item.id === quoteId ? { ...item, status, updatedAt: now() } : item),
  }
}

export function applyQuoteToVehicleJob(data: ErpData, quoteId: string): { data: ErpData; impact: QuoteToJobImpact } {
  const quote = (data.quotes ?? []).find((item) => item.id === quoteId)
  if (!quote) throw new Error('Preventivo non trovato.')
  const vehicle = data.vehicles.find((item) => item.id === quote.vehicleId)
  if (!vehicle) throw new Error('Vettura della commessa non trovata.')

  const margin = round(quote.total - quote.taxableAmount * 0.65)
  const nextVehicle: Vehicle = {
    ...vehicle,
    expectedRevenue: quote.taxableAmount,
    expectedMargin: margin,
  }

  return {
    data: {
      ...data,
      vehicles: data.vehicles.map((item) => item.id === vehicle.id ? nextVehicle : item),
      quotes: (data.quotes ?? []).map((item) => item.id === quoteId ? { ...item, status: 'accettato', updatedAt: now() } : item),
    },
    impact: {
      vehicleId: vehicle.id,
      previousRevenue: vehicle.expectedRevenue,
      nextRevenue: nextVehicle.expectedRevenue,
      previousMargin: vehicle.expectedMargin,
      nextMargin: nextVehicle.expectedMargin,
    },
  }
}

const mapQuoteLinesToInvoiceLines = (quote: QuoteDocument): InvoiceLine[] =>
  quote.lines.map((line) => ({
    id: id(),
    vehicleId: quote.vehicleId,
    description: line.description,
    taxableAmount: line.taxableAmount,
    vatRate: line.vatRate,
    vatAmount: line.vatAmount,
    total: line.total,
  }))

export function invoiceDocumentStatus(invoice: Invoice, referenceDate = todayKey()): InvoiceDocumentStatus {
  const residual = round(Math.max(0, invoice.total - invoice.collectedAmount))
  if (residual <= 0) return 'pagata'
  if (invoice.collectedAmount > 0) return 'parzialmente pagata'
  if (invoice.dueDate < referenceDate) return 'scaduta'
  return invoice.documentStatus ?? 'emessa'
}

export function convertAcceptedQuoteToInvoice(data: ErpData, input: InvoiceFromQuoteInput): ErpData {
  const quote = (data.quotes ?? []).find((item) => item.id === input.quoteId)
  if (!quote) throw new Error('Preventivo non trovato.')
  if (quote.status !== 'accettato') throw new Error('Puoi convertire in fattura solo preventivi accettati.')
  if (quote.invoiceId) throw new Error('Questo preventivo è già stato convertito in fattura.')

  const customer = data.customers.find((item) => item.id === quote.customerId)
  if (!customer) throw new Error('Cliente del preventivo non trovato.')

  const counters = data.documentCounters ?? { quote: 0, invoice: 0 }
  const number = (input.number?.trim() || nextNumber('FAT', counters.invoice)).toUpperCase()
  if (data.invoices.some((item) => item.number === number)) throw new Error('Numero fattura già presente.')

  const issueDate = input.issueDate ?? todayKey()
  const dueDate = input.dueDate ?? computeDueDate(issueDate, customer.paymentDays ?? data.financeSettings.defaultPaymentDays)
  const lines = mapQuoteLinesToInvoiceLines(quote)
  const totals = calculateDocumentTotals(quote.lines)
  const timestamp = now()
  const invoice: Invoice = {
    id: id(),
    customerId: quote.customerId,
    vehicleId: quote.vehicleId,
    acceptanceId: quote.acceptanceId,
    quoteId: quote.id,
    number,
    issueDate,
    dueDate,
    paymentMethod: input.paymentMethod ?? customer.usualPaymentMethod ?? 'Bonifico',
    documentStatus: 'emessa',
    lines,
    taxableAmount: totals.taxableAmount,
    vatAmount: totals.vatAmount,
    total: totals.total,
    collectedAmount: 0,
    ribaAllocatedAmount: 0,
    status: 'Da incassare',
    notes: quote.notes || `Generata da preventivo ${quote.number}`,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  return {
    ...data,
    invoices: [invoice, ...data.invoices],
    quotes: (data.quotes ?? []).map((item) => item.id === quote.id ? { ...item, invoiceId: invoice.id, updatedAt: timestamp } : item),
    vehicles: data.vehicles.map((vehicle) => vehicle.id === quote.vehicleId ? { ...vehicle, invoiceId: invoice.id, billingStatus: 'Fatturata' } : vehicle),
    financialEvents: [{
      id: id(),
      type: 'Fattura emessa',
      date: issueDate,
      amount: invoice.total,
      customerId: quote.customerId,
      invoiceId: invoice.id,
      note: `Fattura ${invoice.number} da preventivo ${quote.number}`,
      createdAt: timestamp,
    }, ...data.financialEvents],
    documentCounters: {
      ...counters,
      invoice: counters.invoice + 1,
    },
  }
}

export function syncInvoiceDocumentStatuses(data: ErpData, referenceDate = todayKey()): ErpData {
  return {
    ...data,
    invoices: data.invoices.map((invoice) => {
      const documentStatus = invoiceDocumentStatus(invoice, referenceDate)
      const legacyStatus = documentStatus === 'pagata'
        ? 'Incassata'
        : documentStatus === 'scaduta'
          ? 'Scaduta'
          : invoice.status === 'Insoluta'
            ? 'Insoluta'
            : 'Da incassare'
      return {
        ...invoice,
        documentStatus,
        status: legacyStatus,
      }
    }),
  }
}

export function createDocumentMessage(input: {
  channel: CommunicationChannel
  documentType: 'preventivo' | 'fattura'
  customerName: string
  plate: string
  number: string
  total: number
  dueDate: string
}) {
  const title = input.documentType === 'preventivo' ? 'preventivo' : 'fattura'
  const amount = input.total.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
  const text = [
    `Gentile ${input.customerName},`,
    `in allegato trovi il ${title} ${input.number} relativo alla vettura ${input.plate}.`,
    `Importo totale: ${amount}.`,
    `Scadenza: ${input.dueDate}.`,
    'Resto a disposizione per qualsiasi chiarimento.',
    'Elias Body Shop',
  ].join('\n')

  const encoded = encodeURIComponent(text)
  const link = input.channel === 'email'
    ? `mailto:?subject=${encodeURIComponent(`${title.toUpperCase()} ${input.number}`)}&body=${encoded}`
    : input.channel === 'whatsapp'
      ? `https://wa.me/?text=${encoded}`
      : ''

  return { text, link }
}

export function registerCommunication(data: ErpData, input: Omit<CommunicationEntry, 'id' | 'createdAt'>): ErpData {
  const entry: CommunicationEntry = {
    ...input,
    id: id(),
    createdAt: now(),
  }
  return {
    ...data,
    communications: [entry, ...(data.communications ?? [])],
  }
}

export function buildDocumentPrintHtml(data: ErpData, documentType: 'preventivo' | 'fattura', documentId: string): string {
  const company = data.companyProfile ?? {
    name: 'ELIAS BODY SHOP',
    vatId: '',
    taxCode: '',
    address: '',
    phone: '',
    email: '',
    logoText: 'ELIAS',
  }
  const quote = documentType === 'preventivo' ? (data.quotes ?? []).find((item) => item.id === documentId) : undefined
  const invoice = documentType === 'fattura' ? data.invoices.find((item) => item.id === documentId) : undefined
  if (!quote && !invoice) throw new Error('Documento non trovato.')

  const customerId = quote?.customerId ?? invoice?.customerId ?? ''
  const vehicleId = quote?.vehicleId ?? invoice?.vehicleId ?? ''
  const customer = data.customers.find((item) => item.id === customerId)
  const vehicle = data.vehicles.find((item) => item.id === vehicleId)

  const rows = quote
    ? quote.lines.map((line) => ({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, vatRate: line.vatRate, taxableAmount: line.taxableAmount, vatAmount: line.vatAmount, total: line.total }))
    : (invoice?.lines ?? []).map((line) => ({ description: line.description, quantity: 1, unitPrice: line.taxableAmount, vatRate: line.vatRate, taxableAmount: line.taxableAmount, vatAmount: line.vatAmount, total: line.total }))

  const taxableAmount = quote?.taxableAmount ?? invoice?.taxableAmount ?? 0
  const vatAmount = quote?.vatAmount ?? invoice?.vatAmount ?? 0
  const total = quote?.total ?? invoice?.total ?? 0
  const number = quote?.number ?? invoice?.number ?? ''
  const issueDate = quote?.issueDate ?? invoice?.issueDate ?? ''
  const dueDate = quote?.dueDate ?? invoice?.dueDate ?? ''

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<title>${documentType} ${number}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1c1a18; margin: 32px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
  .logo { background: #111; color: #d6ad5c; padding: 12px 16px; letter-spacing: 2px; font-weight: 700; }
  h1 { margin: 0; font-size: 24px; color: #111; }
  .sub { color: #5b554d; font-size: 12px; margin-top: 4px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 22px; }
  .box { border: 1px solid #cdbb94; padding: 12px; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  th { text-align: left; background: #141414; color: #f0d28c; font-size: 11px; padding: 8px; }
  td { border-bottom: 1px solid #e2d8c2; font-size: 12px; padding: 8px; }
  tfoot td { border: 0; }
  .totals { width: 340px; margin-left: auto; border: 1px solid #d6c39f; border-radius: 6px; }
  .totals div { display: flex; justify-content: space-between; padding: 8px 12px; }
  .totals div:last-child { background: #141414; color: #f0d28c; font-weight: 700; }
  .foot { margin-top: 28px; font-size: 11px; color: #635c54; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="logo">${company.logoText || 'ELIAS'}</div>
      <div class="sub">${company.name}</div>
      <div class="sub">${company.address}</div>
      <div class="sub">P.IVA ${company.vatId} · C.F. ${company.taxCode}</div>
      <div class="sub">${company.phone} · ${company.email}</div>
    </div>
    <div>
      <h1>${documentType === 'preventivo' ? 'Preventivo' : 'Fattura'} ${number}</h1>
      <div class="sub">Data: ${issueDate}</div>
      <div class="sub">Scadenza: ${dueDate}</div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <strong>Cliente</strong>
      <div>${customer?.name ?? '-'}</div>
      <div>${customer?.address ?? ''}</div>
      <div>${customer?.email ?? ''}</div>
      <div>${customer?.phone ?? ''}</div>
    </div>
    <div class="box">
      <strong>Veicolo / Commessa</strong>
      <div>${vehicle?.plate ?? '-'}</div>
      <div>${vehicle ? `${vehicle.make} ${vehicle.model}` : '-'}</div>
      <div>Telaio: ${vehicle?.vin ?? '-'}</div>
      <div>Pratica: ${quote?.acceptanceId ?? invoice?.acceptanceId ?? '-'}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Descrizione</th><th>Q.tà</th><th>Prezzo</th><th>IVA</th><th>Imponibile</th><th>Totale</th></tr>
    </thead>
    <tbody>
      ${rows.map((row) => `<tr><td>${row.description}</td><td>${row.quantity.toLocaleString('it-IT')}</td><td>${row.unitPrice.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</td><td>${row.vatRate}%</td><td>${row.taxableAmount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</td><td>${row.total.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</td></tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div><span>Imponibile</span><strong>${taxableAmount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</strong></div>
    <div><span>IVA</span><strong>${vatAmount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</strong></div>
    <div><span>Totale</span><strong>${total.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</strong></div>
  </div>

  <div class="foot">Documento generato da Elias Body Shop ERP. Layout pronto per stampa multipagina.</div>
</body>
</html>`
}
