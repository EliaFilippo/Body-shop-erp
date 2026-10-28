import type { ErpData, JobPhaseOperatorAssignment } from '../types'
export interface PlanningEntry {
 jobId:string;phaseId:string;operatorId:string;operatorName:string;closedSeconds:number;
 runningSince:string|null;firstStartedAt:string;lastEndedAt:string|null
}
export interface DailyProductionWork {date:string;operatorId:string;productiveSeconds:number;paidSeconds:number}
export interface ProductionPlanningState { serverNow:string;entries:PlanningEntry[];dailyWork?:DailyProductionWork[] }
/** Canonical timer facts never create signatures or complete a phase. */
export function applyProductionPlanningState(data:ErpData,state:ProductionPlanningState):ErpData {
 if(!Array.isArray(state.entries)||!Number.isFinite(Date.parse(state.serverNow)))return data
 let changed=false
 const sample=new Date(Math.floor(Date.parse(state.serverNow)/60000)*60000).toISOString()
 const jobs=(data.jobs??[]).map(job=>{
  if(['Consegnata','Annullata'].includes(job.status))return job
  let jobChanged=false
  const phases=job.phases.map(phase=>{
   if(phase.status==='Completata')return phase
   const entries=state.entries.filter(e=>e.jobId===job.id&&e.phaseId===phase.id&&Number.isFinite(e.closedSeconds)&&e.closedSeconds>=0)
   if(!entries.length)return phase
   const assignments:JobPhaseOperatorAssignment[]=entries.map(e=>({
    id:'tablet:'+e.operatorId,operatorName:e.operatorName,startedAt:e.runningSince||e.firstStartedAt,
    ...(e.runningSince?{}:{endedAt:e.lastEndedAt||state.serverNow}),
    workedMinutes:e.closedSeconds/60,activityStatus:e.runningSince?'Attivo':'Concluso',
   }))
   const operatorAssignments=[...phase.operatorAssignments.filter(a=>!a.id.startsWith('tablet:')), ...assignments]
   const next={...phase,operatorAssignments,status:phase.status==='Da fare'?'In lavorazione' as const:phase.status}
   if(JSON.stringify(next)===JSON.stringify(phase))return phase
   changed=true;jobChanged=true;return next
  })
  return jobChanged?{...job,phases}:job
 })
 // Replan at most once per minute for running work; exact transitions are immediate.
 const running=state.entries.some(e=>e.runningSince)
 if(!changed&&(!running||data.productionPlanningSampleAt?.slice(0,16)===sample.slice(0,16)))return data
 return {...data,jobs,productionPlanningSampleAt:state.serverNow}
}
