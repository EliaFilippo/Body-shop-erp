import type { RepairJob } from '../types'
import { phaseDisplayName } from './workCycle'
import { calculateJobMaterialMargin } from './jobMaterialCosts'
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0
/** Productive person-time: a tablet signature already sums all staff on that phase. */
export function deliveredJobReport(job:RepairJob){
 const phases=job.phases.filter(p=>p.name!=='Consegna'&&(!p.notRequired||(p.tabletWorkedSeconds??0)>0||p.operatorAssignments?.some(a=>a.endedAt&&a.workedMinutes>0)))
 const groups=new Map<string,{label:string;plannedMinutes:number;allowance:number;workedSeconds:number;missing:number;manual:boolean}>()
 for(const phase of phases){
  const key=phase.sharedTimeKey||phase.id
  const item=groups.get(key)??{label:'',plannedMinutes:0,allowance:0,workedSeconds:0,missing:0,manual:false}
  item.label=[item.label,phaseDisplayName(phase.name)].filter(Boolean).join(' / ')
  item.plannedMinutes+=valid(phase.estimatedMinutes)?phase.estimatedMinutes:0
  if(phase.sharedTimeKey&&valid(phase.sharedTimeMinutes))item.allowance=Math.max(item.allowance,phase.sharedTimeMinutes)
  if(valid(phase.tabletWorkedSeconds))item.workedSeconds+=phase.tabletWorkedSeconds
  else if(phase.operatorAssignments?.length){
   const closed=phase.operatorAssignments.filter(a=>a.endedAt&&valid(a.workedMinutes))
   item.workedSeconds+=closed.reduce((sum,a)=>sum+a.workedMinutes*60,0)
   item.manual=true
   if(closed.length!==phase.operatorAssignments.length)item.missing++
  }else item.missing++
  groups.set(key,item)
 }
 const rows=[...groups.values()].map(g=>({...g,plannedMinutes:Math.max(g.plannedMinutes,g.allowance)}))
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
