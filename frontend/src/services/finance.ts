import type {
  ErpData,
  FinancialEvent,
  Invoice,
  PayableCategory,
  PayableEntry,
  PayableInstallment,
  PayableKind,
  PayableStatus,
  PaymentMethod,
  RibaBatch,
  VatDeductibilityMode,
  VatQuarterRecord,
  VatQuarterStatus,
} from '../types'
import { ownerWithdrawalPlannedDateForMonth } from './economic'
import { calculateVatQuarterSnapshot } from './vatQuarterly'

const id = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const todayKey = () => new Date().toISOString().slice(0, 10)

export interface OwnerWithdrawalSnapshot {
  monthKey: string
  amount: number
  plannedDate: string
  settled: boolean
  settledAt: string | null
}

export function calculateOwnerWithdrawalSnapshot(data: ErpData, referenceDate = todayKey()): OwnerWithdrawalSnapshot {
  const monthKey = referenceDate.slice(0, 7)
  const amount = roundMoney(Math.max(0, Number(data.plannerSettings.ownerWithdrawalAmount ?? 0)))
  const plannedDate = ownerWithdrawalPlannedDateForMonth(data.plannerSettings, referenceDate)
  const settled = data.plannerSettings.ownerWithdrawalSettledMonthKey === monthKey
  return {
    monthKey,
    amount,
    plannedDate,
    settled,
    settledAt: settled ? data.plannerSettings.ownerWithdrawalSettledAt ?? null : null,
  }
}

export function updateOwnerWithdrawal(
  data: ErpData,
  input: { amount: number; plannedDate: string },
): ErpData {
  return {
    ...data,
    plannerSettings: {
      ...data.plannerSettings,
      ownerWithdrawalAmount: roundMoney(Math.max(0, Number(input.amount) || 0)),
      ownerWithdrawalPlannedDate: input.plannedDate,
    },
  }
}

export function markOwnerWithdrawalSettled(data: ErpData, referenceDate = todayKey()): ErpData {
  const monthKey = referenceDate.slice(0, 7)
  return {
    ...data,
    plannerSettings: {
      ...data.plannerSettings,
      ownerWithdrawalSettledMonthKey: monthKey,
      ownerWithdrawalSettledAt: now(),
    },
  }
}

export const invoiceResidual = (invoice: Invoice) => roundMoney(Math.max(0, invoice.total - invoice.collectedAmount - invoice.ribaAllocatedAmount))

export function calculateDueDate(issueDate: string, days: number, endOfMonth = false) {
  const date = new Date(`${issueDate}T12:00:00`)
  if (Number.isNaN(date.getTime())) throw new Error('Data fattura non valida.')
  date.setDate(date.getDate() + Math.max(0, days))
  if (endOfMonth) date.setMonth(date.getMonth() + 1, 0)
  return date.toISOString().slice(0, 10)
}

function event(input: Omit<FinancialEvent, 'id' | 'createdAt'>): FinancialEvent {
  return { ...input, id: id(), createdAt: now() }
}

export interface PayableInstallmentInput {
  installmentNo: number
  amount: number
  dueDate: string
  note?: string
}

export function calculateVatAmount(taxableAmount: number, vatRatePercent: number): number {
  const taxable = Math.max(0, Number(taxableAmount) || 0)
  const rate = Math.max(0, Number(vatRatePercent) || 0)
  return roundMoney(taxable * rate / 100)
}

export function calculateInvoiceTotalWithVat(taxableAmount: number, vatAmount: number): number {
  const taxable = Math.max(0, Number(taxableAmount) || 0)
  const vat = Math.max(0, Number(vatAmount) || 0)
  return roundMoney(taxable + vat)
}

export function splitAmountAcrossInstallments(totalAmount: number, installmentsCount: number): number[] {
  const totalCents = Math.max(0, Math.round((Number(totalAmount) || 0) * 100))
  const count = Math.max(1, Math.floor(Number(installmentsCount) || 0))
  const base = Math.floor(totalCents / count)
  const remainder = totalCents - (base * count)
  const portions = Array.from({ length: count }, () => base)
  portions[count - 1] += remainder
  return portions.map((cents) => cents / 100)
}

export interface PayableInput {
  kind: PayableKind
  category: PayableCategory
  description: string
  supplierName?: string
  invoiceNumber?: string
  invoiceDate?: string
  taxableAmount?: number
  vatAmount?: number
  vatDeductibilityMode?: VatDeductibilityMode
  vatDeductibilityPercent?: number
  totalAmount: number
  paymentMethod: PaymentMethod | 'F24' | 'Addebito' | 'Altro'
  dueDate: string
  referencePeriod?: string
  accountantNote?: string
  notes?: string
  installments: PayableInstallmentInput[]
}

export interface SetVatQuarterConfirmationInput {
  quarterKey: string
  confirmedAmount: number
  accountantNote?: string
  dueDate?: string
}

export interface AddVatQuarterAdjustmentInput {
  quarterKey: string
  note: string
  amount: number
}

export interface LinkVatQuarterToPayableInput {
  quarterKey: string
  payableId: string
}

export interface CreateVatQuarterF24Input {
  quarterKey: string
  dueDate?: string
  description?: string
  referencePeriod?: string
  accountantNote?: string
  installments?: PayableInstallmentInput[]
}

export const payableResidual = (payable: PayableEntry) => roundMoney(payable.installments.filter((item) => item.status !== 'Pagato').reduce((sum, item) => sum + item.amount, 0))

function normalizePayableStatus(installments: PayableInstallment[], referenceDate = todayKey()): PayableStatus {
  if (installments.every((item) => item.status === 'Pagato')) return 'Pagato'
  if (installments.some((item) => item.status !== 'Pagato' && item.dueDate < referenceDate)) return 'Scaduto'
  return 'Da pagare'
}

function normalizeInstallmentStatus(installment: PayableInstallment, referenceDate = todayKey()): PayableInstallment {
  if (installment.status === 'Pagato') return { ...installment, paidAt: installment.paidAt ?? null }
  return {
    ...installment,
    status: installment.dueDate < referenceDate ? 'Scaduto' : 'Da pagare',
    paidAt: null,
  }
}

function buildInstallments(input: PayableInput): PayableInstallment[] {
  const totalAmount = roundMoney(Math.max(0, Number(input.totalAmount) || 0))
  if (totalAmount <= 0) throw new Error('L’importo totale deve essere maggiore di zero.')
  if (!input.installments.length) throw new Error('Inserisci almeno una rata/scadenza.')

  const installments = input.installments
    .map((item, index) => ({
      id: id(),
      installmentNo: Number(item.installmentNo) || (index + 1),
      amount: roundMoney(Math.max(0, Number(item.amount) || 0)),
      dueDate: item.dueDate,
      status: 'Da pagare' as PayableStatus,
      paidAt: null,
      note: item.note?.trim() || '',
    }))
    .sort((a, b) => a.installmentNo - b.installmentNo)

  if (installments.some((item) => !item.dueDate)) throw new Error('Ogni rata deve avere una data di scadenza.')
  if (installments.some((item) => item.amount <= 0)) throw new Error('Ogni rata deve avere un importo maggiore di zero.')

  const totalInstallments = roundMoney(installments.reduce((sum, item) => sum + item.amount, 0))
  if (Math.abs(totalInstallments - totalAmount) > 0.01) throw new Error('La somma delle rate deve coincidere con il totale.')

  return installments.map((item) => normalizeInstallmentStatus(item))
}

function normalizePayableEntry(base: Omit<PayableEntry, 'status' | 'updatedAt'>): PayableEntry {
  const normalizedInstallments = base.installments.map((item) => normalizeInstallmentStatus(item))
  return {
    ...base,
    status: normalizePayableStatus(normalizedInstallments),
    updatedAt: now(),
    installments: normalizedInstallments,
  }
}

function normalizeDeductibility(mode?: VatDeductibilityMode, percent?: number): { mode: VatDeductibilityMode; percent: number } {
  const normalizedMode: VatDeductibilityMode = mode ?? 'full'
  if (normalizedMode === 'none') return { mode: normalizedMode, percent: 0 }
  if (normalizedMode === 'partial') return { mode: normalizedMode, percent: Math.max(0, Math.min(100, Number(percent) || 0)) }
  return { mode: normalizedMode, percent: 100 }
}

function normalizeVatQuarterRecord(record: VatQuarterRecord): VatQuarterRecord {
  return {
    quarterKey: record.quarterKey,
    status: record.status,
    confirmedAmount: record.confirmedAmount == null ? null : roundMoney(Math.max(0, Number(record.confirmedAmount) || 0)),
    confirmedAt: record.confirmedAt ?? null,
    accountantNote: record.accountantNote ?? '',
    linkedPayableId: record.linkedPayableId ?? null,
    dueDate: record.dueDate,
    adjustments: record.adjustments.map((item) => ({
      ...item,
      amount: roundMoney(Number(item.amount) || 0),
    })),
  }
}

function upsertVatQuarterRecord(data: ErpData, quarterKey: string, mutate: (current: VatQuarterRecord) => VatQuarterRecord): ErpData {
  const current = (data.vatQuarterlyRecords ?? []).find((item) => item.quarterKey === quarterKey) ?? {
    quarterKey,
    status: 'In corso' as VatQuarterStatus,
    confirmedAmount: null,
    confirmedAt: null,
    accountantNote: '',
    linkedPayableId: null,
    dueDate: undefined,
    adjustments: [],
  }
  const next = normalizeVatQuarterRecord(mutate(current))
  const records = data.vatQuarterlyRecords ?? []
  const exists = records.some((item) => item.quarterKey === quarterKey)
  return {
    ...data,
    vatQuarterlyRecords: exists
      ? records.map((item) => item.quarterKey === quarterKey ? next : item)
      : [next, ...records],
  }
}

export function createPayableEntry(data: ErpData, input: PayableInput): ErpData {
  const installments = buildInstallments(input)
  const deductibility = normalizeDeductibility(input.vatDeductibilityMode, input.vatDeductibilityPercent)
  const entry = normalizePayableEntry({
    id: id(),
    kind: input.kind,
    category: input.category,
    description: input.description.trim(),
    supplierName: input.supplierName?.trim() || '',
    invoiceNumber: input.invoiceNumber?.trim() || '',
    invoiceDate: input.invoiceDate || '',
    taxableAmount: input.taxableAmount !== undefined ? roundMoney(Math.max(0, Number(input.taxableAmount) || 0)) : undefined,
    vatAmount: input.vatAmount !== undefined ? roundMoney(Math.max(0, Number(input.vatAmount) || 0)) : undefined,
    vatDeductibilityMode: deductibility.mode,
    vatDeductibilityPercent: deductibility.percent,
    totalAmount: roundMoney(Math.max(0, Number(input.totalAmount) || 0)),
    paymentMethod: input.paymentMethod,
    dueDate: input.dueDate,
    referencePeriod: input.referencePeriod?.trim() || '',
    accountantNote: input.accountantNote?.trim() || '',
    notes: input.notes?.trim() || '',
    installments,
    createdAt: now(),
  })
  return {
    ...data,
    payables: [entry, ...(data.payables ?? [])],
  }
}

export function updatePayableEntry(data: ErpData, payableId: string, input: PayableInput): ErpData {
  const payables = data.payables ?? []
  const current = payables.find((item) => item.id === payableId)
  if (!current) throw new Error('Uscita non trovata.')
  const installments = buildInstallments(input)
  const deductibility = normalizeDeductibility(input.vatDeductibilityMode, input.vatDeductibilityPercent)
  const updated = normalizePayableEntry({
    id: current.id,
    kind: input.kind,
    category: input.category,
    description: input.description.trim(),
    supplierName: input.supplierName?.trim() || '',
    invoiceNumber: input.invoiceNumber?.trim() || '',
    invoiceDate: input.invoiceDate || '',
    taxableAmount: input.taxableAmount !== undefined ? roundMoney(Math.max(0, Number(input.taxableAmount) || 0)) : undefined,
    vatAmount: input.vatAmount !== undefined ? roundMoney(Math.max(0, Number(input.vatAmount) || 0)) : undefined,
    vatDeductibilityMode: deductibility.mode,
    vatDeductibilityPercent: deductibility.percent,
    totalAmount: roundMoney(Math.max(0, Number(input.totalAmount) || 0)),
    paymentMethod: input.paymentMethod,
    dueDate: input.dueDate,
    referencePeriod: input.referencePeriod?.trim() || '',
    accountantNote: input.accountantNote?.trim() || '',
    notes: input.notes?.trim() || '',
    installments,
    createdAt: current.createdAt,
  })
  return {
    ...data,
    payables: payables.map((item) => item.id === payableId ? updated : item),
  }
}

export function markPayableInstallmentPaid(data: ErpData, input: { payableId: string; installmentId: string; paymentDate: string }): ErpData {
  const payables = data.payables ?? []
  const payable = payables.find((item) => item.id === input.payableId)
  if (!payable) throw new Error('Uscita non trovata.')
  const installment = payable.installments.find((item) => item.id === input.installmentId)
  if (!installment) throw new Error('Rata non trovata.')
  if (installment.status === 'Pagato') return data

  const updatedPayables = payables.map((item) => {
    if (item.id !== payable.id) return item
    const updatedInstallments = item.installments.map((row) => row.id === installment.id
      ? { ...row, status: 'Pagato' as PayableStatus, paidAt: input.paymentDate }
      : normalizeInstallmentStatus(row, input.paymentDate))
    return {
      ...item,
      installments: updatedInstallments,
      status: normalizePayableStatus(updatedInstallments, input.paymentDate),
      updatedAt: now(),
    }
  })

  const paymentEvent = event({
    type: 'Pagamento uscita',
    date: input.paymentDate,
    amount: roundMoney(installment.amount),
    payableId: payable.id,
    payableInstallmentId: installment.id,
    note: `${payable.kind === 'f24' ? 'Pagamento F24' : 'Pagamento uscita'} · ${payable.description}`,
  })

  return {
    ...data,
    payables: updatedPayables,
    financialEvents: [paymentEvent, ...data.financialEvents],
  }
}

export function createInvoice(
  data: ErpData,
  input: { customerId: string; vehicleIds: string[]; number: string; issueDate: string; paymentMethod?: PaymentMethod; vatRate?: number; notes?: string },
): ErpData {
  const customer = data.customers.find((item) => item.id === input.customerId)
  if (!customer) throw new Error('Cliente non trovato.')
  if (!input.number.trim()) throw new Error('Il numero fattura è obbligatorio.')
  if (data.invoices.some((item) => item.number.trim().toLowerCase() === input.number.trim().toLowerCase())) throw new Error('Numero fattura già presente.')
  const vehicles = data.vehicles.filter((item) => input.vehicleIds.includes(item.id))
  if (!vehicles.length) throw new Error('Seleziona almeno una vettura da fatturare.')
  if (vehicles.some((item) => item.customerId !== input.customerId)) throw new Error('Tutte le vetture devono appartenere allo stesso cliente.')
  if (vehicles.some((item) => item.invoiceId || item.billingStatus === 'Fatturata')) throw new Error('Una o più vetture risultano già fatturate.')
  if (vehicles.some((item) => item.status !== 'Consegnata' && item.billingStatus !== 'Da fatturare')) throw new Error('Puoi fatturare solo vetture consegnate.')

  const vatRate = Number.isFinite(input.vatRate) ? Number(input.vatRate) : data.financeSettings.defaultVatRate
  const lines = vehicles.map((vehicle) => {
    const taxableAmount = roundMoney(vehicle.expectedRevenue)
    const vatAmount = roundMoney(taxableAmount * vatRate / 100)
    return { id: id(), vehicleId: vehicle.id, description: `${vehicle.plate} · ${vehicle.make} ${vehicle.model}`, taxableAmount, vatRate, vatAmount, total: roundMoney(taxableAmount + vatAmount) }
  })
  const taxableAmount = roundMoney(lines.reduce((sum, line) => sum + line.taxableAmount, 0))
  const vatAmount = roundMoney(lines.reduce((sum, line) => sum + line.vatAmount, 0))
  const total = roundMoney(taxableAmount + vatAmount)
  const issueDate = input.issueDate
  const dueDate = calculateDueDate(issueDate, customer.paymentDays ?? data.financeSettings.defaultPaymentDays, customer.endOfMonth)
  const timestamp = now()
  const invoice: Invoice = {
    id: id(), customerId: customer.id, number: input.number.trim(), issueDate, dueDate,
    paymentMethod: input.paymentMethod ?? customer.usualPaymentMethod ?? 'Bonifico', lines,
    taxableAmount, vatAmount, total, collectedAmount: 0, ribaAllocatedAmount: 0,
    status: 'Da incassare', notes: input.notes?.trim() ?? '', createdAt: timestamp, updatedAt: timestamp,
  }
  return {
    ...data,
    invoices: [invoice, ...data.invoices],
    vehicles: data.vehicles.map((vehicle) => input.vehicleIds.includes(vehicle.id) ? { ...vehicle, invoiceId: invoice.id, billingStatus: 'Fatturata' } : vehicle),
    financialEvents: [event({ type: 'Fattura emessa', date: issueDate, amount: total, customerId: customer.id, invoiceId: invoice.id, note: `Fattura ${invoice.number}` }), ...data.financialEvents],
  }
}

export function createRibaBatch(
  data: ErpData,
  input: { number: string; bankAccountId: string; presentationDate: string; dueDate: string; allocations: { invoiceId: string; amount: number }[] },
): ErpData {
  if (!input.number.trim()) throw new Error('Il numero distinta è obbligatorio.')
  if (data.ribaBatches.some((item) => item.number.trim().toLowerCase() === input.number.trim().toLowerCase())) throw new Error('Numero distinta già presente.')
  const bank = data.bankAccounts.find((item) => item.id === input.bankAccountId)
  if (!bank) throw new Error('Banca non trovata.')
  if (!input.allocations.length) throw new Error('Inserisci almeno una fattura nella distinta.')
  const seen = new Set<string>()
  const allocations = input.allocations.map((allocation) => {
    if (seen.has(allocation.invoiceId)) throw new Error('La stessa fattura non può comparire due volte nella distinta.')
    seen.add(allocation.invoiceId)
    const invoice = data.invoices.find((item) => item.id === allocation.invoiceId)
    if (!invoice) throw new Error('Fattura non trovata.')
    const amount = roundMoney(Number(allocation.amount))
    if (amount <= 0) throw new Error('L’importo R.I.B.A. deve essere maggiore di zero.')
    const residual = invoiceResidual(invoice)
    if (amount > residual) throw new Error(`La fattura ${invoice.number} ha un residuo disponibile di € ${residual.toLocaleString('it-IT', { minimumFractionDigits: 2 })}.`)
    return { id: id(), invoiceId: invoice.id, amount }
  })
  const total = roundMoney(allocations.reduce((sum, item) => sum + item.amount, 0))
  const used = data.ribaBatches.filter((item) => item.bankAccountId === bank.id && !['Chiusa', 'Stornata'].includes(item.status)).reduce((sum, item) => sum + item.advancedAmount, 0)
  if (bank.blockOverLimit && used + total > bank.creditLimit) throw new Error(`Plafond superato. Disponibile: € ${Math.max(0, bank.creditLimit - used).toLocaleString('it-IT', { minimumFractionDigits: 2 })}.`)
  const timestamp = now()
  const batch: RibaBatch = { id: id(), number: input.number.trim(), bankAccountId: bank.id, presentationDate: input.presentationDate, dueDate: input.dueDate, allocations, total, advancedAmount: 0, advanceDate: '', fees: 0, interest: 0, status: 'Presentata', createdAt: timestamp, updatedAt: timestamp }
  const allocatedByInvoice = new Map(allocations.map((item) => [item.invoiceId, item.amount]))
  return {
    ...data,
    ribaBatches: [batch, ...data.ribaBatches],
    invoices: data.invoices.map((invoice) => {
      const allocated = allocatedByInvoice.get(invoice.id)
      if (!allocated) return invoice
      const nextAllocated = roundMoney(invoice.ribaAllocatedAmount + allocated)
      return { ...invoice, ribaAllocatedAmount: nextAllocated, status: nextAllocated >= invoice.total - invoice.collectedAmount ? 'Inserita in R.I.B.A.' : 'Parzialmente inserita in R.I.B.A.', updatedAt: timestamp }
    }),
    financialEvents: [event({ type: 'R.I.B.A. presentata', date: input.presentationDate, amount: total, ribaBatchId: batch.id, bankAccountId: bank.id, note: `Distinta ${batch.number}` }), ...data.financialEvents],
  }
}

export function registerRibaAdvance(data: ErpData, batchId: string, amount: number, date: string, fees = 0, interest = 0): ErpData {
  const batch = data.ribaBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('Distinta non trovata.')
  const advancedAmount = roundMoney(amount)
  if (advancedAmount <= 0 || advancedAmount > batch.total) throw new Error('Importo anticipato non valido.')
  const timestamp = now()
  return {
    ...data,
    ribaBatches: data.ribaBatches.map((item) => item.id === batchId ? { ...item, advancedAmount, advanceDate: date, fees: roundMoney(fees), interest: roundMoney(interest), status: 'Anticipata', updatedAt: timestamp } : item),
    invoices: data.invoices.map((invoice) => batch.allocations.some((allocation) => allocation.invoiceId === invoice.id) && invoice.status !== 'Incassata' ? { ...invoice, status: 'Anticipata', updatedAt: timestamp } : invoice),
    financialEvents: [event({ type: 'Anticipo bancario', date, amount: advancedAmount, ribaBatchId: batch.id, bankAccountId: batch.bankAccountId, note: `Anticipo distinta ${batch.number}; costi € ${roundMoney(fees + interest).toLocaleString('it-IT')}` }), ...data.financialEvents],
  }
}

export function settleRibaBatch(data: ErpData, batchId: string, date: string): ErpData {
  const batch = data.ribaBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('Distinta non trovata.')
  const timestamp = now()
  const amounts = new Map(batch.allocations.map((item) => [item.invoiceId, item.amount]))
  return {
    ...data,
    ribaBatches: data.ribaBatches.map((item) => item.id === batchId ? { ...item, status: 'Chiusa', updatedAt: timestamp } : item),
    invoices: data.invoices.map((invoice) => {
      const amount = amounts.get(invoice.id)
      if (!amount) return invoice
      const collectedAmount = roundMoney(invoice.collectedAmount + amount)
      const ribaAllocatedAmount = roundMoney(Math.max(0, invoice.ribaAllocatedAmount - amount))
      return { ...invoice, collectedAmount, ribaAllocatedAmount, status: collectedAmount >= invoice.total ? 'Incassata' : 'Da incassare', updatedAt: timestamp }
    }),
    financialEvents: [event({ type: 'Incasso definitivo', date, amount: batch.total, ribaBatchId: batch.id, bankAccountId: batch.bankAccountId, note: `Incasso distinta ${batch.number}` }), ...data.financialEvents],
  }
}

export function markRibaInsolvent(data: ErpData, batchId: string, date: string): ErpData {
  const batch = data.ribaBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('Distinta non trovata.')
  const timestamp = now()
  const amounts = new Map(batch.allocations.map((item) => [item.invoiceId, item.amount]))
  return {
    ...data,
    ribaBatches: data.ribaBatches.map((item) => item.id === batchId ? { ...item, status: 'Insoluta', updatedAt: timestamp } : item),
    invoices: data.invoices.map((invoice) => {
      const amount = amounts.get(invoice.id)
      return amount ? { ...invoice, ribaAllocatedAmount: roundMoney(Math.max(0, invoice.ribaAllocatedAmount - amount)), status: 'Insoluta', updatedAt: timestamp } : invoice
    }),
    financialEvents: [event({ type: 'Insoluto', date, amount: batch.total, ribaBatchId: batch.id, bankAccountId: batch.bankAccountId, note: `Insoluto distinta ${batch.number}` }), ...data.financialEvents],
  }
}

export function setVatQuarterStatus(data: ErpData, quarterKey: string, status: VatQuarterStatus): ErpData {
  return upsertVatQuarterRecord(data, quarterKey, (current) => ({
    ...current,
    status,
  }))
}

export function setVatQuarterConfirmation(data: ErpData, input: SetVatQuarterConfirmationInput): ErpData {
  return upsertVatQuarterRecord(data, input.quarterKey, (current) => ({
    ...current,
    status: 'Confermata dal commercialista',
    confirmedAmount: roundMoney(Math.max(0, Number(input.confirmedAmount) || 0)),
    confirmedAt: now(),
    accountantNote: input.accountantNote?.trim() || current.accountantNote || '',
    dueDate: input.dueDate || current.dueDate,
  }))
}

export function addVatQuarterAdjustment(data: ErpData, input: AddVatQuarterAdjustmentInput): ErpData {
  return upsertVatQuarterRecord(data, input.quarterKey, (current) => ({
    ...current,
    adjustments: [
      {
        id: id(),
        note: input.note.trim() || 'Rettifica',
        amount: roundMoney(Number(input.amount) || 0),
        createdAt: now(),
      },
      ...current.adjustments,
    ],
  }))
}

export function linkVatQuarterToPayable(data: ErpData, input: LinkVatQuarterToPayableInput): ErpData {
  const payable = (data.payables ?? []).find((item) => item.id === input.payableId)
  if (!payable) throw new Error('F24 da collegare non trovato.')
  if (payable.kind !== 'f24') throw new Error('È possibile collegare solo pagamenti F24.')
  return upsertVatQuarterRecord(data, input.quarterKey, (current) => ({
    ...current,
    linkedPayableId: payable.id,
    status: current.status === 'In corso' ? 'Da verificare' : current.status,
  }))
}

export function createVatQuarterF24Payable(data: ErpData, input: CreateVatQuarterF24Input): ErpData {
  const snapshot = calculateVatQuarterSnapshot(data, input.quarterKey)
  const existingLinkedPayableId = snapshot.linkedPayableId
  if (existingLinkedPayableId && (data.payables ?? []).some((item) => item.id === existingLinkedPayableId)) {
    throw new Error('Per questo trimestre IVA esiste già un F24 collegato.')
  }

  const amount = roundMoney(Math.max(0, snapshot.confirmedAmount ?? snapshot.estimatedPayable))
  if (amount <= 0) throw new Error('Il trimestre selezionato non ha IVA da versare.')
  const dueDate = input.dueDate || snapshot.dueDate
  const installments = input.installments?.length
    ? input.installments
    : [{ installmentNo: 1, amount, dueDate }]

  const linkedWithSameQuarter = (data.payables ?? []).find((payable) => payable.kind === 'f24' && payable.referencePeriod === `IVA ${input.quarterKey}`)
  if (linkedWithSameQuarter) throw new Error('Esiste già un F24 IVA per questo trimestre.')

  const withPayable = createPayableEntry(data, {
    kind: 'f24',
    category: 'f24-imposte',
    description: input.description?.trim() || `F24 IVA ${input.quarterKey}`,
    totalAmount: amount,
    paymentMethod: 'F24',
    dueDate,
    referencePeriod: input.referencePeriod?.trim() || `IVA ${input.quarterKey}`,
    accountantNote: input.accountantNote?.trim() || snapshot.quarterKey,
    notes: '',
    installments,
  })

  const createdPayable = (withPayable.payables ?? [])[0]
  if (!createdPayable) return withPayable
  return upsertVatQuarterRecord(withPayable, input.quarterKey, (current) => ({
    ...current,
    linkedPayableId: createdPayable.id,
    dueDate,
    status: current.status === 'In corso' ? 'Da verificare' : current.status,
  }))
}
