import {toRomePlanningClock,fromRomePlanningClock,localizePlanningTimestamps} from './romePlanningClock'
import type {ErpData,OperatorDayProgram,OperatorProgramTask,PlannerAssignment} from '../types'
import {applyProductionPlanningState,type ProductionPlanningState} from './productionPlanningState'
import {applyLivePhaseChecks} from './liveProduction'
import {generateOperatorPrograms,phaseResidualMinutes} from './planner'
import {addWorkingMinutes,nextWorkingInstant} from './workCalendar'
export interface CompletionForecast {vehicleId:string;jobId:string;date:string|null;endAt:string|null}
export interface CompletionPlan {generation:number;generatedAt:string;operatorPrograms:OperatorDayProgram[];plannerAssignments:PlannerAssignment[];forecasts:CompletionForecast[];warnings:string[]}
const romeDate=(iso:string)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso))
/** Simulation only. Real signatures/timers and quoted hours are never modified. */
export function buildCompletionPlan(data:ErpData,state:ProductionPlanningState,generation:number):CompletionPlan{
 const actual=applyLivePhaseChecks(applyProductionPlanningState(data,state),state.checks??[])
 const availability:{operators:Record<string,string>;jobs:Record<string,string>}={operators:{},jobs:{}}
 const fixed:OperatorProgramTask[]=[],warnings:string[]=[]
 const now=new Date(state.serverNow).toISOString(),day=romeDate(now),revision=(actual.operatorProgramRevision??0)+1
 // The legacy calendar allocates whole minutes: round forward, never into
 // seconds already elapsed or before a drying deadline.
 const clockNow=toRomePlanningClock(new Date(Math.ceil(Date.parse(now)/60000)*60000).toISOString())
 const calendarPhase=(phase:NonNullable<ErpData['jobs']>[number]['phases'][number])=>{
  const localized=localizePlanningTimestamps(phase.name==='Verniciatura'?{...phase,technicalWaitMinutes:Math.max(60,phase.technicalWaitMinutes??60)}:phase)
  for(const field of ['completedAt','endedAt'] as const)if(localized[field])localized[field]=new Date(Math.ceil(Date.parse(localized[field]!)/60000)*60000).toISOString()
  return localized
 }
 const simulation={...actual,vehicles:localizePlanningTimestamps(actual.vehicles),jobs:(actual.jobs??[]).map(job=>({...job,phases:job.phases.map(phase=>{
  const running=state.entries.filter(e=>e.jobId===job.id&&e.phaseId===phase.id&&e.runningSince)
  if(!running.length||phase.status==='Completata')return calendarPhase(phase)
  const minutes=phaseResidualMinutes(phase,now,job)
  let end=clockNow
  for(const entry of running){
   const operator=actual.plannerSettings.operators.find(op=>op.id===entry.operatorId)
   if(!operator){warnings.push(`Operatore non configurato su ${job.plate}.`);continue}
   const start=clockNow
   const nextShift=nextWorkingInstant(clockNow,actual.plannerSettings,operator)
   const finish=nextShift>clockNow?new Date(Date.parse(clockNow)+minutes*60000).toISOString():addWorkingMinutes(start,minutes,actual.plannerSettings,operator)
   availability.operators[operator.id]=[availability.operators[operator.id]??'',finish].sort().at(-1)!
   end=[end,finish].sort().at(-1)!
   fixed.push({id:`running:${job.id}:${phase.id}:${operator.id}`,operatorId:operator.id,operatorName:operator.name,vehicleId:job.vehicleId??'',plate:job.plate,jobId:job.id,jobNumber:job.number,phaseId:phase.id,phaseName:phase.name,startAt:start,endAt:finish,plannedMinutes:minutes,priority:job.priority,reason:'Lavorazione già avviata · operatore mantenuto sulla vettura',panelNames:[],panelNotes:[],originalPlannedDate:day,scheduleDeltaMinutes:0,isAdvancedFromFuture:false,overtimeMinutes:0,revision})
  }
  availability.jobs[job.id]=[availability.jobs[job.id]??'',end].sort().at(-1)!
  // Virtual completion makes the remaining sequence forecastable, not signed.
  return {...calendarPhase(phase),status:'Completata' as const,completedAt:end,endedAt:end,operatorAssignments:[]}
 })}))}
 const generated=generateOperatorPrograms(simulation,day,'Ricalcolo dopo completamento fase · priorità box',clockNow,availability)
 const programs=generated.programs.map(p=>({...p,tasks:[...p.tasks]}))
 for(const task of fixed){
  let program=programs.find(p=>p.operatorId===task.operatorId&&p.date===task.startAt.slice(0,10))
  if(!program){const seed=programs.find(p=>p.operatorId===task.operatorId);if(!seed)continue;program={...seed,date:task.startAt.slice(0,10),tasks:[]};programs.push(program)}
  program.tasks.push(task);program.tasks.sort((a,b)=>a.startAt.localeCompare(b.startAt))
 }
 for(const program of programs)if(program.summary){const plannedMinutes=program.tasks.reduce((sum,t)=>sum+t.plannedMinutes,0);program.summary={...program.summary,plannedMinutes,differenceMinutes:program.summary.actualMinutes-plannedMinutes}}
 for(const program of programs){
  program.generatedAt=now
  program.tasks=program.tasks.map(t=>{const startAt=t.id.startsWith('running:')?now:fromRomePlanningClock(t.startAt,Date.parse(now));return {...t,startAt,endAt:fromRomePlanningClock(t.endAt,Date.parse(startAt))}})
 }
 const tasks=programs.flatMap(p=>p.tasks)
 const forecasts=(actual.jobs??[]).filter(j=>j.vehicleId&&!['Consegnata','Annullata'].includes(j.status)).map(job=>{
  const required=job.phases.filter(p=>!p.notRequired&&p.name!=='Consegna'&&p.status!=='Completata')
  const planned=tasks.filter(t=>t.jobId===job.id)
  const worked=(phase:typeof job.phases[number])=>Math.max(phase.actualMinutes||0,(phase.tabletWorkedSeconds??0)/60,(phase.operatorAssignments??[]).reduce((sum,a)=>sum+Math.max(0,a.workedMinutes)+(a.activityStatus==='Attivo'&&!a.endedAt?Math.max(0,(Date.parse(now)-Date.parse(a.startedAt))/60000):0),0))
  const covered=(phase:typeof job.phases[number])=>{
   const members=phase.sharedTimeKey?job.phases.filter(p=>p.sharedTimeKey===phase.sharedTimeKey&&!p.notRequired):[phase]
   const remaining=Math.max(1,(phase.sharedTimeKey?phase.sharedTimeMinutes??phase.estimatedMinutes:phase.estimatedMinutes)-members.reduce((sum,p)=>sum+worked(p),0))
   return planned.filter(t=>members.some(p=>p.id===t.phaseId)).reduce((sum,t)=>sum+t.plannedMinutes,0)+0.001>=remaining
  }
  const known=!job.blocks?.length&&!actual.vehicles.find(v=>v.id===job.vehicleId)?.blockReason&&required.every(p=>!p.remainingTimeUnknown&&p.status!=='Bloccata'&&planned.some(t=>t.phaseId===p.id)&&covered(p))
  const drying=job.phases.filter(p=>!p.notRequired&&p.status==='Completata'&&(p.completedAt||p.endedAt)&&Math.max(0,(p.name==='Verniciatura'?Math.max(60,p.technicalWaitMinutes??60):p.technicalWaitMinutes??0))>0).map(p=>new Date(Date.parse(p.completedAt||p.endedAt!)+Math.max(0,(p.name==='Verniciatura'?Math.max(60,p.technicalWaitMinutes??60):p.technicalWaitMinutes??0))*60000).toISOString())
  const endAt=known?[now,...planned.map(t=>t.endAt),...drying].sort().at(-1)!:null
  if(!known)warnings.push(`${job.plate}: consegna non stimabile, verifica tempi, mansioni o blocchi.`)
  return {vehicleId:job.vehicleId!,jobId:job.id,date:endAt?romeDate(endAt):null,endAt}
 })
 const assignments=new Map<string,PlannerAssignment>()
 for(const task of tasks){const date=romeDate(task.startAt),key=task.vehicleId+'|'+date;const row=assignments.get(key)??{vehicleId:task.vehicleId,date,protectedHours:0,normalHours:0};row.protectedHours+=task.plannedMinutes/60;row.normalHours+=task.plannedMinutes/60;assignments.set(key,row)}
 return {generation,generatedAt:now,operatorPrograms:programs,plannerAssignments:[...assignments.values()],forecasts,warnings:[...new Set(warnings)]}
}
export function overlayCompletionPlan(data:ErpData,plan:CompletionPlan|null):ErpData{
 if(!plan||Date.parse(plan.generatedAt)<=Date.parse(data.nightlyPlanning?.generatedAt??'1970-01-01'))return data
 const dates=new Map(plan.forecasts.map(f=>[f.vehicleId,f.date??'']))
 return {...data,vehicles:data.vehicles.map(v=>dates.has(v.id)?{...v,calculatedDeliveryDate:dates.get(v.id)!}:v),operatorPrograms:plan.operatorPrograms,plannerAssignments:plan.plannerAssignments}
}
export function stripCompletionOverlay(next:ErpData,base:ErpData,display:ErpData):ErpData{
 return {...next,vehicles:next.vehicles.map(v=>{const original=base.vehicles.find(o=>o.id===v.id),shown=display.vehicles.find(o=>o.id===v.id);return original&&shown&&v.calculatedDeliveryDate===shown.calculatedDeliveryDate?{...v,calculatedDeliveryDate:original.calculatedDeliveryDate}:v}),operatorPrograms:next.operatorPrograms===display.operatorPrograms?base.operatorPrograms:next.operatorPrograms,plannerAssignments:next.plannerAssignments===display.plannerAssignments?base.plannerAssignments:next.plannerAssignments}
}
export interface CompletionClaim {id:string;generation:number;revision:number;payload:ErpData;state:ProductionPlanningState}
export async function handleCompletionRequest(request:Request,rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>):Promise<Response>{
 if(request.method!=='POST')return new Response('Method not allowed',{status:405})
 const secret=request.headers.get('x-planning-secret')
 const expires=Number(request.headers.get('x-planning-expires')),stamp=Math.floor(Date.now()/1000)
 if(!secret||!/^[a-f0-9]{64}$/.test(secret)||!Number.isSafeInteger(expires)||expires<stamp||expires>stamp+180)return new Response('Unauthorized',{status:401})
 let companyId='';try{companyId=(await request.json()).companyId??''}catch{return new Response('Invalid request',{status:400})}
 if(!/^[a-f0-9-]{36}$/.test(companyId))return new Response('Invalid company',{status:400})
 let claim:CompletionClaim|null=null
 try{
  claim=await rpc('production_completion_claim',{p_company_id:companyId,p_secret:secret,p_expires:expires}) as CompletionClaim|null
  if(!claim)return Response.json({status:'skipped'})
  const plan=buildCompletionPlan(claim.payload,claim.state,claim.generation)
  const ok=await rpc('production_completion_commit',{p_company_id:companyId,p_id:claim.id,p_generation:claim.generation,p_revision:claim.revision,p_plan:plan})
  return Response.json({status:ok?'completed':'retry'})
 }catch{
  if(claim)try{await rpc('production_completion_failed',{p_company_id:companyId,p_id:claim.id})}catch{/* Durable queue retries later. */}
  return Response.json({status:'retry'},{status:503})
 }
}
