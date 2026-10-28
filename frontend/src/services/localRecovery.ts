import type { ErpData } from '../types'
import { normalizePlate } from './erp'
export const protectedCollections = ['customers','vehicles','estimates','jobs','acceptances','quotes','invoices','payables','financialEvents','bankAccounts','ribaBatches'] as const
export const recoverableCollections = ['customers','vehicles','estimates','jobs','acceptances','quotes'] as const
export function missingRecordCounts(source: ErpData, target: ErpData) {
 return Object.fromEntries(protectedCollections.map(key => {
  const ids = new Set((target[key] ?? []).map(row => row.id))
  return [key,(source[key] ?? []).filter(row => !ids.has(row.id)).length]
 })) as Record<typeof protectedCollections[number],number>
}
export function assertCloudPreservesLocalRecords(local: ErpData,remote: ErpData) {
 if(Object.values(missingRecordCounts(local,remote)).some(Boolean))throw new Error('Sincronizzazione sospesa: sul dispositivo ci sono inserimenti assenti dal cloud. I dati locali sono conservati. Usa Recupero inserimenti locali per verificarli prima di continuare.')
}
/** Explicit additive recovery: existing cloud records, settings and timers win. */
export function recoverMissingBusinessRecords(current: ErpData,source: ErpData): ErpData {
 const result=structuredClone(current)
 for(const key of recoverableCollections){const ids=new Set((current[key]??[]).map(row=>row.id));Object.assign(result,{[key]:[...(current[key]??[]),...structuredClone((source[key]??[]).filter(row=>!ids.has(row.id)))]})}
 const plates=new Set<string>();const cones=new Set(current.vehicles.flatMap(v=>v.coneNumber??[]));const currentVehicleIds=new Set(current.vehicles.map(v=>v.id))
 for(const vehicle of result.vehicles){const plate=normalizePlate(vehicle.plate)
  if(plates.has(plate))throw new Error(`Recupero sospeso: la targa ${plate} esiste con identificativi diversi. Nessun dato modificato.`)
  plates.add(plate)
  if(!result.customers.some(c=>c.id===vehicle.customerId))throw new Error(`Cliente mancante per ${plate}. Nessun dato modificato.`)
  if(!currentVehicleIds.has(vehicle.id)&&vehicle.coneNumber!==null){if(cones.has(vehicle.coneNumber))vehicle.coneNumber=null;else cones.add(vehicle.coneNumber)}
 }
 for(const key of ['estimates','jobs','quotes'] as const){const numbers=new Set<string>();for(const row of result[key]??[]){if(row.number&&numbers.has(row.number))throw new Error(`Recupero sospeso: numero ${row.number} duplicato. Nessun dato modificato.`);if(row.number)numbers.add(row.number)}}
 for(const row of [...(result.estimates??[]),...(result.jobs??[]),...(result.acceptances??[])]){
  if(row.vehicleId&&!result.vehicles.some(v=>v.id===row.vehicleId))throw new Error('Recupero sospeso: riferimento a una vettura mancante. Nessun dato modificato.')
  if(row.customerId&&!result.customers.some(c=>c.id===row.customerId))throw new Error('Recupero sospeso: riferimento a un cliente mancante. Nessun dato modificato.')
 }
 result.workflowCounters={estimate:Math.max(current.workflowCounters?.estimate??0,source.workflowCounters?.estimate??0),job:Math.max(current.workflowCounters?.job??0,source.workflowCounters?.job??0)}
 result.documentCounters={quote:Math.max(current.documentCounters?.quote??0,source.documentCounters?.quote??0),invoice:current.documentCounters?.invoice??0}
 return result
}
