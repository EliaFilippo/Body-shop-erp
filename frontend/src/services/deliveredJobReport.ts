import type { JobPhase, RepairJob } from '../types'
import { phaseDisplayName } from './workCycle'
import { calculateJobMaterialMargin } from './jobMaterialCosts'
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0
export function deliveredWorkPhases(job:RepairJob){
 return job.phases.filter(p=>p.name!=='Consegna'&&(!p.notRequired||(p.tabletWorkedSeconds??0)>0||p.operatorAssignments?.some(a=>a.endedAt&&a.workedMinutes>0)))
}
/** Reconcile the signed total with closed timers, which may include work recorded after signing. */
export function deliveredPhaseTime(phase: JobPhase) {
 const signedSeconds=phase.tabletWorkedSeconds
 const signed=valid(signedSeconds)
 const assignments=(phase.operatorAssignments??[]).filter(a=>!signed||a.id.startsWith('tablet:'))
 const closed=assignments.filter(a=>a.endedAt&&valid(a.workedMinutes))
 const closedSeconds=closed.reduce((sum,a)=>sum+a.workedMinutes*60,0)
 const workedSeconds=signed?Math.max(signedSeconds,closedSeconds):closedSeconds
 const allClosed=closed.length===assignments.length
 return {closed,workedSeconds,manual:!signed&&assignments.some(a=>!a.id.startsWith('tablet:')),
  timeComplete:allClosed&&(signed||closed.length>0),
  assignmentsComplete:allClosed&&(signed?Math.abs(closedSeconds-workedSeconds)<=0.5:closed.length>0)}
}
/** Productive person-time: a tablet signature already sums all staff on that phase. */
export function deliveredJobReport(job:RepairJob){
 const phases=deliveredWorkPhases(job)
 const groups=new Map<string,{label:string;plannedMinutes:number;allowance:number;workedSeconds:number;missing:number;manual:boolean}>()
 for(const phase of phases){
  const key=phase.sharedTimeKey||phase.id
  const item=groups.get(key)??{label:'',plannedMinutes:0,allowance:0,workedSeconds:0,missing:0,manual:false}
  item.label=[item.label,phaseDisplayName(phase.name)].filter(Boolean).join(' / ')
  item.plannedMinutes+=valid(phase.estimatedMinutes)?phase.estimatedMinutes:0
  if(phase.sharedTimeKey&&valid(phase.sharedTimeMinutes))item.allowance=Math.max(item.allowance,phase.sharedTimeMinutes)
  const time=deliveredPhaseTime(phase)
  item.workedSeconds+=time.workedSeconds
  item.manual||=time.manual
  if(!time.timeComplete)item.missing++
  groups.set(key,item)
 }
 const rows=[...groups.values()].map(g=>({...g,plannedMinutes:g.allowance>0?g.allowance:g.plannedMinutes}))
 const missing=rows.reduce((sum,r)=>sum+r.missing,0)
 const workedSeconds=rows.reduce((sum,r)=>sum+r.workedSeconds,0)
 const plannedSeconds=rows.reduce((sum,r)=>sum+r.plannedMinutes*60,0)
 const complete=phases.length>0&&missing===0
 return {rows,missing,workedSeconds,plannedSeconds,complete,manual:rows.some(r=>r.manual),
  differenceSeconds:complete&&rows.every(r=>r.plannedMinutes>0)?plannedSeconds-workedSeconds:null,
  materials:calculateJobMaterialMargin(job)}
}
export function reportDuration(seconds:number){
 const minutes=Math.round(seconds/60)
 return `${Math.floor(minutes/60)} h ${String(minutes%60).padStart(2,'0')} min`
}
