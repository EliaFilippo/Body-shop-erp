import type { ErpData } from '../types'
import { createRibaBatch, invoiceResidual, registerRibaAdvance, vehicleInvoiceTaxableAmount } from './finance'
const round=(n:number)=>Math.round(n*100)/100
function splitAmount(total: number, weights: number[]) {
 const sum = weights.reduce((result, weight) => result + weight, 0)
 if (sum <= 0) return weights.map(() => 0)
 let cumulative = 0
 let assigned = 0
 return weights.map(weight => {
  cumulative += weight
  const next = round(total * cumulative / sum)
  const amount = round(next - assigned)
  assigned = next
  return amount
 })
}
export function ribaVehicleOptions(data:ErpData){
 const billed = new Set(data.invoices.flatMap(invoice => [invoice.vehicleId, ...invoice.lines.map(line => line.vehicleId)]))
 const pending = new Set(data.ribaBatches.filter(batch => !['Insoluta', 'Stornata'].includes(batch.status))
  .flatMap(batch => (batch.pendingVehicleLinks ?? []).map(link => link.vehicleId)))
 const invoiced = data.invoices.filter(invoice=>!['Incassata','Stornata','Insoluta','Contestata'].includes(invoice.status)).flatMap(invoice=>{
  const available=invoiceResidual(invoice)
  if(available<=0)return []
  const weights=new Map<string,number>()
  for(const line of invoice.lines)if(line.vehicleId)weights.set(line.vehicleId,(weights.get(line.vehicleId)??0)+Math.max(0,line.total))
  if(!weights.size&&invoice.vehicleId)weights.set(invoice.vehicleId,invoice.total)
  const vehicles = [...weights]
  const shares = splitAmount(invoice.total, vehicles.map(([, weight]) => weight))
  const linkedAmounts = new Map<string, number>()
  for (const batch of data.ribaBatches) {
   if (batch.status === 'Insoluta' || batch.status === 'Stornata') continue
   for (const link of batch.vehicleLinks ?? []) {
    if (link.invoiceId !== invoice.id) continue
    linkedAmounts.set(link.vehicleId, (linkedAmounts.get(link.vehicleId) ?? 0) + link.amount)
   }
  }
  const remainingShares = vehicles.map(([vehicleId], index) => Math.max(0, round(shares[index] - (linkedAmounts.get(vehicleId) ?? 0))))
  const amounts = splitAmount(Math.min(available, remainingShares.reduce((sum, amount) => sum + amount, 0)), remainingShares)
  return vehicles.flatMap(([vehicleId], index) => {
   const vehicle = data.vehicles.find(item => item.id === vehicleId)
   const amount = amounts[index]
   if (!vehicle || amount <= 0) return []
   return [{key:`${invoice.id}|${vehicleId}`,vehicleId,invoiceId:invoice.id,plate:vehicle.plate,invoiceNumber:invoice.number,customerName:data.customers.find(customer=>customer.id===invoice.customerId)?.name||'',amount}]
  })
 })
 const unbilled = data.vehicles.filter(vehicle => !billed.has(vehicle.id) && !pending.has(vehicle.id)
  && !vehicle.invoiceId && vehicle.billingStatus !== 'Fatturata').map(vehicle => {
   const taxable = vehicleInvoiceTaxableAmount(data, vehicle)
   const amount = round((taxable ?? 0) * (1 + data.financeSettings.defaultVatRate / 100))
   return {key:`vehicle|${vehicle.id}`,vehicleId:vehicle.id,invoiceId:null,plate:vehicle.plate,
    invoiceNumber:'In attesa di fattura',customerName:data.customers.find(customer=>customer.id===vehicle.customerId)?.name||'',amount}
  })
 return [...invoiced, ...unbilled]
}
export interface VehicleRibaInput {
 number:string;bankAccountId:string;presentationDate:string;dueDate:string;collectionDate:string
 selections:Array<{key:string;amount:number}>
 mode:'maturity'|'advance';advanceDate:string;advanceAmount?:number;fees:number;interest:number
}
export function createVehicleRiba(data:ErpData,input:VehicleRibaInput){
 const options=ribaVehicleOptions(data)
 const seen=new Set<string>()
 const links=input.selections.map(selection=>{
  if(seen.has(selection.key))throw new Error('Vettura selezionata due volte.')
  seen.add(selection.key)
  const option=options.find(row=>row.key===selection.key)
  if(!option||!Number.isFinite(selection.amount)||selection.amount<=0||(option.invoiceId && round(selection.amount)>option.amount))throw new Error('Controlla gli importi delle vetture selezionate.')
  return {vehicleId:option.vehicleId,invoiceId:option.invoiceId,plate:option.plate,amount:round(selection.amount)}
 })
 const pendingVehicleLinks = links.filter(link => link.invoiceId === null).map(({vehicleId,plate,amount}) => ({vehicleId,plate,amount}))
 const vehicleLinks = links.flatMap(link => link.invoiceId === null ? [] : [{...link,invoiceId:link.invoiceId}])
 const amounts=new Map<string,number>()
 for(const link of vehicleLinks)amounts.set(link.invoiceId,round((amounts.get(link.invoiceId)??0)+link.amount))
 let next=createRibaBatch(data,{number:input.number,bankAccountId:input.bankAccountId,presentationDate:input.presentationDate,dueDate:input.dueDate,collectionDate:input.collectionDate,vehicleLinks,pendingVehicleLinks,allocations:[...amounts].map(([invoiceId,amount])=>({invoiceId,amount}))})
 if(input.mode==='advance'){
  const batch=next.ribaBatches[0]
  next=registerRibaAdvance(next,batch.id,input.advanceAmount??batch.total,input.advanceDate,input.fees,input.interest)
 }
 return next
}
