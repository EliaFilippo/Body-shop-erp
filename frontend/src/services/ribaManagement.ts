import type { ErpData } from '../types'
import { ribaVehicleOptions } from './vehicleRiba'
export function ribaCustomerIds(data: ErpData) {
 const ids=new Set<string>()
 for(const option of ribaVehicleOptions(data)) {
  if(option.invoiceId && data.invoices.find(i=>i.id===option.invoiceId)?.paymentMethod!=='R.I.B.A.')continue
  const customerId=data.vehicles.find(v=>v.id===option.vehicleId)?.customerId
  if(customerId)ids.add(customerId)
 }
 for(const batch of data.ribaBatches){
  if(['Stornata','Insoluta'].includes(batch.status))continue
  for(const link of [...(batch.vehicleLinks??[]),...(batch.pendingVehicleLinks??[])]){const customerId=data.vehicles.find(v=>v.id===link.vehicleId)?.customerId;if(customerId)ids.add(customerId)}
  for(const allocation of batch.allocations){const customerId=data.invoices.find(i=>i.id===allocation.invoiceId)?.customerId;if(customerId)ids.add(customerId)}
 }
 return ids
}
export function setRibaInvoiceReference(data:ErpData,batchId:string,vehicleId:string,number:string):ErpData {
 const batch=data.ribaBatches.find(b=>b.id===batchId)
 if(!batch || ['Stornata','Insoluta'].includes(batch.status))throw new Error('RiBa non disponibile.')
 const linked=[...(batch.vehicleLinks??[]),...(batch.pendingVehicleLinks??[])].some(l=>l.vehicleId===vehicleId) || batch.allocations.some(a=>data.invoices.some(i=>i.id===a.invoiceId&&(i.vehicleId===vehicleId||i.lines.some(l=>l.vehicleId===vehicleId))))
 if(!linked)throw new Error('Vettura non collegata alla distinta.')
 const references=(batch.invoiceReferences??[]).filter(r=>r.vehicleId!==vehicleId)
 if(number.trim())references.push({vehicleId,number:number.trim()})
 return {...data,ribaBatches:data.ribaBatches.map(b=>b.id===batchId?{...b,invoiceReferences:references,updatedAt:new Date().toISOString()}:b)}
}
