import type { JobPhase, RepairJob } from '../types'
/** Operational priority only. Readiness, duties and station capacity remain hard constraints. */
export function paintFlowPriority(job:RepairJob,phase:JobPhase,original:RepairJob=job){
 if((phase.operatorAssignments??[]).some(a=>a.activityStatus==='Attivo'&&!a.endedAt))
  return {rank:-1,reason:'Prosecuzione della lavorazione già avviata'}
 const paint=job.phases.find(p=>p.name==='Verniciatura'&&!p.notRequired)
 const realPaint=original.phases.find(p=>p.name==='Verniciatura'&&!p.notRequired)
 if(phase.name==='Scartatura'&&paint?.status==='Completata'){
  return realPaint?.status==='Completata'
   ?{rank:0,reason:'Priorità cabine: scartare la vettura già verniciata e pronta dopo asciugatura'}
   :{rank:1,reason:'Priorità cabine: scartatura dopo la verniciatura prevista'}
 }
 if(paint&&paint.status!=='Completata'){
  if(phase.name==='Verniciatura')return {rank:2,reason:'Priorità cabine: verniciare la vettura pronta'}
  if(phase.name==='Incartatura')return {rank:3,reason:'Priorità cabine: incartare la prossima vettura da verniciare'}
  if(phase.name==='Stuccatura'||phase.name==='Preparazione')return {rank:4,reason:'Priorità cabine: preparare la prossima vettura da verniciare'}
 }
 return {rank:5,reason:''}
}
