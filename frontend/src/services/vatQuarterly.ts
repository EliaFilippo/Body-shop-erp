import type { ErpData, PayableEntry, VatDeductibilityMode, VatQuarterRecord } from '../types'

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export interface VatQuarterSnapshot {
  quarterKey: string
  year: number
  quarter: 1 | 2 | 3 | 4
  vatDebit: number
  vatCredit: number
  adjustments: number
  estimatedNet: number
  estimatedPayable: number
  confirmedAmount: number | null
  linkedPayableId: string | null
  dueDate: string
  status: VatQuarterRecord['status']
  amountForPlanning: number
}

export interface VatQuarterOutflow {
  quarterKey: string
  dueDate: string
  amount: number
  status: VatQuarterRecord['status']
  linkedPayableId: string | null
  source: 'stimata' | 'confermata'
}

export interface VatQuarterDebitDetailRow {
  invoiceId: string
  number: string
  date: string
  customerId: string
  taxableAmount: number
  vatRatePercent: number | null
  vatDocumentAmount: number
  adjustmentNote: string
  vatCountedAmount: number
}

export interface VatQuarterCreditDetailRow {
  payableId: string
  invoiceNumber: string
  date: string
  supplierName: string
  taxableAmount: number
  vatRatePercent: number | null
  vatDocumentAmount: number
  deductibilityPercent: number
  deductibilityMode: 'full' | 'partial' | 'none'
  vatDeductedAmount: number
}

export interface VatQuarterAdjustmentDetailRow {
  id: string
  createdAt: string
  note: string
  amount: number
}

export interface VatQuarterDetail {
  quarterKey: string
  debitRows: VatQuarterDebitDetailRow[]
  creditRows: VatQuarterCreditDetailRow[]
  adjustmentRows: VatQuarterAdjustmentDetailRow[]
  debitTotal: number
  creditTotal: number
  adjustmentsTotal: number
  estimatedNet: number
  estimatedPayable: number
}

export function quarterKeyFromDate(date: string): string {
  const month = Number(date.slice(5, 7))
  const quarter = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4
  return `${date.slice(0, 4)}-Q${quarter}`
}

export function parseQuarterKey(quarterKey: string): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const match = quarterKey.match(/^(\d{4})-Q([1-4])$/)
  if (!match) throw new Error('Trimestre IVA non valido.')
  return { year: Number(match[1]), quarter: Number(match[2]) as 1 | 2 | 3 | 4 }
}

export function defaultVatQuarterDueDate(quarterKey: string): string {
  const { year, quarter } = parseQuarterKey(quarterKey)
  if (quarter === 1) return `${year}-05-16`
  if (quarter === 2) return `${year}-08-16`
  if (quarter === 3) return `${year}-11-16`
  return `${year + 1}-02-16`
}

function inQuarter(date: string, quarterKey: string) {
  return quarterKeyFromDate(date) === quarterKey
}

function normalizeDeductibility(payable: PayableEntry): number {
  const mode: VatDeductibilityMode = payable.vatDeductibilityMode ?? 'full'
  if (mode === 'none') return 0
  if (mode === 'partial') {
    const value = Number(payable.vatDeductibilityPercent ?? 0)
    return Math.max(0, Math.min(100, value)) / 100
  }
  return 1
}

function normalizeDeductibilityPercent(payable: PayableEntry): number {
  const mode: VatDeductibilityMode = payable.vatDeductibilityMode ?? 'full'
  if (mode === 'none') return 0
  if (mode === 'partial') return Math.max(0, Math.min(100, Number(payable.vatDeductibilityPercent ?? 0)))
  return 100
}

function inferVatRatePercent(taxableAmount: number, vatAmount: number): number | null {
  const taxable = Math.max(0, Number(taxableAmount) || 0)
  const vat = Math.max(0, Number(vatAmount) || 0)
  if (taxable <= 0 || vat <= 0) return null
  return round((vat / taxable) * 100)
}

function getRecord(data: ErpData, quarterKey: string): VatQuarterRecord | null {
  const records = data.vatQuarterlyRecords ?? []
  return records.find((item) => item.quarterKey === quarterKey) ?? null
}

function collectQuarterKeys(data: ErpData): string[] {
  const keys = new Set<string>()
  const today = new Date().toISOString().slice(0, 10)
  keys.add(quarterKeyFromDate(today))

  data.invoices.forEach((invoice) => {
    if (invoice.status === 'Stornata') return
    if (!invoice.issueDate) return
    keys.add(quarterKeyFromDate(invoice.issueDate))
  })

  ;(data.payables ?? []).forEach((payable) => {
    if (payable.kind !== 'supplier-invoice') return
    const date = payable.invoiceDate || payable.dueDate
    if (!date) return
    keys.add(quarterKeyFromDate(date))
  })

  ;(data.vatQuarterlyRecords ?? []).forEach((record) => {
    if (record.quarterKey) keys.add(record.quarterKey)
  })

  return [...keys].sort()
}

export function listVatQuarterKeysForYear(data: ErpData, year: number): string[] {
  const explicit = collectQuarterKeys(data).filter((key) => key.startsWith(String(year)))
  const all = new Set<string>(explicit)
  ;[1, 2, 3, 4].forEach((quarter) => all.add(`${year}-Q${quarter}`))
  return [...all].sort()
}

export function calculateVatQuarterSnapshot(data: ErpData, quarterKey: string): VatQuarterSnapshot {
  const { year, quarter } = parseQuarterKey(quarterKey)
  const record = getRecord(data, quarterKey)
  const vatDebit = round(data.invoices
    .filter((invoice) => invoice.status !== 'Stornata' && invoice.issueDate && inQuarter(invoice.issueDate, quarterKey))
    .reduce((sum, invoice) => sum + Math.max(0, invoice.vatAmount || 0), 0))

  const vatCredit = round((data.payables ?? [])
    .filter((payable) => payable.kind === 'supplier-invoice')
    .filter((payable) => {
      const date = payable.invoiceDate || payable.dueDate
      return !!date && inQuarter(date, quarterKey)
    })
    .reduce((sum, payable) => {
      const rawVat = Math.max(0, payable.vatAmount || 0)
      return sum + (rawVat * normalizeDeductibility(payable))
    }, 0))

  const adjustments = round((record?.adjustments ?? []).reduce((sum, item) => sum + Number(item.amount || 0), 0))
  const estimatedNet = round(vatDebit - vatCredit + adjustments)
  const estimatedPayable = round(Math.max(0, estimatedNet))
  const confirmedAmount = record?.confirmedAmount == null ? null : round(Math.max(0, Number(record.confirmedAmount)))
  const linkedPayableId = record?.linkedPayableId ?? null
  const linkedPayableExists = !!linkedPayableId && (data.payables ?? []).some((payable) => payable.id === linkedPayableId)
  const dueDate = record?.dueDate || defaultVatQuarterDueDate(quarterKey)
  const status = record?.status ?? 'In corso'
  const sourceAmount = confirmedAmount ?? estimatedPayable
  const amountForPlanning = linkedPayableExists ? 0 : round(Math.max(0, sourceAmount))

  return {
    quarterKey,
    year,
    quarter,
    vatDebit,
    vatCredit,
    adjustments,
    estimatedNet,
    estimatedPayable,
    confirmedAmount,
    linkedPayableId,
    dueDate,
    status,
    amountForPlanning,
  }
}

export function calculateVatQuarterOutflows(data: ErpData): VatQuarterOutflow[] {
  return collectQuarterKeys(data)
    .map((quarterKey) => calculateVatQuarterSnapshot(data, quarterKey))
    .filter((snapshot) => snapshot.amountForPlanning > 0)
    .map<VatQuarterOutflow>((snapshot) => ({
      quarterKey: snapshot.quarterKey,
      dueDate: snapshot.dueDate,
      amount: snapshot.amountForPlanning,
      status: snapshot.status,
      linkedPayableId: snapshot.linkedPayableId,
      source: snapshot.confirmedAmount != null ? 'confermata' : 'stimata',
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.quarterKey.localeCompare(b.quarterKey))
}

export function calculateVatQuarterDetail(data: ErpData, quarterKey: string): VatQuarterDetail {
  const record = getRecord(data, quarterKey)

  const debitRows: VatQuarterDebitDetailRow[] = data.invoices
    .filter((invoice) => invoice.issueDate && inQuarter(invoice.issueDate, quarterKey))
    .map((invoice) => {
      const vatDocumentAmount = round(Math.max(0, Number(invoice.vatAmount) || 0))
      const isStornata = invoice.status === 'Stornata'
      const note = isStornata
        ? 'Documento stornato (non conteggiato)'
        : (invoice.notes?.trim() || '')
      return {
        invoiceId: invoice.id,
        number: invoice.number,
        date: invoice.issueDate,
        customerId: invoice.customerId,
        taxableAmount: round(Math.max(0, Number(invoice.taxableAmount) || 0)),
        vatRatePercent: inferVatRatePercent(invoice.taxableAmount, invoice.vatAmount),
        vatDocumentAmount,
        adjustmentNote: note,
        vatCountedAmount: isStornata ? 0 : vatDocumentAmount,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))

  const creditRows: VatQuarterCreditDetailRow[] = (data.payables ?? [])
    .filter((payable) => payable.kind === 'supplier-invoice')
    .filter((payable) => {
      const date = payable.invoiceDate || payable.dueDate
      return !!date && inQuarter(date, quarterKey)
    })
    .map((payable) => {
      const mode = payable.vatDeductibilityMode ?? 'full'
      const vatDocumentAmount = round(Math.max(0, Number(payable.vatAmount) || 0))
      const factor = normalizeDeductibility(payable)
      const deductibilityPercent = normalizeDeductibilityPercent(payable)
      return {
        payableId: payable.id,
        invoiceNumber: payable.invoiceNumber?.trim() || 'Senza numero',
        date: payable.invoiceDate || payable.dueDate,
        supplierName: payable.supplierName?.trim() || 'Fornitore non indicato',
        taxableAmount: round(Math.max(0, Number(payable.taxableAmount) || 0)),
        vatRatePercent: inferVatRatePercent(Number(payable.taxableAmount || 0), Number(payable.vatAmount || 0)),
        vatDocumentAmount,
        deductibilityPercent,
        deductibilityMode: mode,
        vatDeductedAmount: round(vatDocumentAmount * factor),
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNumber.localeCompare(b.invoiceNumber))

  const adjustmentRows: VatQuarterAdjustmentDetailRow[] = (record?.adjustments ?? [])
    .map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      note: item.note,
      amount: round(Number(item.amount) || 0),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

  const debitTotal = round(debitRows.reduce((sum, item) => sum + item.vatCountedAmount, 0))
  const creditTotal = round(creditRows.reduce((sum, item) => sum + item.vatDeductedAmount, 0))
  const adjustmentsTotal = round(adjustmentRows.reduce((sum, item) => sum + item.amount, 0))
  const estimatedNet = round(debitTotal - creditTotal + adjustmentsTotal)
  const estimatedPayable = round(Math.max(0, estimatedNet))

  return {
    quarterKey,
    debitRows,
    creditRows,
    adjustmentRows,
    debitTotal,
    creditTotal,
    adjustmentsTotal,
    estimatedNet,
    estimatedPayable,
  }
}
