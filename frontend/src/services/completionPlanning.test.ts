import {describe,it,expect,vi} from 'vitest'
import {emptyData} from './erp'
import {createEstimate,approveEstimateAndCreateJob} from './workflow'
import {buildCompletionPlan,handleCompletionRequest,overlayCompletionPlan,stripCompletionOverlay} from './completionPlanning'
const setup=()=>{
 let data=structuredClone(emptyData)
 data.plannerSettings.operators=[{id:'a',name:'A',active:true,dailyHours:8,hourlyCost:20,skillsConfigured:true,skills:['Lattoneria','Lucidatura']}]
 data.plannerSettings.workingDays=[1,2,3,4,5]
 data=createEstimate(data,{customerId:'c',plate:'PHASE',companyName:'Cliente',contactName:'',date:'2026-10-27',notes:'',selectedPhases:[],lines:[{description:'Ripristino',category:'carrozzeria',quantity:1,unitPrice:300,discount:0,vatRate:22,manualPhaseTimes:[{phase:'Lattoneria',minutes:60},{phase:'Lucidatura',minutes:30}]}]})
 data=approveEstimateAndCreateJob(data,data.estimates![0].id)
 const job=data.jobs![0];job.vehicleId='v';job.entryDate='2026-10-27';job.createdAt='2026-10-27T08:00:00Z';job.expectedDeliveryDate='2026-10-28'
 data.vehicles=[{id:'v',customerId:'c',plate:'PHASE',make:'',model:'',color:'',year:'',vin:'',mileage:'',status:'Accettata',coneNumber:1,estimatedHours:1.5,workedHours:0,plannedEntryDate:'2026-10-27',requestedDeliveryDate:'2026-10-28',calculatedDeliveryDate:'2026-11-01',expectedRevenue:300,expectedMargin:100,partsStatus:'Disponibili',blockReason:'',manualPlanningDate:'',createdAt:'2026-10-27T08:00:00Z'}]
 return data
}
describe('completion-triggered planning',()=>{
 it('uses the completion time, skips signed work and leaves actual jobs, finance and requested dates untouched',()=>{
  const data=setup(),job=data.jobs![0],body=job.phases.find(p=>p.name==='Lattoneria')!,before=JSON.stringify(data)
  const now='2026-10-27T14:30:00Z'
  const plan=buildCompletionPlan(data,{serverNow:now,entries:[],checks:[{jobId:job.id,phaseId:body.id,checkedAt:now,checkedBy:'A',workedSeconds:5400}]},2)
  const tasks=plan.operatorPrograms.flatMap(p=>p.tasks)
  expect(tasks.length).toBeGreaterThan(0)
  expect(tasks.map(t=>({phase:t.phaseName,start:t.startAt}))).toEqual(expect.arrayContaining([expect.objectContaining({phase:'Lucidatura'})]))
  expect(tasks.filter(t=>Date.parse(t.startAt)<Date.parse(now)||t.phaseName==='Lattoneria')).toEqual([])
  expect(plan.forecasts[0].date).toBe('2026-10-27')
  expect(JSON.stringify(data)).toBe(before)
  expect(data.vehicles[0].requestedDeliveryDate).toBe('2026-10-28')
  const late=buildCompletionPlan(data,{serverNow:'2026-10-27T23:00:00Z',entries:[],checks:[{jobId:job.id,phaseId:body.id,checkedAt:now,checkedBy:'A',workedSeconds:5400}]},3)
  expect(late.forecasts[0].date!>plan.forecasts[0].date!).toBe(true)
 })
 it('reserves active manual work even outside duties before assigning any further work to that operator',()=>{
  const data=setup(),job=data.jobs![0],body=job.phases.find(p=>p.name==='Lattoneria')!
  data.plannerSettings.operators[0].skills=['Lucidatura']
  const now='2026-10-27T09:00:00Z'
  const plan=buildCompletionPlan(data,{serverNow:now,entries:[{jobId:job.id,phaseId:body.id,operatorId:'a',operatorName:'A',closedSeconds:0,runningSince:now,firstStartedAt:now,lastEndedAt:null}]},1)
  const tasks=plan.operatorPrograms.flatMap(p=>p.tasks).filter(t=>t.operatorId==='a').sort((a,b)=>a.startAt.localeCompare(b.startAt))
  expect(tasks[0].id).toContain('running:')
  expect(tasks[0].phaseName).toBe('Lattoneria')
  expect(tasks.filter(t=>!t.id.startsWith('running:')).every(t=>t.startAt>=tasks[0].endAt)).toBe(true)
  expect(job.phases.find(p=>p.id===body.id)?.status).toBe('Da fare')
 })
 it('does not invent a delivery date when required extra work has unknown duration',()=>{
  const data=setup();const phase=data.jobs![0].phases.find(p=>p.name==='Lattoneria')!
  phase.remainingTimeUnknown=true;phase.estimatedMinutes=0
  const plan=buildCompletionPlan(data,{serverNow:'2026-10-27T09:00:00Z',entries:[]},1)
  expect(plan.forecasts[0].date).toBeNull()
  expect(plan.warnings.length).toBeGreaterThan(0)
 })
 it('overlays predictions without saving them over office edits or the nightly audit',()=>{
  const data=setup(),plan=buildCompletionPlan(data,{serverNow:'2026-10-27T09:00:00Z',entries:[]},1),display=overlayCompletionPlan(data,plan)
  expect(display.operatorPrograms).toBe(plan.operatorPrograms)
  const edited={...display,customers:[{id:'new',name:'Office draft'} as never]}
  const clean=stripCompletionOverlay(edited,data,display)
  expect(clean.customers[0].name).toBe('Office draft')
  expect(clean.operatorPrograms).toBe(data.operatorPrograms)
  expect(clean.vehicles[0].calculatedDeliveryDate).toBe('2026-11-01')
  data.nightlyPlanning={enabled:true,plannedFor:'2026-10-28',generatedAt:'2026-10-28T02:00:00Z',hour:3}
  expect(overlayCompletionPlan(data,plan)).toBe(data)
 })
 it('protects the server worker and retries revision races without changing the phase signature',async()=>{
  const rpc=vi.fn()
  expect((await handleCompletionRequest(new Request('https://test',{method:'POST',body:'{}'}),rpc)).status).toBe(401)
  expect(rpc).not.toHaveBeenCalled()
  const data=setup()
  rpc.mockImplementation(async(name)=>name==='production_completion_claim'?{id:'claim',generation:4,revision:9,payload:data,state:{serverNow:'2026-10-27T09:00:00Z',entries:[]}}:false)
  const res=await handleCompletionRequest(new Request('https://test',{method:'POST',headers:{'x-planning-secret':'a'.repeat(64)},body:JSON.stringify({companyId:'aa49d334-492f-4daa-aa7e-5d5c022308b7'})}),rpc)
  expect(await res.json()).toEqual({status:'retry'})
  expect(rpc.mock.calls[1][1]).toMatchObject({p_generation:4,p_revision:9})
 })
})

it('keeps the drying hour after a real paint signature and does not promise a date beyond schedulable capacity',()=>{
 const data=setup(),job=data.jobs![0]
 const paint=job.phases.find(p=>p.name==='Lattoneria')!,strip=job.phases.find(p=>p.name==='Lucidatura')!
 job.phases=[{...paint,name:'Verniciatura',requiredSkill:'Verniciatura',technicalWaitMinutes:60},{...strip,name:'Scartatura',requiredSkill:'Scartatura'}]
 data.plannerSettings.operators[0].skills=['Verniciatura','Scartatura']
 const now='2026-10-27T09:00:00Z'
 const plan=buildCompletionPlan(data,{serverNow:now,entries:[],checks:[{jobId:job.id,phaseId:paint.id,checkedAt:now,checkedBy:'A',workedSeconds:3600}]},1)
 expect(plan.operatorPrograms.flatMap(p=>p.tasks).filter(t=>t.phaseName==='Scartatura').every(t=>Date.parse(t.startAt)>=Date.parse(now)+3600000)).toBe(true)
 job.phases=[{...paint,estimatedMinutes:100000}]
 const huge=buildCompletionPlan(data,{serverNow:now,entries:[]},2)
 expect(huge.forecasts[0].date).toBeNull()
})
