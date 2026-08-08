import type { ErpData, FinancialEvent, Invoice, PaymentMethod, RibaBatch } from '../types'
import { ownerWithdrawalPlannedDateForMonth } from './economic'

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
