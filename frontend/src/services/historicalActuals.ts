import type { ErpData, HistoricalActual, Invoice } from '../types'
import type { DailyProductionWork } from './productionPlanningState'

const documentKey = (date: string, reference: string) => date.slice(0, 4) + ':' + (reference ?? '').trim().toLocaleLowerCase('it-IT').replace(/\s+/g, '')
type MoneyActual = Extract<HistoricalActual, {amount: number}>
const workKey = (row: { date: string; operatorId: string }) => row.date + ':' + row.operatorId

export function isRealizedInvoice(invoice: Invoice) {
  return invoice.documentStatus !== 'bozza' && invoice.status !== 'Stornata'
}

export function historicalRevenues(data: ErpData) {
  const invoiced = new Set(data.invoices.filter(isRealizedInvoice).map(invoice => documentKey(invoice.issueDate, invoice.number)))
  return (data.historicalActuals ?? []).filter((row): row is MoneyActual => row.kind === 'revenue' && !invoiced.has(documentKey(row.date, row.reference)))
}

export function historicalCosts(data: ErpData) {
  const posted = new Set(data.vehicles.flatMap(vehicle => (vehicle.costEntries ?? [])
    .filter(cost => cost.documentNo).map(cost => documentKey(cost.usedAt, cost.documentNo!))))
  return (data.historicalActuals ?? []).filter((row): row is MoneyActual => row.kind === 'cost' && !posted.has(documentKey(row.date, row.reference)))
}

export function withHistoricalHours(data: ErpData, tablet: DailyProductionWork[]) {
  const occupied = new Set(tablet.filter(row => row.paidSeconds > 0 || row.productiveSeconds > 0).map(workKey))
  const historical: DailyProductionWork[] = []
  for (const row of data.historicalActuals ?? []) {
    if (row.kind !== 'hours' || occupied.has(workKey(row))) continue
    occupied.add(workKey(row))
    historical.push(row)
  }
  return [...tablet, ...historical]
}

export function historicalActualIssue(data: ErpData, row: HistoricalActual, otherRows: HistoricalActual[], tablet: DailyProductionWork[], today: string) {
  const date = new Date(row.date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== row.date || row.date > today) return 'Scegli oggi o una data passata.'
  const existing = [...(data.historicalActuals ?? []), ...otherRows].filter(item => item.id !== row.id)
  if (row.kind === 'hours') {
    if (!data.plannerSettings.operators.some(operator => operator.id === row.operatorId)) return 'Scegli un operatore.'
    if (!Number.isFinite(row.paidSeconds) || row.paidSeconds <= 0 || row.paidSeconds > 86400 || !Number.isFinite(row.productiveSeconds) || row.productiveSeconds < 0 || row.productiveSeconds > row.paidSeconds) return 'Indica fino a 24 ore pagate e ore produttive comprese nelle ore pagate.'
    if (tablet.some(item => workKey(item) === workKey(row) && (item.paidSeconds > 0 || item.productiveSeconds > 0))) return 'Per questo operatore e giorno ci sono già ore dei tablet.'
    if (existing.some(item => item.kind === 'hours' && workKey(item) === workKey(row))) return 'Esiste già un consuntivo per questo operatore e giorno.'
    return ''
  }
  if (!row.reference.trim() || !row.category.trim() || !Number.isFinite(row.amount) || row.amount <= 0) return 'Inserisci riferimento, descrizione e imponibile positivo.'
  const key = documentKey(row.date, row.reference)
  if (existing.some(item => item.kind !== 'hours' && item.kind === row.kind && documentKey(item.date, item.reference) === key)) return 'Riferimento già presente nei consuntivi dello stesso anno.'
  if (row.kind === 'revenue' && data.invoices.some(invoice => isRealizedInvoice(invoice) && documentKey(invoice.issueDate, invoice.number) === key)) return 'Fattura già registrata in Finance.'
  if (row.kind === 'cost' && !historicalCosts({...data, historicalActuals: [row]}).length) return 'Il documento è già registrato tra i costi vettura.'
  return ''
}
