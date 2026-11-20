import type { ErpData, RibaBatch } from '../types'
import { invoiceResidual } from './finance'
import { ribaVehicleOptions } from './vehicleRiba'
const round = (value: number) => Math.round(value * 100) / 100
export function customerBatchAmount(data: ErpData, batch: RibaBatch, customerId: string) {
 const invoiced = batch.allocations.reduce((sum, allocation) => sum + (data.invoices.find(i => i.id === allocation.invoiceId)?.customerId === customerId ? allocation.amount : 0), 0)
 const pending = (batch.pendingVehicleLinks ?? []).reduce((sum, link) => sum + (data.vehicles.find(v => v.id === link.vehicleId)?.customerId === customerId ? link.amount : 0), 0)
 return round(invoiced + pending)
}
export function customerMonthlyFinance(data: ErpData, customerId: string, month: string) {
 const inMonth = (date?: string) => date?.slice(0, 7) === month
 const invoices = data.invoices.filter(i => i.customerId === customerId && i.status !== 'Stornata')
 const monthInvoices = invoices.filter(i => inMonth(i.issueDate))
 const options = ribaVehicleOptions(data).filter(o => {
  const vehicle = data.vehicles.find(v => v.id === o.vehicleId)
  if (vehicle?.customerId !== customerId) return false
  const invoice = data.invoices.find(i => i.id === o.invoiceId)
  return invoice ? invoice.paymentMethod === 'R.I.B.A.' && inMonth(invoice.issueDate) : inMonth(vehicle.createdAt)
 })
 const active = data.ribaBatches.filter(b => !['Stornata','Insoluta'].includes(b.status) && inMonth(b.presentationDate))
 const loaded = active.reduce((sum,b) => sum + customerBatchAmount(data,b,customerId), 0)
 const maturity = active.filter(b=>['Presentata','Anticipata'].includes(b.status)).reduce((sum,b)=>sum+customerBatchAmount(data,b,customerId)*(b.total > 0 ? Math.max(0,b.total-b.advancedAmount)/b.total : 0),0)
 const advance = active.filter(b=>b.status==='Anticipata').reduce((sum,b)=>sum+customerBatchAmount(data,b,customerId)*(b.total > 0 ? b.advancedAmount/b.total : 0),0)
 const paid = data.financialEvents.filter(e=>e.type==='Incasso definitivo' && inMonth(e.date)).reduce((sum,e)=>{
  if(e.ribaBatchId){const batch=data.ribaBatches.find(b=>b.id===e.ribaBatchId);return sum+(batch && batch.total > 0 ? e.amount*customerBatchAmount(data,batch,customerId)/batch.total : 0)}
  return sum + ((e.invoiceId ? invoices.some(i=>i.id===e.invoiceId) : e.customerId===customerId) ? e.amount : 0)
 },0)
 return { paidInvoices:round(monthInvoices.filter(i=>i.collectedAmount>=i.total).reduce((sum,i)=>sum+i.total,0)), toLoad:round(options.reduce((sum,o)=>sum+o.amount,0)), unpriced: options.filter(o=>o.amount<=0).length, loaded:round(loaded), maturity:round(maturity), advance:round(advance), unpaid:round(monthInvoices.reduce((sum,i)=>sum+Math.max(0,i.total-i.collectedAmount),0)), paid:round(paid), invoiceTotal:round(monthInvoices.reduce((sum,i)=>sum+i.total,0)), available:options.length, residual:round(monthInvoices.reduce((sum,i)=>sum+invoiceResidual(i),0)) }
}
