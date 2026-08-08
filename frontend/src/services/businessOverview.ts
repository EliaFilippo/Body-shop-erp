import type { Customer, ErpData, Invoice, Vehicle } from '../types'

export type BusinessOverviewPeriod = 'oggi' | 'settimana' | 'mese' | 'anno'

export interface BusinessOverviewPoint {
  label: string
  revenue: number
  cost: number
  margin: number
}

export interface BusinessOverviewSnapshot {
  period: BusinessOverviewPeriod
  hasData: boolean
  points: BusinessOverviewPoint[]
  current: { revenue: number; cost: number; margin: number; expectedCollections: number; deliveredVehicles: number; lateVehicles: number }
  previous: { revenue: number; cost: number; margin: number; expectedCollections: number; deliveredVehicles: number; lateVehicles: number }
  objective: number
}

export interface CustomerRankingEntry {
  customerId: string
  customerName: string
  customerType: Customer['type']
  revenue: number
  margin: number
  averageJobValue: number
  vehicleCount: number
}

interface DateRange { start: string; end: string }

const round = (value: number) => Math.round(value * 100) / 100
const startOfDay = (value: string) => value.slice(0, 10)

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`)

const getRange = (period: BusinessOverviewPeriod, referenceDate: string): DateRange => {
  const day = startOfDay(referenceDate)
  const [year, month, date] = day.split('-').map(Number)
  const base = new Date(Date.UTC(year, month - 1, date))
  switch (period) {
    case 'oggi':
      return { start: day, end: day }
    case 'settimana': {
      const start = new Date(base)
      const dayOfWeek = start.getUTCDay() || 7
      start.setUTCDate(base.getUTCDate() - (dayOfWeek - 1))
      const end = new Date(start)
      end.setUTCDate(start.getUTCDate() + 6)
      return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
    }
    case 'mese': {
      return { start: `${year}-${String(month).padStart(2, '0')}-01`, end: `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}` }
    }
    case 'anno': {
      return { start: `${year}-01-01`, end: `${year}-12-31` }
    }
  }
}

const getPreviousRange = (period: BusinessOverviewPeriod, currentRange: DateRange): DateRange => {
  const currentStart = toDate(currentRange.start)
  const currentEnd = toDate(currentRange.end)
  void currentEnd
  switch (period) {
    case 'oggi': {
      const previousStart = new Date(currentStart)
      previousStart.setUTCDate(previousStart.getUTCDate() - 1)
      return { start: previousStart.toISOString().slice(0, 10), end: previousStart.toISOString().slice(0, 10) }
    }
    case 'settimana': {
      const previousEnd = new Date(currentStart)
      previousEnd.setUTCDate(previousEnd.getUTCDate() - 1)
      const previousStart = new Date(previousEnd)
      previousStart.setUTCDate(previousStart.getUTCDate() - 6)
      return { start: previousStart.toISOString().slice(0, 10), end: previousEnd.toISOString().slice(0, 10) }
    }
    case 'mese': {
      const [year, month] = currentRange.start.split('-').map(Number)
      const previousMonth = month === 1 ? 12 : month - 1
      const previousYear = month === 1 ? year - 1 : year
      const lastDay = new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate()
      return { start: `${previousYear}-${String(previousMonth).padStart(2, '0')}-01`, end: `${previousYear}-${String(previousMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` }
    }
    case 'anno': {
      const year = Number(currentRange.start.slice(0, 4)) - 1
      return { start: `${year}-01-01`, end: `${year}-12-31` }
    }
  }
}

const buildBuckets = (period: BusinessOverviewPeriod, range: DateRange): Array<{ label: string; start: string; end: string }> => {
  const start = toDate(range.start)
  const end = toDate(range.end)
  switch (period) {
    case 'oggi': {
      const buckets = [] as Array<{ label: string; start: string; end: string }>
      const startHour = 0
      for (let index = 0; index < 4; index += 1) {
        const bucketStart = new Date(start)
        bucketStart.setUTCHours(startHour + index * 6)
        const bucketEnd = new Date(start)
        bucketEnd.setUTCHours(startHour + (index + 1) * 6)
        buckets.push({ label: `${String(index * 6).padStart(2, '0')}-${String((index + 1) * 6).padStart(2, '0')}`, start: bucketStart.toISOString().slice(0, 10), end: bucketEnd.toISOString().slice(0, 10) })
      }
      return buckets
    }
    case 'settimana': {
      const buckets = [] as Array<{ label: string; start: string; end: string }>
      const current = new Date(start)
      while (current <= end) {
        buckets.push({ label: current.toISOString().slice(5, 10), start: current.toISOString().slice(0, 10), end: current.toISOString().slice(0, 10) })
        current.setUTCDate(current.getUTCDate() + 1)
      }
      return buckets
    }
    case 'mese': {
      const buckets = [] as Array<{ label: string; start: string; end: string }>
      const current = new Date(start)
      while (current <= end) {
        buckets.push({ label: current.toISOString().slice(8, 10), start: current.toISOString().slice(0, 10), end: current.toISOString().slice(0, 10) })
        current.setUTCDate(current.getUTCDate() + 1)
      }
      return buckets
    }
    case 'anno': {
      const buckets = [] as Array<{ label: string; start: string; end: string }>
      const baseStart = new Date(Date.UTC(Number(range.start.slice(0, 4)), 0, 1))
      for (let month = 0; month < 12; month += 1) {
        const bucketStart = new Date(baseStart)
        bucketStart.setUTCMonth(month)
        const bucketEnd = new Date(bucketStart)
        bucketEnd.setUTCMonth(month + 1)
        bucketEnd.setUTCDate(0)
        if (bucketEnd < start || bucketStart > end) continue
        buckets.push({ label: bucketStart.toLocaleString('it-IT', { month: 'short' }), start: bucketStart.toISOString().slice(0, 10), end: bucketEnd.toISOString().slice(0, 10) })
      }
      return buckets
    }
  }
}

const withinRange = (value: string, range: DateRange) => {
  if (!value) return false
  return value >= range.start && value <= range.end
}

const summarizeBucket = (invoices: Invoice[], vehicles: Vehicle[], range: DateRange) => {
  const revenue = invoices.reduce((sum, invoice) => sum + invoice.total, 0)
  const cost = vehicles.reduce((sum, vehicle) => {
    const vehicleCost = (vehicle.costEntries ?? []).reduce((entrySum, entry) => {
      const usedAt = entry.usedAt?.slice(0, 10)
      return entrySum + (usedAt && withinRange(usedAt, range) ? (entry.total || 0) : 0)
    }, 0)
    return sum + vehicleCost
  }, 0)
  const margin = revenue - cost
  const expectedCollections = invoices.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0)
  const deliveredVehicles = vehicles.filter((vehicle) => vehicle.deliveredAt?.slice(0, 10) && withinRange(vehicle.deliveredAt.slice(0, 10), range)).length
  const lateVehicles = vehicles.filter((vehicle) => vehicle.requestedDeliveryDate && vehicle.requestedDeliveryDate < startOfDay(new Date().toISOString().slice(0, 10)) && vehicle.status !== 'consegnata' && vehicle.status !== 'Consegnata').length
  return { revenue: round(revenue), cost: round(cost), margin: round(margin), expectedCollections: round(expectedCollections), deliveredVehicles, lateVehicles }
}

const summarizeRange = (invoices: Invoice[], vehicles: Vehicle[], range: DateRange) => {
  const buckets = buildBuckets('mese', range)
  const totals = buckets.reduce((sum, bucket) => {
    const bucketInvoices = invoices.filter((invoice) => withinRange(invoice.issueDate, bucket))
    const bucketVehicles = vehicles.filter((vehicle) => {
      const hasCost = (vehicle.costEntries ?? []).some((entry) => withinRange(entry.usedAt?.slice(0, 10) || '', bucket))
      const delivered = vehicle.deliveredAt?.slice(0, 10) && withinRange(vehicle.deliveredAt.slice(0, 10), bucket)
      const requested = vehicle.requestedDeliveryDate && withinRange(vehicle.requestedDeliveryDate, bucket)
      return hasCost || delivered || requested
    })
    const bucketSummary = summarizeBucket(bucketInvoices, bucketVehicles, bucket)
    return {
      revenue: sum.revenue + bucketSummary.revenue,
      cost: sum.cost + bucketSummary.cost,
      margin: sum.margin + bucketSummary.margin,
      expectedCollections: sum.expectedCollections + bucketSummary.expectedCollections,
      deliveredVehicles: sum.deliveredVehicles + bucketSummary.deliveredVehicles,
      lateVehicles: sum.lateVehicles + bucketSummary.lateVehicles,
    }
  }, { revenue: 0, cost: 0, margin: 0, expectedCollections: 0, deliveredVehicles: 0, lateVehicles: 0 })
  return {
    ...totals,
    revenue: round(totals.revenue),
    cost: round(totals.cost),
    margin: round(totals.margin),
    expectedCollections: round(totals.expectedCollections),
  }
}

export function calculateBusinessOverviewSnapshot(data: ErpData, period: BusinessOverviewPeriod, referenceDate = new Date().toISOString().slice(0, 10)): BusinessOverviewSnapshot {
  const currentRange = getRange(period, referenceDate)
  const previousRange = getPreviousRange(period, currentRange)
  const currentBuckets = buildBuckets(period, currentRange)

  const currentPoints = currentBuckets.map((bucket) => {
    const bucketInvoices = data.invoices.filter((invoice) => withinRange(invoice.issueDate, bucket))
    const bucketVehicles = data.vehicles.filter((vehicle) => {
      const hasCost = (vehicle.costEntries ?? []).some((entry) => withinRange(entry.usedAt?.slice(0, 10) || '', bucket))
      const delivered = vehicle.deliveredAt?.slice(0, 10) && withinRange(vehicle.deliveredAt.slice(0, 10), bucket)
      const requested = vehicle.requestedDeliveryDate && withinRange(vehicle.requestedDeliveryDate, bucket)
      return hasCost || delivered || requested
    })
    const summary = summarizeBucket(bucketInvoices, bucketVehicles, bucket)
    return { label: bucket.label, revenue: summary.revenue, cost: summary.cost, margin: summary.margin }
  }).filter((point) => point.revenue > 0 || point.cost > 0 || point.margin > 0)

  const currentSummary = summarizeRange(data.invoices, data.vehicles, currentRange)
  const previousSummary = summarizeRange(data.invoices, data.vehicles, previousRange)

  return {
    period,
    hasData: currentPoints.length > 0 || currentSummary.revenue > 0 || currentSummary.cost > 0,
    points: currentPoints,
    current: currentSummary,
    previous: previousSummary,
    objective: data.plannerSettings.monthlyRevenueGoal || 0,
  }
}

export function calculateCustomerRankingSnapshot(data: ErpData, period: BusinessOverviewPeriod, referenceDate = new Date().toISOString().slice(0, 10)): CustomerRankingEntry[] {
  const range = getRange(period, referenceDate)
  const customerMap = new Map<string, CustomerRankingEntry>()

  data.customers.forEach((customer) => {
    customerMap.set(customer.id, {
      customerId: customer.id,
      customerName: customer.name,
      customerType: customer.type,
      revenue: 0,
      margin: 0,
      averageJobValue: 0,
      vehicleCount: 0,
    })
  })

  data.vehicles.forEach((vehicle) => {
    const customer = customerMap.get(vehicle.customerId)
    if (!customer) return
    const vehicleInvoices = data.invoices.filter((invoice) => invoice.customerId === customer.customerId && withinRange(invoice.issueDate, range))
    const revenue = vehicleInvoices.reduce((sum, invoice) => sum + invoice.total, 0)
    const cost = (vehicle.costEntries ?? []).reduce((sum, entry) => sum + (entry.total || 0), 0)
    const margin = revenue - cost
    customer.revenue += revenue
    customer.margin += margin
    customer.vehicleCount += 1
  })

  const ranking = Array.from(customerMap.values()).map((entry) => ({
    ...entry,
    averageJobValue: entry.vehicleCount ? round(entry.revenue / entry.vehicleCount) : 0,
  })).sort((left, right) => right.revenue - left.revenue || right.margin - left.margin || right.vehicleCount - left.vehicleCount)

  return ranking
}
