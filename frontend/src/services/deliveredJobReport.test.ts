import { describe,expect,it } from 'vitest'
import { deliveredJobReport } from './deliveredJobReport'
import { emptyData } from './erp'
import { createEstimate,approveEstimateAndCreateJob } from './workflow'
import type { JobPhase } from '../types'
const phase=(id:string,overrides:Partial<JobPhase>={}):JobPhase=>({id,name:id,status:'Completata',estimatedMinutes:30,actualMinutes:999,notes:'',blockedReason:'',operatorAssignments:[],...overrides})
export const makeReportJob=()=>{
 let data=createEstimate(structuredClone(emptyData),{customerId:'c',plate:'TEST123',companyName:'',contactName:'',date:'2026-10-26',notes:'',selectedPhases:[],lines:[{description:'Riparazione',category:'carrozzeria',quantity:1,unitPrice:500,discount:0,vatRate:22,estimatedMinutes:120,internalHourlyRateUsed:30,budgetMaterialsCost:100}]})
 data=approveEstimateAndCreateJob(data,data.estimates![0].id)
 return {...data.jobs![0],status:'Consegnata' as const}
}
describe('delivered report',()=>{
 it('counts shared allowances once and sums person-time without multiplying tablet totals',()=>{
  const job=makeReportJob()
  job.phases=[phase('s',{sharedTimeKey:'sr',sharedTimeMinutes:60,estimatedMinutes:60,tabletWorkedSeconds:2400}),
   phase('r',{sharedTimeKey:'sr',sharedTimeMinutes:60,estimatedMinutes:60,tabletWorkedSeconds:1800}),
   phase('optional',{notRequired:true}),phase('Consegna',{name:'Consegna'})]
  const before=JSON.stringify(job)
  const r=deliveredJobReport(job)
  expect(r).toMatchObject({plannedSeconds:3600,workedSeconds:4200,complete:true,differenceSeconds:-600,missing:0})
  expect(r.rows).toHaveLength(1)
  expect(JSON.stringify(job)).toBe(before)
 })
 it('keeps unknown actual times partial instead of treating them as zero or elapsed wall time',()=>{
  const job=makeReportJob();job.phases=[phase('a',{tabletWorkedSeconds:0}),phase('b')]
  expect(deliveredJobReport(job)).toMatchObject({workedSeconds:0,complete:false,missing:1,differenceSeconds:null})
  job.phases[1].tabletWorkedSeconds=600
  expect(deliveredJobReport(job)).toMatchObject({workedSeconds:600,complete:true})
 })
 it('uses tablet values over office assignments and preserves earlier recorded work on retired phases',()=>{
  const job=makeReportJob()
  const assignments=[{id:'a',operatorName:'A',startedAt:'2026-10-26T08:00:00Z',endedAt:'2026-10-26T09:00:00Z',workedMinutes:60,activityStatus:'Concluso' as const}]
  job.phases=[phase('a',{tabletWorkedSeconds:300,operatorAssignments:assignments}),phase('b',{operatorAssignments:[...assignments,{...assignments[0],id:'b',operatorName:'B'}]}),phase('old',{notRequired:true,tabletWorkedSeconds:600})]
  expect(deliveredJobReport(job)).toMatchObject({workedSeconds:8100,complete:true,manual:true})
 })
 it('distinguishes actual zero materials from missing and recognizes legacy Fast manual labour',()=>{
  const job=makeReportJob();job.lines=job.lines.map(l=>({...l,category:'altre' as const,manualFastLine:true,budgetMaterialsCost:undefined,internalHourlyRateUsed:undefined}))
  expect(deliveredJobReport(job).materials).toMatchObject({estimatedMaterials:100,actualMaterials:null,materialsSaving:null})
  job.materialActualCost={amount:0,at:'',note:''}
  expect(deliveredJobReport(job).materials).toMatchObject({actualMaterials:0,materialsSaving:100})
 })
})
