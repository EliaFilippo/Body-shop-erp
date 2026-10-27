import type {ErpData} from '../types'
import {applyLivePhaseChecks,type PhaseCheckUpdate} from './liveProduction'
import {applyProductionPlanningState,type ProductionPlanningState} from './productionPlanningState'
import {recalculateOperatorPrograms,calculatePlanner} from './planner'
import {isWorkingDate,addDays} from './workCalendar'
export function buildNightlyPlan(data:ErpData,state:ProductionPlanningState,checks:PhaseCheckUpdate[],day:string){
 let actual=applyProductionPlanningState(applyLivePhaseChecks(data,checks),state)
 let target=day
 for(let n=0;n<60&&!isWorkingDate(target,actual.plannerSettings);n++)target=addDays(target,1)
 if(!isWorkingDate(target,actual.plannerSettings))throw Error('Nessun giorno lavorativo configurato nei prossimi 60 giorni.')
 const capacity=calculatePlanner(actual.vehicles,actual.plannerSettings,target)
 actual={...actual,vehicles:actual.vehicles.map(v=>({...v,calculatedDeliveryDate:capacity.vehicles.find(x=>x.vehicleId===v.id)?.calculatedDeliveryDate??v.calculatedDeliveryDate})),plannerAssignments:capacity.assignments}
 const planned=recalculateOperatorPrograms(actual,target,'Piano notturno da lavorazioni reali')
 return {...planned,nightlyPlanning:{enabled:true as const,plannedFor:target,generatedAt:state.serverNow,hour:3}}
}
export interface NightlyClaim {id:string;revision:number;day:string;payload:ErpData;state:ProductionPlanningState;checks:PhaseCheckUpdate[]}
export async function handleNightlyRequest(request:Request,rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>):Promise<Response>{
 if(request.method!=='POST')return new Response('Method not allowed',{status:405})
 const secret=request.headers.get('x-planning-secret')
 if(!secret||!/^[a-f0-9]{64}$/.test(secret))return new Response('Unauthorized',{status:401})
 let companyId=''
 try{companyId=(await request.json()).companyId??''}catch{return new Response('Invalid request',{status:400})}
 if(!/^[a-f0-9-]{36}$/.test(companyId))return new Response('Invalid company',{status:400})
 let claim:NightlyClaim|null=null
 try{
  claim=await rpc('production_nightly_claim',{p_company_id:companyId,p_secret:secret}) as NightlyClaim|null
  if(!claim)return Response.json({status:'skipped'})
  const plan=buildNightlyPlan(claim.payload,claim.state,claim.checks,claim.day)
  const committed=await rpc('production_nightly_commit',{p_company_id:companyId,p_run_id:claim.id,p_revision:claim.revision,p_plan:plan})
  return Response.json({status:committed?'completed':'retry',plannedFor:committed?plan.nightlyPlanning.plannedFor:undefined})
 }catch{
  if(claim)try{await rpc('production_nightly_failed',{p_company_id:companyId,p_run_id:claim.id})}catch{/* lease expiry permits retry */}
  return Response.json({status:'retry'},{status:503})
 }
}
