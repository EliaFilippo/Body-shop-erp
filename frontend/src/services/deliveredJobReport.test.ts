import { describe,expect,it } from 'vitest'
import { deliveredJobReport } from './deliveredJobReport'
import { closedJobMargin } from './closedJobMargin'
import { emptyData } from './erp'
import { createEstimate,approveEstimateAndCreateJob } from './workflow'
import type { JobPhase, PlannerOperator } from '../types'
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

const internal = (hourlyCost: number): PlannerOperator => ({ id: 'a', name: 'A', active: true, dailyHours: 8, hourlyCost })
const tabletWork = (id: string, operatorName: string, workedMinutes: number) => ({
 id: 'tablet:' + id, operatorName, workedMinutes, activityStatus: 'Concluso' as const,
 startedAt: '2026-10-26T08:00:00Z', endedAt: '2026-10-26T10:00:00Z',
})
const paidPhase = (seconds: number) => phase('a', { tabletWorkedSeconds: seconds, operatorAssignments: [tabletWork('a', 'A', seconds / 60)] })

describe('closed job margin', () => {
 it('values recorded seconds at the operator’s hourly cost and returns integer cents', () => {
  const job = makeReportJob()
  job.taxableAmount = 500.09
  job.materialActualCost = { amount: 100.02, at: '', note: '' }
  job.phases = [paidPhase(3661)]
  const result = closedJobMargin(job, [internal(28.36)])
  expect(result).toMatchObject({ revenueCents: 50009, workedSeconds: 3661, marginCents: 37123 })
  expect(result.hourlyRevenue).toBeCloseTo(491.76, 2)
 })

 it('charges the employee and Martin at their own rates without adding a flat rate', () => {
  const job = makeReportJob()
  const martin: PlannerOperator = { id: 'martin', name: 'Martin', dailyHours: 8, active: true, costMode: 'external-extra', externalHourlyCost: 40 }
  const martinWork = tabletWork('martin', 'MARTIN', 90)
  job.materialActualCost = { amount: 0, at: '', note: '' }
  job.phases = [phase('a', { tabletWorkedSeconds: 7200, operatorAssignments: [
   martinWork, tabletWork('a', 'A', 30), { ...martinWork, id: 'office-duplicate' },
  ] })]
  expect(closedJobMargin(job, [internal(30), martin])).toMatchObject({
   workedSeconds: 7200, marginCents: 42500, laborCents: 7500, laborComplete: true,
   operatorLabor: [{ name: 'Martin', seconds: 5400, costCents: 6000 }, { name: 'A', seconds: 1800, costCents: 1500 }],
  })
  expect(closedJobMargin(job, [martin])).toMatchObject({ marginCents: null, laborComplete: false })
  job.phases[0].operatorAssignments = []
  expect(closedJobMargin(job, [internal(30), martin])).toMatchObject({
   workedSeconds: 7200, marginCents: null, laborComplete: false,
  })
 })

 it('counts added tablet work after signing once, including its labor cost', () => {
  const job = makeReportJob()
  job.materialActualCost = { amount: 0, at: '', note: '' }
  job.phases = [phase('a', { tabletWorkedSeconds: 1800, operatorAssignments: [tabletWork('a', 'A', 45)] })]
  expect(closedJobMargin(job, [internal(30)])).toMatchObject({
   workedSeconds: 2700, laborCents: 2250, marginCents: 47750, laborComplete: true,
  })
  expect(job.phases[0].tabletWorkedSeconds).toBe(1800)
 })
 it('subtracts recorded parts once and labels the quoted purchase cost as estimated when no receipt is recorded', () => {
  const job = makeReportJob()
  job.phases = [paidPhase(3600)]
  job.materialActualCost = { amount: 20, at: '', note: '' }
  job.lines.push({ ...job.lines[0], id: 'parts', category: 'ricambi', budgetDirectUnitCost: 90 })
  expect(closedJobMargin(job, [internal(30)], undefined, 60)).toMatchObject({
   materialCents: 2000, partsCents: 6000, laborCents: 3000, marginCents: 39000, partsEstimated: false,
  })
  expect(closedJobMargin(job, [internal(30)])).toMatchObject({ partsCents: 9000, marginCents: 36000, partsEstimated: true })
 })

 it('uses estimated materials until confirmed and never guesses missing hours', () => {
  const job = makeReportJob()
  job.phases = [paidPhase(3600), phase('b')]
  expect(closedJobMargin(job, [internal(30)])).toMatchObject({
   marginCents: null, hourlyRevenue: null, availableLaborCents: 3000, availableMarginCents: 37000,
   phasesWithoutTime: ['b'],
  })
  job.phases.pop()
  expect(closedJobMargin(job, [internal(30)])).toMatchObject({ marginCents: 37000, hourlyRevenue: 500, materialsToConfirm: true })
  job.materialActualCost = { amount: 0, at: '', note: '' }
  expect(closedJobMargin(job, [internal(30)]).marginCents).toBe(47000)
 })
})
