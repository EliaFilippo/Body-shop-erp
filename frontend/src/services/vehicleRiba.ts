import type { ErpData } from '../types'
import { createRibaBatch, invoiceResidual, registerRibaAdvance } from './finance'
const round=(n:number)=>Math.round(n*100)/100
export function ribaVehicleOptions(data:ErpData){
 return data.invoices.filter(invoice=>!['Incassata','Stornata','Insoluta','Contestata'].includes(invoice.status)).flatMap(invoice=>{
  const available=invoiceResidual(invoice)
  if(available<=0)return []
  const weights=new Map<string,number>()
  for(const line of invoice.lines)if(line.vehicleId)weights.set(line.vehicleId,(weights.get(line.vehicleId)??0)+Math.max(0,line.total))
  if(!weights.size&&invoice.vehicleId)weights.set(invoice.vehicleId,invoice.total)
  const total=[...weights.values()].reduce((sum,n)=>sum+n,0)
  let assigned=0
  return [...weights].flatMap(([vehicleId,weight],index)=>{
   const vehicle=data.vehicles.find(item=>item.id===vehicleId)
   if(!vehicle)return []
   const amount=index===weights.size-1?round(available-assigned):round(available*weight/Math.max(.01,total))
   assigned=round(assigned+amount)
   return [{key:`${invoice.id}|${vehicleId}`,vehicleId,invoiceId:invoice.id,plate:vehicle.plate,invoiceNumber:invoice.number,customerName:data.customers.find(customer=>customer.id===invoice.customerId)?.name||'',amount}]
  })
 })
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
  if(!option||!Number.isFinite(selection.amount)||selection.amount<=0||round(selection.amount)>option.amount)throw new Error('Controlla gli importi delle vetture selezionate.')
  return {vehicleId:option.vehicleId,invoiceId:option.invoiceId,plate:option.plate,amount:round(selection.amount)}
 })
 const amounts=new Map<string,number>()
 for(const link of links)amounts.set(link.invoiceId,round((amounts.get(link.invoiceId)??0)+link.amount))
 let next=createRibaBatch(data,{number:input.number,bankAccountId:input.bankAccountId,presentationDate:input.presentationDate,dueDate:input.dueDate,collectionDate:input.collectionDate,vehicleLinks:links,allocations:[...amounts].map(([invoiceId,amount])=>({invoiceId,amount}))})
 if(input.mode==='advance'){
  const batch=next.ribaBatches[0]
  next=registerRibaAdvance(next,batch.id,input.advanceAmount??batch.total,input.advanceDate,input.fees,input.interest)
 }
 return next
}
