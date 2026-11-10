import { addDays } from './workCalendar'
import { expectedPaymentDate } from './paymentTerms'
import { ribaExposure, RIBA_CREDIT_LIMIT } from './treasury'
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
  Vehicle,
  VatDeductibilityMode,
  VatQuarterRecord,
  VatQuarterStatus,
} from '../types'
import { ownerWithdrawalPlannedDateForMonth } from './economic'
import { isVehicleDeliveredStatus } from './vehicleStatuses'
import { normalizePlate } from './erp'
import { calculateVatQuarterSnapshot } from './vatQuarterly'

const id = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const todayKey = () => new Date().toISOString().slice(0, 10)

const romeDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Rome'})

export function payableDueAlerts(data: Pick<ErpData, 'payables'>, referenceDate = romeDate.format(new Date())) {
  const limit = addDays(referenceDate, 15)
  return (data.payables ?? []).flatMap(payable => payable.installments
    .filter(installment => installment.status !== 'Pagato' && Number.isFinite(Date.parse(installment.dueDate)) && installment.dueDate <= limit)
    .map(installment => ({payable, installment, overdue: installment.dueDate < referenceDate})))
    .sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate))
}

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
  costLines?: PayableEntry['costLines']
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
    costLines: input.costLines,
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
    costLines: input.costLines ?? current.costLines,
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

function vehicleInvoiceJobs(data: Pick<ErpData, 'jobs'>, vehicle: Vehicle) {
  const plate = normalizePlate(vehicle.plate)
  return (data.jobs ?? []).filter(job => job.status !== 'Annullata' && job.customerId === vehicle.customerId
    && (job.vehicleId ? job.vehicleId === vehicle.id : Boolean(plate) && normalizePlate(job.plate) === plate))
}

export function vehicleWorkFinished(data: Pick<ErpData, 'jobs'>, vehicle: Vehicle) {
  const jobs = vehicleInvoiceJobs(data, vehicle)
  if (jobs.length !== 1) return false
  const phases = jobs[0].phases.filter(phase => !phase.notRequired && phase.name !== 'Consegna')
  return phases.length > 0 && phases.every(phase => phase.status === 'Completata')
}

export function vehicleInvoiceTaxableAmount(data: Pick<ErpData, 'jobs'>, vehicle: Vehicle): number | null {
  const jobs = vehicleInvoiceJobs(data, vehicle)
  if (jobs.length > 1) return null

  const amount = roundMoney(jobs.length === 1 ? jobs[0].taxableAmount : vehicle.expectedRevenue)
  return Number.isFinite(amount) && amount > 0 ? amount : null
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
  if (vehicles.some((item) => !isVehicleDeliveredStatus(data.plannerSettings, item.status) && item.billingStatus !== 'Da fatturare' && !vehicleWorkFinished(data, item))) throw new Error('Puoi fatturare le vetture consegnate o con tutte le lavorazioni completate.')

  const vatRate = Number.isFinite(input.vatRate) ? Number(input.vatRate) : data.financeSettings.defaultVatRate
  const lines = vehicles.map((vehicle) => {
    const taxableAmount = vehicleInvoiceTaxableAmount(data, vehicle)
    if (taxableAmount === null) throw new Error(`Controlla l’imponibile e la commessa della vettura ${vehicle.plate} prima di fatturare.`)
    const vatAmount = roundMoney(taxableAmount * vatRate / 100)
    return { id: id(), vehicleId: vehicle.id, description: `${vehicle.plate} · ${vehicle.make} ${vehicle.model}`, taxableAmount, vatRate, vatAmount, total: roundMoney(taxableAmount + vatAmount) }
  })
  const taxableAmount = roundMoney(lines.reduce((sum, line) => sum + line.taxableAmount, 0))
  const vatAmount = roundMoney(lines.reduce((sum, line) => sum + line.vatAmount, 0))
  const total = roundMoney(taxableAmount + vatAmount)
  const issueDate = input.issueDate
  const agreedTerms = vehicles.map(vehicle => (data.estimates ?? []).find(estimate => estimate.status === 'Approvato' && (estimate.vehicleId === vehicle.id || (data.jobs ?? []).some(job => job.estimateId === estimate.id && job.vehicleId === vehicle.id)))?.paymentTerms)
  const firstTerms = agreedTerms[0]
  if (agreedTerms.some(terms => JSON.stringify(terms && { method: terms.method, days: terms.days, endOfMonth: terms.endOfMonth, expectedCollectionDate:terms.expectedCollectionDate,atDelivery:terms.atDelivery }) !== JSON.stringify(firstTerms && { method: firstTerms.method, days: firstTerms.days, endOfMonth: firstTerms.endOfMonth,expectedCollectionDate:firstTerms.expectedCollectionDate,atDelivery:firstTerms.atDelivery }))) throw new Error('Le vetture hanno condizioni di pagamento diverse: emetti fatture separate.')
  const dueDate = (firstTerms?.expectedCollectionDate || (firstTerms?.atDelivery?expectedPaymentDate(firstTerms,vehicles[0]?.deliveryDate||vehicles[0]?.requestedDeliveryDate):'')) || calculateDueDate(issueDate, firstTerms?.days ?? customer.paymentDays ?? data.financeSettings.defaultPaymentDays, firstTerms?.endOfMonth ?? customer.endOfMonth)
  const timestamp = now()
  const invoice: Invoice = {
    id: id(), customerId: customer.id, number: input.number.trim(), issueDate, dueDate,
    paymentMethod: firstTerms?.method ?? input.paymentMethod ?? customer.usualPaymentMethod ?? 'Bonifico', lines,
    taxableAmount, vatAmount, total, collectedAmount: 0, ribaAllocatedAmount: 0,
    status: 'Da incassare', notes: input.notes?.trim() ?? '', createdAt: timestamp, updatedAt: timestamp,
  }
  return linkPendingRibaToInvoice({
    ...data,
    invoices: [invoice, ...data.invoices],
    vehicles: data.vehicles.map((vehicle) => input.vehicleIds.includes(vehicle.id) ? { ...vehicle, invoiceId: invoice.id, billingStatus: 'Fatturata' } : vehicle),
    financialEvents: [event({ type: 'Fattura emessa', date: issueDate, amount: total, customerId: customer.id, invoiceId: invoice.id, note: `Fattura ${invoice.number}` }), ...data.financialEvents],
  }, invoice.id)
}

export function linkPendingRibaToInvoice(data: ErpData, invoiceId: string): ErpData {
  const invoice = data.invoices.find(item => item.id === invoiceId)
  if (!invoice) return data
  const remainingByVehicle = new Map<string, number>()
  for (const line of invoice.lines) {
    remainingByVehicle.set(line.vehicleId, roundMoney((remainingByVehicle.get(line.vehicleId) ?? 0) + line.total))
  }
  let collected = 0
  let allocated = 0
  let advanced = false
  const ribaBatches = data.ribaBatches.map(batch => {
    if (batch.status === 'Stornata' || batch.status === 'Insoluta') return batch
    const matching = (batch.pendingVehicleLinks ?? []).filter(link => remainingByVehicle.has(link.vehicleId))
    if (!matching.length) return batch
    for (const link of matching) {
      const remaining = remainingByVehicle.get(link.vehicleId) ?? 0
      if (link.amount > remaining) throw new Error(`La Ri.Ba. di ${link.plate} supera il totale IVA inclusa della vettura in fattura. Verifica gli importi.`)
      remainingByVehicle.set(link.vehicleId, roundMoney(remaining - link.amount))
    }
    const amount = roundMoney(matching.reduce((sum, link) => sum + link.amount, 0))
    if (batch.status === 'Chiusa') collected = roundMoney(collected + amount)
    else allocated = roundMoney(allocated + amount)
    if (batch.status === 'Anticipata') advanced = true
    return {
      ...batch,
      allocations: [...batch.allocations, { id: id(), invoiceId, amount }],
      vehicleLinks: [...(batch.vehicleLinks ?? []), ...matching.map(link => ({ ...link, invoiceId }))],
      pendingVehicleLinks: batch.pendingVehicleLinks?.filter(link => !remainingByVehicle.has(link.vehicleId)),
      updatedAt: now(),
    }
  })
  if (!collected && !allocated) return data
  const status: Invoice['status'] = collected >= invoice.total ? 'Incassata'
    : advanced ? 'Anticipata'
    : allocated >= roundMoney(invoice.total - collected) ? 'Inserita in R.I.B.A.'
    : allocated > 0 ? 'Parzialmente inserita in R.I.B.A.' : 'Da incassare'
  return {
    ...data, ribaBatches,
    invoices: data.invoices.map(item => item.id === invoiceId
      ? { ...item, collectedAmount: collected, ribaAllocatedAmount: allocated, status } : item),
  }
}

export function createRibaBatch(
  data: ErpData,
  input: { number: string; bankAccountId: string; presentationDate: string; dueDate: string; collectionDate?:string; vehicleLinks?:RibaBatch['vehicleLinks']; pendingVehicleLinks?: RibaBatch['pendingVehicleLinks']; allocations: { invoiceId: string; amount: number }[] },
): ErpData {
  if (!input.number.trim()) throw new Error('Il numero distinta è obbligatorio.')
  for(const value of [input.presentationDate,input.dueDate,input.collectionDate||input.dueDate])if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Controlla le date della distinta RIBA.')
  if (data.ribaBatches.some((item) => item.number.trim().toLowerCase() === input.number.trim().toLowerCase())) throw new Error('Numero distinta già presente.')
  const bank = data.bankAccounts.find((item) => item.id === input.bankAccountId)
  if (!bank) throw new Error('Banca non trovata.')
  const pendingVehicleLinks = input.pendingVehicleLinks ?? []
  if (!input.allocations.length && !pendingVehicleLinks.length) throw new Error('Inserisci almeno una vettura o fattura nella distinta.')
  const pendingIds = new Set<string>()
  for (const link of pendingVehicleLinks) {
    const vehicle = data.vehicles.find(item => item.id === link.vehicleId)
    if (!vehicle || vehicle.invoiceId || vehicle.billingStatus === 'Fatturata'
      || data.invoices.some(invoice => invoice.vehicleId === link.vehicleId || invoice.lines.some(line => line.vehicleId === link.vehicleId))
      || pendingIds.has(link.vehicleId)
      || data.ribaBatches.some(batch => !['Insoluta', 'Stornata'].includes(batch.status)
        && batch.pendingVehicleLinks?.some(item => item.vehicleId === link.vehicleId))) {
      throw new Error('La vettura ha già una fattura o una Ri.Ba. registrata.')
    }
    if (!Number.isFinite(link.amount) || link.amount <= 0 || roundMoney(link.amount) !== link.amount) {
      throw new Error('Inserisci un importo Ri.Ba. valido in euro e centesimi.')
    }
    pendingIds.add(link.vehicleId)
  }
  const seen = new Set<string>()
  const allocations = input.allocations.map((allocation) => {
    if (seen.has(allocation.invoiceId)) throw new Error('La stessa fattura non può comparire due volte nella distinta.')
    seen.add(allocation.invoiceId)
    const invoice = data.invoices.find((item) => item.id === allocation.invoiceId)
    if (!invoice) throw new Error('Fattura non trovata.')
    const amount = roundMoney(Number(allocation.amount))
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('L’importo R.I.B.A. deve essere maggiore di zero.')
    const residual = invoiceResidual(invoice)
    if (amount > residual) throw new Error(`La fattura ${invoice.number} ha un residuo disponibile di € ${residual.toLocaleString('it-IT', { minimumFractionDigits: 2 })}.`)
    return { id: id(), invoiceId: invoice.id, amount }
  })
  const allocatedTotal = roundMoney(allocations.reduce((sum, item) => sum + item.amount, 0))
  const total = roundMoney(allocatedTotal + pendingVehicleLinks.reduce((sum, link) => sum + link.amount, 0))

  if(input.vehicleLinks){
   if(roundMoney(input.vehicleLinks.reduce((sum,link)=>sum+link.amount,0))!==allocatedTotal||input.vehicleLinks.some(link=>!allocations.some(allocation=>allocation.invoiceId===link.invoiceId)))throw new Error('Totale riepilogo vetture non valido.')
   for(const link of input.vehicleLinks){
    const invoice=data.invoices.find(item=>item.id===link.invoiceId)
    if(!invoice||!data.vehicles.some(vehicle=>vehicle.id===link.vehicleId)||!(invoice.vehicleId===link.vehicleId||invoice.lines.some(line=>line.vehicleId===link.vehicleId))||!Number.isFinite(link.amount)||link.amount<=0)throw new Error('Collegamento vettura e fattura RIBA non valido.')
   }
   for(const allocation of allocations)if(roundMoney(input.vehicleLinks.filter(link=>link.invoiceId===allocation.invoiceId).reduce((sum,link)=>sum+link.amount,0))!==allocation.amount)throw new Error('Il riepilogo vetture non corrisponde al totale della distinta.')
  }
  const timestamp = now()
  const batch: RibaBatch = { collectionDate:input.collectionDate||input.dueDate,vehicleLinks:input.vehicleLinks,pendingVehicleLinks:pendingVehicleLinks.length ? pendingVehicleLinks : undefined, id: id(), number: input.number.trim(), bankAccountId: bank.id, presentationDate: input.presentationDate, dueDate: input.dueDate, allocations, total, advancedAmount: 0, advanceDate: '', fees: 0, interest: 0, status: 'Presentata', createdAt: timestamp, updatedAt: timestamp }
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
  if (batch.status !== 'Presentata') throw new Error('Puoi anticipare una distinta presentata una sola volta.')
  const bank = data.bankAccounts.find(item => item.id === batch.bankAccountId)
  if (!bank) throw new Error('Banca non trovata.')
  if (![amount, fees, interest].every(Number.isFinite) || fees < 0 || interest < 0 || fees + interest >= amount) throw new Error('Controlla importo, commissioni e interessi.')
  if (ribaExposure(data) + amount > RIBA_CREDIT_LIMIT || (bank.creditLimit > 0 && ribaExposure(data, bank.id) + amount > bank.creditLimit)) throw new Error('Anticipo oltre il castelletto disponibile (massimo totale 40.000 €).')
  validateActualBankDate(date)
  const advancedAmount = roundMoney(amount)
  if (advancedAmount <= 0 || advancedAmount > batch.total) throw new Error('Importo anticipato non valido.')
  const timestamp = now()
  return {
    ...data,
    bankAccounts:data.bankAccounts.map(item=>item.id===batch.bankAccountId?{...item,currentBalance:roundMoney(item.currentBalance+advancedAmount-fees-interest)}:item),
    ribaBatches: data.ribaBatches.map((item) => item.id === batchId ? { ...item, bankAdvanceApplied:true, advancedAmount, advanceDate: date, fees: roundMoney(fees), interest: roundMoney(interest), status: 'Anticipata', updatedAt: timestamp } : item),
    invoices: data.invoices.map((invoice) => batch.allocations.some((allocation) => allocation.invoiceId === invoice.id) && invoice.status !== 'Incassata' ? { ...invoice, status: 'Anticipata', updatedAt: timestamp } : invoice),
    financialEvents: [event({ type: 'Anticipo bancario', date, amount: advancedAmount, ribaBatchId: batch.id, bankAccountId: batch.bankAccountId, note: `Anticipo distinta ${batch.number}; costi € ${roundMoney(fees + interest).toLocaleString('it-IT')}` }), ...data.financialEvents],
  }
}

export function settleRibaBatch(data: ErpData, batchId: string, date: string): ErpData {
  const batch = data.ribaBatches.find((item) => item.id === batchId)
  if (!batch) throw new Error('Distinta non trovata.')
  if(!['Presentata','Anticipata'].includes(batch.status))throw new Error('Questa distinta è già chiusa o non disponibile.')
  validateActualBankDate(date)
  const timestamp = now()
  const amounts = new Map(batch.allocations.map((item) => [item.invoiceId, item.amount]))
  return {
    ...data,
    bankAccounts:data.bankAccounts.map(item=>item.id===batch.bankAccountId?{...item,currentBalance:roundMoney(item.currentBalance+Math.max(0,batch.total-batch.advancedAmount))}:item),
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
  if(!['Presentata','Anticipata'].includes(batch.status))throw new Error('Questa distinta è già chiusa o non disponibile.')
  validateActualBankDate(date)
  const timestamp = now()
  const amounts = new Map(batch.allocations.map((item) => [item.invoiceId, item.amount]))
  return {
    ...data,
    bankAccounts:data.bankAccounts.map(item=>item.id===batch.bankAccountId&&batch.bankAdvanceApplied?{...item,currentBalance:roundMoney(item.currentBalance-batch.advancedAmount)}:item),
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

function validateActualBankDate(date:string){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date())
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||date>today)throw new Error('Inserisci una data bancaria effettiva valida, non futura.')
}
