import { closedPlanningWork } from './closedPlanningWork'
import type { ErpData } from '../types'
import { normalizeStationStart, StationAvailabilityError, type PaintReservation } from './paintStations'
export const isWashingPhase=(name:string)=>['Lavaggio esterno','Lavaggio'].includes(name)
export function findWashStationStart(requestedAt:string,jobId:string,reservations:PaintReservation[],endForStart:(start:string)=>string,normalizeStart:(start:string)=>string=(start)=>start) {
 let start=normalizeStationStart(requestedAt,normalizeStart)
 for(let attempt=0;attempt<=reservations.length;attempt++){
  const end=endForStart(start)
  const conflict=reservations.filter(r=>r.jobId!==jobId&&r.startAt<end&&r.endAt>start).sort((a,b)=>a.endAt.localeCompare(b.endAt))[0]
  if(!conflict)return start
  start=normalizeStationStart(conflict.endAt,normalizeStart)
 }
 throw new StationAvailabilityError('La postazione di lavaggio è occupata.')
}
export function currentWashReservations(data:ErpData,floor:string,endForPhase:(job:NonNullable<ErpData['jobs']>[number],phase:NonNullable<ErpData['jobs']>[number]['phases'][number])=>string):PaintReservation[] {
 const {jobIds} = closedPlanningWork(data)
 return (data.jobs??[]).filter(job=>!jobIds.has(job.id)).flatMap(job=>job.phases.filter(p=>isWashingPhase(p.name)&&!p.notRequired&&p.status==='In lavorazione').map(phase=>({jobId:job.id,startAt:floor,endAt:endForPhase(job,phase)})))
}
