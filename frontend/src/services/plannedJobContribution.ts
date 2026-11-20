import type { PlannerSettings, RepairJob, Vehicle } from '../types'
import { marginMetrics } from './planner'
import { operatorHourlyCost } from './closedJobMargin'
/** Estimate only. General expenses are covered by the margin goal, not deducted here. */
export function plannedJobContribution(job:RepairJob,vehicle:Vehicle,settings:PlannerSettings){
 const metrics=marginMetrics(job,vehicle,settings)
 const rates=settings.operators.filter(op=>op.active).map(operatorHourlyCost)
 const average=rates.length&&rates.every(rate=>rate!==null)?rates.reduce<number>((sum,rate)=>sum+(rate??0),0)/rates.length:null
 let labor=0,valid=true,timed=0
 for(const phase of job.phases.filter(p=>!p.notRequired)){
  const minutes=Math.max(0,phase.estimatedMinutes||0)
  const op=phase.preferredOperatorId?settings.operators.find(o=>o.id===phase.preferredOperatorId):undefined
  const rate=op?operatorHourlyCost(op):phase.preferredOperatorId?null:average
  timed+=minutes
  if(minutes>0&&rate===null)valid=false
  labor+=minutes/60*(rate??0)
 }
 const extra=Math.max(0,metrics.productiveMinutes-timed)
 if(extra>0&&average===null)valid=false
 labor+=extra/60*(average??0)
 const contribution=valid?metrics.totalMargin+metrics.productiveHours*metrics.rate-labor:null
 return {...metrics,contribution,contributionPerHour:contribution!==null&&metrics.productiveMinutes>0?contribution/(metrics.productiveMinutes/60):null}
}
