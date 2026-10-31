import type {AcceptanceCase,ErpData} from '../types'
export interface PracticeQueueEntry {
 id:string;kind:'acceptance'|'estimate'|'quote';confirmed:boolean
 customerId:string;vehicleId?:string;plate:string;number:string;status:string;date:string;total?:number
 acceptance?:AcceptanceCase
}
/** Read-only index across intake and fast estimates; no records are synthesized or saved. */
export function practiceQueueEntries(data:ErpData):PracticeQueueEntry[]{
 const result:PracticeQueueEntry[]=[],seenEstimates=new Set<string>(),seenQuotes=new Set<string>()
 const estimates=data.estimates??[],quotes=data.quotes??[]
 const vehicleById=new Map(data.vehicles.map(v=>[v.id,v]))
 const estimateById=new Map(estimates.map(e=>[e.id,e]))
 const activeJobIds=new Set((data.jobs??[]).filter(j=>j.status!=='Annullata').map(j=>j.id))
 const byAcceptance=new Map<string,typeof quotes>(),byEstimate=new Map<string,typeof quotes>()
 for(const quote of quotes){
  if(quote.acceptanceId)byAcceptance.set(quote.acceptanceId,[...(byAcceptance.get(quote.acceptanceId)??[]),quote])
  if(quote.estimateId)byEstimate.set(quote.estimateId,[...(byEstimate.get(quote.estimateId)??[]),quote])
 }
 const quoteConfirmed=(q:typeof quotes[number])=>q.status==='accettato'
 const estimateConfirmed=(e:typeof estimates[number])=>e.status==='Approvato'||Boolean(e.convertedJobId&&activeJobIds.has(e.convertedJobId))
 for(const acceptance of data.acceptances??[]){
  const linked=byAcceptance.get(acceptance.id)??[]
  const linkedEstimates=[...new Set(linked.map(q=>q.estimateId))].flatMap(id=>id&&estimateById.has(id)?[estimateById.get(id)!]:[])
  linked.forEach(q=>seenQuotes.add(q.id));linkedEstimates.forEach(e=>seenEstimates.add(e.id))
  const confirmed=acceptance.status==='confirmed'||linked.some(quoteConfirmed)||linkedEstimates.some(estimateConfirmed)
  result.push({id:'acceptance:'+acceptance.id,kind:'acceptance',acceptance,confirmed,customerId:acceptance.customerId,vehicleId:acceptance.vehicleId,plate:vehicleById.get(acceptance.vehicleId)?.plate??'',number:'Scheda di accettazione',status:confirmed?'Confermata':'Bozza',date:acceptance.updatedAt||acceptance.createdAt})
 }
 for(const estimate of estimates){
  if(seenEstimates.has(estimate.id))continue
  const linked=byEstimate.get(estimate.id)??[]
  linked.forEach(q=>seenQuotes.add(q.id))
  if(['Rifiutato','Scaduto'].includes(estimate.status)&&!linked.some(quoteConfirmed))continue
  result.push({id:'estimate:'+estimate.id,kind:'estimate',confirmed:estimateConfirmed(estimate)||linked.some(quoteConfirmed),customerId:estimate.customerId,vehicleId:estimate.vehicleId,plate:estimate.plate,number:estimate.number,status:estimate.status,date:estimate.date,total:estimate.total})
 }
 for(const quote of quotes){
  if(seenQuotes.has(quote.id)||quote.status==='rifiutato')continue
  result.push({id:'quote:'+quote.id,kind:'quote',confirmed:quoteConfirmed(quote),customerId:quote.customerId,vehicleId:quote.vehicleId,plate:vehicleById.get(quote.vehicleId)?.plate??'',number:quote.number,status:quote.status==='accettato'?'Approvato':quote.status==='inviato'?'Inviato':'Bozza',date:quote.issueDate,total:quote.total})
 }
 return result.sort((a,b)=>b.date.localeCompare(a.date)||a.number.localeCompare(b.number))
}
