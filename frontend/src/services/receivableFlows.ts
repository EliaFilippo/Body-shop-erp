import type { ErpData } from '../types'
import { expectedPaymentDate } from './paymentTerms'
const round=(amount:number)=>Math.round(amount*100)/100
export function confirmedQuoteForecasts(data: ErpData) {
  const invoices = data.invoices.filter(invoice => invoice.status !== 'Stornata')
  const estimates = (data.estimates ?? []).filter(estimate => estimate.status === 'Approvato' && estimate.paymentTerms && Boolean(expectedPaymentDate(estimate.paymentTerms,estimate.requestedDeliveryDate)))
    .filter(estimate => {
      const job = (data.jobs ?? []).find(item => item.estimateId === estimate.id)
      if (job?.status === 'Annullata') return false
      const vehicleId = job?.vehicleId ?? estimate.vehicleId
      const linkedQuoteIds = (data.quotes ?? []).filter(quote => quote.estimateId === estimate.id).map(quote => quote.id)
      return !invoices.some(invoice => invoice.quoteId === estimate.id || linkedQuoteIds.includes(invoice.quoteId ?? '') || (vehicleId && (invoice.vehicleId === vehicleId || invoice.lines.some(line => line.vehicleId === vehicleId))))
        && !data.vehicles.some(vehicle => vehicle.id === vehicleId && Boolean(vehicle.invoiceId))
    })
  const quotes = (data.quotes ?? []).filter(quote => quote.status === 'accettato' && !quote.invoiceId && quote.paymentTerms && Boolean(expectedPaymentDate(quote.paymentTerms,data.vehicles.find(vehicle=>vehicle.id===quote.vehicleId)?.requestedDeliveryDate)))
    .filter(quote => !estimates.some(estimate => estimate.id === quote.estimateId) && !invoices.some(invoice => invoice.quoteId === quote.id || invoice.vehicleId === quote.vehicleId || invoice.lines.some(line => line.vehicleId === quote.vehicleId)))
  return [...estimates, ...quotes].map(document => ({ amount: document.total, dueDate: expectedPaymentDate(document.paymentTerms,('requestedDeliveryDate' in document?document.requestedDeliveryDate:undefined)||data.vehicles.find(vehicle=>vehicle.id===document.vehicleId)?.requestedDeliveryDate) }))
}


export function receivableFlows(data:ErpData){
 const active=data.ribaBatches.filter(batch=>['Presentata','Anticipata'].includes(batch.status))
 const invoices=data.invoices.filter(invoice=>!['Incassata','Stornata','Insoluta','Contestata'].includes(invoice.status)).map(invoice=>{
  const assigned=active.reduce((sum,batch)=>sum+batch.allocations.filter(item=>item.invoiceId===invoice.id).reduce((value,item)=>value+item.amount,0),0)
  return {dueDate:invoice.dueDate,amount:round(Math.max(0,invoice.total-invoice.collectedAmount-Math.max(invoice.ribaAllocatedAmount,assigned))),kind:'invoice' as const}
 })
 const batches=active.map(batch=>({dueDate:batch.collectionDate||batch.dueDate,amount:round(Math.max(0,batch.total-batch.advancedAmount)),kind:'riba' as const}))
 return [...invoices,...batches,...confirmedQuoteForecasts(data).map(item=>({...item,kind:'forecast' as const}))].filter(item=>item.amount>0&&Boolean(item.dueDate))
}
export function ribaDueAlerts(data:ErpData,referenceDate:string){
 const limit=new Date(`${referenceDate}T12:00:00Z`);limit.setUTCDate(limit.getUTCDate()+15)
 return data.ribaBatches.filter(batch=>['Presentata','Anticipata'].includes(batch.status)&&batch.dueDate<=limit.toISOString().slice(0,10)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate))
}
