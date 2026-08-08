import type { ErpData } from '../types'
import { invoiceDocumentStatus } from './documents'

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const dayMs = 86400000

const toDate = (value: string) => new Date(`${value}T12:00:00`)
const todayKey = () => new Date().toISOString().slice(0, 10)
const addDays = (value: string, days: number) => {
  const date = toDate(value)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}
const diffDays = (from: string, to: string) => Math.ceil((toDate(to).getTime() - toDate(from).getTime()) / dayMs)

export interface CashFlowWindow {
  days: 30 | 60 | 90
  inflow: number
  outflow: number
  balance: number
}

export interface CashFlowPoint {
  label: string
  date: string
  liquidBalance: number
  inflow: number
  outflow: number
  collected: number
  overdue: number
  atRisk: number
}

export interface CashFlowSnapshot {
  baseLiquidity: number | null
  windows: CashFlowWindow[]
  collected: number
  expected: number
  overdue: number
  atRisk: number
  points: CashFlowPoint[]
}

export interface CreditControlRow {
  customerId: string
  customerName: string
  openCredit: number
  overdueCredit: number
  averageCollectionDays: number
  critical: boolean
  openInvoices: number
}

export interface CreditFilter {
  customerId?: string
  period?: 'oggi' | 'settimana' | 'mese' | 'anno'
  state?: 'all' | 'critical' | 'regular'
}

export interface CalendarEvent {
  id: string
  type: 'delivery' | 'invoice-due' | 'riba-due' | 'payment-expected' | 'response-needed'
  title: string
  date: string
  status: 'scaduto' | 'oggi' | 'imminente' | 'futuro'
  amount?: number
  customerId?: string
}

export function calculateCashFlowSnapshot(data: ErpData, referenceDate = todayKey()): CashFlowSnapshot {
  const baseLiquidity = data.bankAccounts.length ? round(data.bankAccounts.reduce((sum, item) => sum + item.currentBalance, 0)) : null
  const openInvoices = data.invoices.filter((invoice) => !['Incassata', 'Stornata'].includes(invoice.status))

  const invoicesWithResidual = openInvoices.map((invoice) => ({
    invoice,
    residual: round(Math.max(0, invoice.total - invoice.collectedAmount)),
    daysToDue: diffDays(referenceDate, invoice.dueDate),
  }))

  const inflowInWindow = (days: number) => round(invoicesWithResidual
    .filter((item) => item.daysToDue >= 0 && item.daysToDue <= days)
    .reduce((sum, item) => sum + item.residual, 0)
    + data.ribaBatches
      .filter((batch) => !['Chiusa', 'Stornata', 'Insoluta'].includes(batch.status) && diffDays(referenceDate, batch.dueDate) >= 0 && diffDays(referenceDate, batch.dueDate) <= days)
      .reduce((sum, batch) => sum + batch.total, 0))

  const outflowInWindow = (days: number) => {
    const end = addDays(referenceDate, days)
    const plannedCosts = data.vehicles.reduce((sum, vehicle) => sum + (vehicle.costEntries ?? []).reduce((lineSum, line) => {
      const usedAt = line.usedAt?.slice(0, 10)
      return lineSum + (usedAt && usedAt >= referenceDate && usedAt <= end ? (line.total || 0) : 0)
    }, 0), 0)
    const expectedEvents = data.financialEvents
      .filter((event) => event.type === 'Uscita prevista' && event.date >= referenceDate && event.date <= end)
      .reduce((sum, event) => sum + event.amount, 0)
    return round(plannedCosts + expectedEvents)
  }

  const windows: CashFlowWindow[] = [30, 60, 90].map((days) => {
    const inflow = inflowInWindow(days)
    const outflow = outflowInWindow(days)
    const baseline = baseLiquidity ?? 0
    return {
      days: days as 30 | 60 | 90,
      inflow,
      outflow,
      balance: round(baseline + inflow - outflow),
    }
  })

  const overdue = round(invoicesWithResidual.filter((item) => item.daysToDue < 0).reduce((sum, item) => sum + item.residual, 0))
  const expected = round(invoicesWithResidual.filter((item) => item.daysToDue >= 0).reduce((sum, item) => sum + item.residual, 0))
  const collected = round(data.financialEvents.filter((event) => event.type === 'Incasso definitivo').reduce((sum, event) => sum + event.amount, 0))
  const atRisk = round(invoicesWithResidual
    .filter((item) => {
      const status = invoiceDocumentStatus(item.invoice, referenceDate)
      return status === 'scaduta' || item.invoice.status === 'Insoluta' || item.daysToDue <= 7
    })
    .reduce((sum, item) => sum + item.residual, 0))

  const pointDays = [0, 30, 60, 90]
  const points: CashFlowPoint[] = pointDays.map((offset) => {
    const date = addDays(referenceDate, offset)
    const inflow = inflowInWindow(offset)
    const outflow = outflowInWindow(offset)
    const liquidBalance = round((baseLiquidity ?? 0) + inflow - outflow)
    const overdueAtPoint = round(invoicesWithResidual.filter((item) => item.invoice.dueDate < date).reduce((sum, item) => sum + item.residual, 0))
    const expectedAtPoint = round(invoicesWithResidual.filter((item) => item.invoice.dueDate >= date).reduce((sum, item) => sum + item.residual, 0))
    return {
      label: offset === 0 ? 'Oggi' : `+${offset}g`,
      date,
      liquidBalance,
      inflow,
      outflow,
      collected,
      overdue: overdueAtPoint,
      atRisk: round(Math.max(0, overdueAtPoint + expectedAtPoint * 0.15)),
    }
  })

  return {
    baseLiquidity,
    windows,
    collected,
    expected,
    overdue,
    atRisk,
    points,
  }
}

const inPeriod = (value: string, period: NonNullable<CreditFilter['period']>, referenceDate: string) => {
  if (period === 'oggi') return value === referenceDate
  if (period === 'settimana') return value >= addDays(referenceDate, -6) && value <= referenceDate
  if (period === 'mese') return value.slice(0, 7) === referenceDate.slice(0, 7)
  return value.slice(0, 4) === referenceDate.slice(0, 4)
}

export function calculateCreditControl(data: ErpData, filter: CreditFilter = {}, referenceDate = todayKey()): CreditControlRow[] {
  const rows = data.customers.map((customer) => {
    const invoices = data.invoices.filter((invoice) => invoice.customerId === customer.id && invoice.status !== 'Stornata')
    const open = invoices.filter((invoice) => !['Incassata', 'Stornata'].includes(invoice.status))
    const openCredit = round(open.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0))
    const overdueCredit = round(open.filter((invoice) => invoice.dueDate < referenceDate).reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0))
    const paid = invoices.filter((invoice) => Math.max(0, invoice.total - invoice.collectedAmount) <= 0)
    const collectionDays = paid.map((invoice) => Math.max(0, diffDays(invoice.issueDate, invoice.updatedAt.slice(0, 10))))
    const averageCollectionDays = collectionDays.length ? Math.round(collectionDays.reduce((sum, days) => sum + days, 0) / collectionDays.length) : 0
    const critical = overdueCredit > 0 || averageCollectionDays > 45 || invoices.some((invoice) => invoice.status === 'Insoluta')
    return {
      customerId: customer.id,
      customerName: customer.name,
      openCredit,
      overdueCredit,
      averageCollectionDays,
      critical,
      openInvoices: open.length,
    }
  }).filter((row) => row.openCredit > 0 || row.overdueCredit > 0)

  const byCustomer = filter.customerId ? rows.filter((row) => row.customerId === filter.customerId) : rows
  const byState = filter.state === 'critical' ? byCustomer.filter((row) => row.critical) : filter.state === 'regular' ? byCustomer.filter((row) => !row.critical) : byCustomer
  if (!filter.period) return byState.sort((a, b) => b.overdueCredit - a.overdueCredit || b.openCredit - a.openCredit)

  return byState.filter((row) => {
    const customerInvoices = data.invoices.filter((invoice) => invoice.customerId === row.customerId)
    return customerInvoices.some((invoice) => inPeriod(invoice.issueDate, filter.period!, referenceDate))
  }).sort((a, b) => b.overdueCredit - a.overdueCredit || b.openCredit - a.openCredit)
}

const calendarStatus = (date: string, referenceDate: string): CalendarEvent['status'] => {
  const diff = diffDays(referenceDate, date)
  if (diff < 0) return 'scaduto'
  if (diff === 0) return 'oggi'
  if (diff <= 7) return 'imminente'
  return 'futuro'
}

export function buildCalendarEvents(data: ErpData, referenceDate = todayKey(), view: 'giorno' | 'settimana' | 'mese' = 'mese'): CalendarEvent[] {
  const limitDays = view === 'giorno' ? 0 : view === 'settimana' ? 7 : 31
  const endDate = addDays(referenceDate, limitDays)

  const events: CalendarEvent[] = []

  data.vehicles
    .filter((vehicle) => vehicle.requestedDeliveryDate && vehicle.requestedDeliveryDate >= referenceDate && vehicle.requestedDeliveryDate <= endDate)
    .forEach((vehicle) => {
      events.push({
        id: `delivery-${vehicle.id}-${vehicle.requestedDeliveryDate}`,
        type: 'delivery',
        title: `Consegna vettura ${vehicle.plate}`,
        date: vehicle.requestedDeliveryDate,
        status: calendarStatus(vehicle.requestedDeliveryDate, referenceDate),
        customerId: vehicle.customerId,
      })
    })

  data.invoices
    .filter((invoice) => invoice.dueDate >= referenceDate && invoice.dueDate <= endDate)
    .forEach((invoice) => {
      const residual = Math.max(0, invoice.total - invoice.collectedAmount)
      events.push({
        id: `invoice-${invoice.id}`,
        type: 'invoice-due',
        title: `Scadenza fattura ${invoice.number}`,
        date: invoice.dueDate,
        status: calendarStatus(invoice.dueDate, referenceDate),
        amount: round(residual),
        customerId: invoice.customerId,
      })
      events.push({
        id: `payment-${invoice.id}`,
        type: 'payment-expected',
        title: `Pagamento atteso ${invoice.number}`,
        date: invoice.dueDate,
        status: calendarStatus(invoice.dueDate, referenceDate),
        amount: round(residual),
        customerId: invoice.customerId,
      })
    })

  data.ribaBatches
    .filter((batch) => batch.dueDate >= referenceDate && batch.dueDate <= endDate)
    .forEach((batch) => {
      events.push({
        id: `riba-${batch.id}`,
        type: 'riba-due',
        title: `Scadenza R.I.B.A. ${batch.number}`,
        date: batch.dueDate,
        status: calendarStatus(batch.dueDate, referenceDate),
        amount: round(batch.total),
      })
    })

  ;(data.quotes ?? [])
    .filter((quote) => quote.status === 'inviato' && quote.dueDate >= referenceDate && quote.dueDate <= endDate)
    .forEach((quote) => {
      events.push({
        id: `response-${quote.id}`,
        type: 'response-needed',
        title: `Risposta richiesta per preventivo ${quote.number}`,
        date: quote.dueDate,
        status: calendarStatus(quote.dueDate, referenceDate),
        amount: quote.total,
        customerId: quote.customerId,
      })
    })

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
}
