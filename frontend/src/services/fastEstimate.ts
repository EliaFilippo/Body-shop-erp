import { toRomePlanningClock } from './romePlanningClock'
import { StationAvailabilityError } from './paintStations'
import { expectedPaymentDate } from './paymentTerms'
import type { AcceptanceQuote, ErpData, EstimateDocument, EstimateLine, EstimatePaymentTerms } from '../types'
import { addVehicle, createCustomer, normalizePlate } from './erp'
import { acceptanceEstimateLines, damageQuoteError } from './damageQuote'
import { approveEstimateAndCreateJob, createEstimate, updateEstimate } from './workflow'
import { createQuoteDocument } from './documents'
import { recalculateOperatorPrograms, simulateEstimateProductionForecast } from './planner'

export interface FastEstimateInput {
 estimateId?:string
 plate:string
 customerId?:string
 newCustomer?:{name:string;phone:string}
 quote:AcceptanceQuote
 paymentTerms?:EstimatePaymentTerms
 confirmed:boolean
 presentInShop?:boolean
 requestedDeliveryDate?:string
 planningPrecedence?:boolean
 notes?:string
}
export function isFastEstimateDraft(data:ErpData, estimate:EstimateDocument) {
 return estimate.status==='Bozza' && !estimate.convertedJobId && (
  estimate.source==='fast' ||
  (Boolean(estimate.productionForecast) && data.quotes?.some(quote=>quote.estimateId===estimate.id)
   && estimate.lines.length>0
   && estimate.lines.every(line=>line.manualFastLine || line.standardWorkId?.startsWith('elias-listino:')))
 )
}

/** Creates one complete snapshot; validation failures never persist half a customer/vehicle. */
export function createFastEstimate(data:ErpData,input:FastEstimateInput,at=new Date(),livePrograms?:ErpData['operatorPrograms']):ErpData {
 const current=data.estimates?.find(estimate=>estimate.id===input.estimateId)
 if(input.estimateId && (!current || !isFastEstimateDraft(data,current)))throw new Error('La bozza fast non è più modificabile.')
 const plate=normalizePlate(input.plate)
 if(current && plate!==normalizePlate(current.plate))throw new Error('La bozza conserva la targa originale.')
 if(plate.length<5)throw new Error('Inserisci una targa valida.')
 const error=damageQuoteError(input.quote.damageLines||[])
 if(error)throw new Error(error)
 if((data.jobs||[]).some(j=>normalizePlate(j.plate)===plate&&!['Consegnata','Annullata'].includes(j.status)))throw new Error('Esiste già una commessa aperta per questa targa. Aprila da Preventivi / Commesse.')
 if((data.estimates||[]).some(e=>e.id!==input.estimateId&&normalizePlate(e.plate)===plate&&!e.convertedJobId&&!['Rifiutato','Scaduto'].includes(e.status)))throw new Error('Esiste già un preventivo aperto per questa targa. Aprilo da Preventivi / Commesse.')
 let next=data
 let vehicle=next.vehicles.find(v=>normalizePlate(v.plate)===plate)
 let customer=next.customers.find(c=>c.id===(vehicle?.customerId||input.customerId))
 if(vehicle&&input.customerId&&input.customerId!==vehicle.customerId)throw new Error('La vettura appartiene a un altro cliente: verifica l’anagrafica.')
 if(!customer&&input.newCustomer){
  const created=createCustomer({name:input.newCustomer.name,phone:input.newCustomer.phone,type:'Privato',email:'',taxId:'',address:''})
  customer=next.customers.find(c=>c.name.trim().toLowerCase()===created.name.toLowerCase()&&c.phone.replace(/\D/g,'')===created.phone.replace(/\D/g,''))||created
  if(!next.customers.some(c=>c.id===customer!.id))next={...next,customers:[customer,...next.customers]}
 }
 if(!customer)throw new Error('Scegli il cliente o inserisci nome e telefono.')
 if(!vehicle){
  next=addVehicle(next,{customerId:customer.id,presentInShop:input.presentInShop,plate,make:'',model:'',color:'',year:'',vin:'',mileage:'',status:'',estimatedHours:0,workedHours:0,plannedEntryDate:'',requestedDeliveryDate:input.requestedDeliveryDate||'',calculatedDeliveryDate:'',expectedRevenue:0,expectedMargin:0,partsStatus:'Disponibili',blockReason:'',manualPlanningDate:'',notes:'Creata da Preventivo fast.'})
  vehicle=next.vehicles[0]
 }
 const lines=acceptanceEstimateLines(input.quote,next.plannerSettings)
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(at)
 const selectedPhases=input.quote.selectedPhases??[]
 const planningPrecedence=Boolean(input.requestedDeliveryDate?.trim()&&input.planningPrecedence)
 let productionForecast: ReturnType<typeof simulateEstimateProductionForecast> | undefined
 try {
  productionForecast=simulateEstimateProductionForecast(livePrograms?{...next,operatorPrograms:livePrograms}:next,{vehicleId:vehicle.id,plate,lines:lines as EstimateLine[],selectedPhases,priority:current?.priority,planningPrecedence,requestedDeliveryDate:input.requestedDeliveryDate,referenceAt:toRomePlanningClock(at.toISOString())})
 } catch (error) {
  if (!(error instanceof StationAvailabilityError)) throw error
 }
 const fields={presentInShop:input.presentInShop??current?.presentInShop,customerId:customer.id,vehicleId:vehicle.id,plate,companyName:customer.name,contactName:customer.name,date:current?.date??today,planningPrecedence,requestedDeliveryDate:input.requestedDeliveryDate||'',notes:input.notes||'',lines,selectedPhases,productionForecast,paymentTerms:input.paymentTerms?{...input.paymentTerms,expectedCollectionDate:expectedPaymentDate(input.paymentTerms,input.requestedDeliveryDate)}:undefined}
 next=current ? updateEstimate(next,current.id,{...fields,source:'fast',lines:lines as EstimateLine[]}) : createEstimate(next,fields)
 const estimate=current ? next.estimates!.find(item=>item.id===current.id)! : {...next.estimates![0],source:'fast' as const}
 if(!current)next={...next,estimates:[estimate,...next.estimates!.slice(1)]}
 if(!current)next=createQuoteDocument(next,{customerId:customer.id,vehicleId:vehicle.id,estimateId:estimate.id,paymentTerms:estimate.paymentTerms,status:'bozza',notes:input.notes||'',lines:estimate.lines.map(line=>({description:line.description,quantity:line.quantity,unitPrice:line.unitPrice,vatRate:line.vatRate,discountRate:line.quantity * line.unitPrice > 0 ? line.discount / (line.quantity * line.unitPrice) * 100 : 0}))})
 if(input.confirmed){
  next=approveEstimateAndCreateJob(next,estimate.id)
  try {
   next=recalculateOperatorPrograms(next,today,'Preventivo fast confermato')
  } catch (error) {
   if (!(error instanceof StationAvailabilityError)) throw error
  }
 }
 return next
}
