import type { ErpData, JobPhase, JobPhaseOperatorAssignment } from '../types'
import type {PhaseCheckUpdate} from './liveProduction'
import {WORK_CYCLE} from './workCycle'
export interface PlanningEntry {
 jobId:string;phaseId:string;operatorId:string;operatorName:string;closedSeconds:number;
 runningSince:string|null;firstStartedAt:string;lastEndedAt:string|null
}
export interface DailyProductionWork {date:string;operatorId:string;productiveSeconds:number;paidSeconds:number}
export interface ProductionPlanningState {
 serverNow:string;entries:PlanningEntry[];dailyWork?:DailyProductionWork[]
 phaseStates?:Array<{jobId:string;phase:JobPhase}>;checks?:PhaseCheckUpdate[]
}
const sameJson=(a:unknown,b:unknown)=>{
 const stable=(v:unknown)=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)
 return stable(a)===stable(b)
}
/** Import real manual and automatic work; completion is exclusively a server signature. */
export function applyProductionPlanningState(data:ErpData,state:ProductionPlanningState):ErpData {
 if(!Array.isArray(state.entries)||!Number.isFinite(Date.parse(state.serverNow))||Date.parse(state.serverNow)<Date.parse(data.productionPlanningSampleAt??''))return data
 let changed=false
 const sample=new Date(Math.floor(Date.parse(state.serverNow)/60000)*60000).toISOString()
 const jobs=(data.jobs??[]).map(job=>{
  if(['Consegnata','Annullata'].includes(job.status))return job
  let jobChanged=false
  let phases=[...job.phases]
  const history=[...(job.history??[])]
  for(const definition of state.phaseStates??[]){
   const p=definition.phase
   if(definition.jobId!==job.id||!p?.id||!p.name||!p.serverWorkTracked||!['Da fare','In lavorazione','Completata','Bloccata'].includes(p.status))continue
   const index=phases.findIndex(phase=>phase.id===p.id),base=index>=0?phases[index]:undefined
   const merged:JobPhase={...p,...base,estimatedMinutes:base?.estimatedMinutes??p.estimatedMinutes??0,notes:base?.notes??p.notes??'',blockedReason:base?.blockedReason??p.blockedReason??'',operatorAssignments:base?.operatorAssignments??p.operatorAssignments??[],
    id:p.id,name:p.name,requiredSkill:base?.requiredSkill||p.requiredSkill||p.name,status:p.status,notRequired:false,
    manualWorkTracked:p.manualWorkTracked,manualExtra:p.manualExtra,serverWorkTracked:true,
    remainingTimeUnknown:!!p.remainingTimeUnknown&&!(Number(base?.estimatedMinutes??p.estimatedMinutes)>0||Number(base?.sharedTimeMinutes??p.sharedTimeMinutes)>0),
    actualMinutes:Math.max(base?.actualMinutes??0,p.actualMinutes??0),startedAt:p.startedAt,
    technicalWaitMinutes:Math.max(base?.technicalWaitMinutes??0,p.technicalWaitMinutes??0),
    technicalWaitBlocksPhaseNames:[...new Set([...(base?.technicalWaitBlocksPhaseNames??[]),...(p.technicalWaitBlocksPhaseNames??[])])]}
   if(p.status==='Completata'){
    merged.completedAt=p.completedAt;merged.endedAt=p.endedAt;merged.completedByName=p.completedByName;merged.tabletWorkedSeconds=p.tabletWorkedSeconds
    if(p.completedAt&&p.completedByName){
     const id=`tablet:${job.id}:${p.id}:${p.completedAt}`
     if(!history.some(h=>h.id===id)){history.unshift({id,at:p.completedAt,actor:p.completedByName,message:`Fase ${p.name} completata da tablet.`});jobChanged=true;changed=true}
    }
   }else{
    delete merged.completedAt;delete merged.endedAt;delete merged.completedByName;delete merged.tabletWorkedSeconds
   }
   if(!base||!sameJson(base,merged)){
    if(index>=0)phases[index]=merged;else phases.push(merged)
    jobChanged=true;changed=true
   }
  }
  if(phases.length!==job.phases.length){
   const order=(p:JobPhase)=>p.cycleOrder??(WORK_CYCLE as readonly string[]).indexOf(p.name)+1
   phases.sort((a,b)=>order(a)-order(b))
  }
  phases=phases.map(phase=>{
   if(phase.status==='Completata')return phase
   const entries=state.entries.filter(e=>e.jobId===job.id&&e.phaseId===phase.id&&Number.isFinite(e.closedSeconds)&&e.closedSeconds>=0)
   if(!entries.length)return phase
   const assignments:JobPhaseOperatorAssignment[]=entries.map(e=>({
    id:'tablet:'+e.operatorId,operatorName:e.operatorName,startedAt:e.runningSince||e.firstStartedAt,
    ...(e.runningSince?{}:{endedAt:e.lastEndedAt||state.serverNow}),
    workedMinutes:e.closedSeconds/60,activityStatus:e.runningSince?'Attivo':'Concluso',
   }))
   const operatorAssignments=[...(phase.operatorAssignments??[]).filter(a=>!a.id.startsWith('tablet:')), ...assignments]
   const next={...phase,operatorAssignments,status:phase.status==='Da fare'?'In lavorazione' as const:phase.status}
   if(sameJson(next,phase))return phase
   changed=true;jobChanged=true;return next
  })
  return jobChanged?{...job,phases,history}:job
 })
 const running=!data.nightlyPlanning?.enabled&&state.entries.some(e=>e.runningSince)
 if(!changed&&(!running||data.productionPlanningSampleAt?.slice(0,16)===sample.slice(0,16)))return data
 return {...data,jobs,productionPlanningSampleAt:state.serverNow}
}
