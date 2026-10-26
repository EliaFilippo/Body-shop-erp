import type { ErpData } from '../types'
import type { PaintReservation } from './paintStations'
export const isWashingPhase=(name:string)=>['Lavaggio esterno','Lavaggio interni','Lavaggio'].includes(name)
export function findWashStationStart(requestedAt:string,jobId:string,reservations:PaintReservation[],endForStart:(start:string)=>string,normalizeStart:(start:string)=>string=(start)=>start) {
 let start=normalizeStart(requestedAt)
 for(let attempt=0;attempt<=reservations.length;attempt++){
  const end=endForStart(start)
  const conflict=reservations.filter(r=>r.jobId!==jobId&&r.startAt<end&&r.endAt>start).sort((a,b)=>a.endAt.localeCompare(b.endAt))[0]
  if(!conflict)return start
  start=normalizeStart(conflict.endAt)
 }
 throw new Error('La postazione di lavaggio è occupata.')
}
export function currentWashReservations(data:ErpData,floor:string,endForPhase:(job:NonNullable<ErpData['jobs']>[number],phase:NonNullable<ErpData['jobs']>[number]['phases'][number])=>string):PaintReservation[] {
 return (data.jobs??[]).filter(j=>!['Annullata','Consegnata'].includes(j.status)).flatMap(job=>job.phases.filter(p=>isWashingPhase(p.name)&&!p.notRequired&&p.status==='In lavorazione').map(phase=>({jobId:job.id,startAt:floor,endAt:endForPhase(job,phase)})))
}
