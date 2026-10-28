import {createEstimate,approveEstimateAndCreateJob} from './workflow'
import {describe,it,expect,vi,afterEach} from 'vitest'
afterEach(()=>vi.useRealTimers())
import {emptyData} from './erp'
import {buildNightlyPlan,handleNightlyRequest} from './nightlyPlanning'
describe('nightly planning',()=>{
 it('keeps business data, moves to a working day and never fabricates completion',()=>{
  const data=structuredClone(emptyData)
  data.plannerSettings.workingDays=[1,2,3,4,5]
  const before=JSON.stringify(data)
  const plan=buildNightlyPlan(data,{serverNow:'2026-10-31T02:00:00Z',entries:[]},[],'2026-10-31')
  expect(plan.nightlyPlanning).toMatchObject({enabled:true,plannedFor:'2026-11-02'})
  expect(data.jobs).toEqual([])
  expect(JSON.stringify(data)).toBe(before)
  expect(plan.customers).toEqual(data.customers)
 })
 it('does not invoke privileged RPCs without a valid private scheduler token',async()=>{
  const rpc=vi.fn()
  const res=await handleNightlyRequest(new Request('https://test',{method:'POST',body:'{}'}),rpc)
  expect(res.status).toBe(401);expect(rpc).not.toHaveBeenCalled()
 })
 it('does not plan when the server skips an active shift or an already completed run',async()=>{
  const rpc=vi.fn(async()=>null)
  const res=await handleNightlyRequest(new Request('https://test',{method:'POST',headers:{'x-planning-secret':'a'.repeat(64)},body:JSON.stringify({companyId:'aa49d334-492f-4daa-aa7e-5d5c022308b7'})}),rpc)
  expect(await res.json()).toEqual({status:'skipped'});expect(rpc).toHaveBeenCalledTimes(1)
 })
 it('submits a claimed plan with its source revision and reports a race as retry',async()=>{
  const data=structuredClone(emptyData)
  const rpc=vi.fn(async(name:string)=>name==='production_nightly_claim'?{id:'run',revision:7,day:'2026-10-27',payload:data,state:{serverNow:'2026-10-27T02:00:00Z',entries:[]},checks:[]}:false)
  const res=await handleNightlyRequest(new Request('https://test',{method:'POST',headers:{'x-planning-secret':'a'.repeat(64)},body:JSON.stringify({companyId:'aa49d334-492f-4daa-aa7e-5d5c022308b7'})}),rpc)
  expect((await res.json()).status).toBe('retry')
  expect(rpc.mock.calls[1][0]).toBe('production_nightly_commit')
 })
})

it('uses real evening signatures to prioritize clearing a painted car without completing its next phase',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-26T08:00:00Z'))
 let data=structuredClone(emptyData)
 data.plannerSettings.operators=[{id:'a',name:'Stefania',active:true,dailyHours:8,skillsConfigured:true,skills:['incartatura','scartatura']}]
 data=createEstimate(data,{customerId:'c',plate:'AA111AA',companyName:'Cliente',contactName:'',date:'2026-10-26',notes:'',selectedPhases:[],lines:[{description:'Paraurti',category:'verniciatura',quantity:1,unitPrice:150,discount:0,vatRate:22,manualPhaseTimes:[{phase:'Incartatura',minutes:10},{phase:'Verniciatura',minutes:60},{phase:'Scartatura',minutes:20}]}]})
 data=approveEstimateAndCreateJob(data,data.estimates![0].id)
 const job=data.jobs![0]
 job.vehicleId='v'
 data.vehicles=[{id:'v',customerId:'c',plate:'AA111AA',make:'',model:'',color:'',year:'',vin:'',mileage:'',status:'Accettata',coneNumber:1,estimatedHours:1.5,workedHours:0,plannedEntryDate:'2026-10-26',requestedDeliveryDate:'2026-10-28',calculatedDeliveryDate:'',expectedRevenue:150,expectedMargin:30,partsStatus:'Disponibili',blockReason:'',manualPlanningDate:'',createdAt:'2026-10-26T08:00:00Z'}]
 const before=JSON.stringify(data)
 const checks=job.phases.filter(p=>['Stuccatura','Incartatura','Verniciatura'].includes(p.name)).map(p=>({jobId:job.id,phaseId:p.id,checkedBy:'Martin',checkedAt:'2026-10-26T21:00:00Z',workedSeconds:600}))
 const plan=buildNightlyPlan(data,{serverNow:'2026-10-27T02:00:00Z',entries:[]},checks,'2026-10-27')
 expect(plan.operatorPrograms?.find(p=>p.operatorId==='a')?.tasks[0]?.phaseName).toBe('Scartatura')
 expect(plan.jobs![0].phases.find(p=>p.name==='Scartatura')?.status).toBe('Da fare')
 expect(JSON.stringify(data)).toBe(before)
})

it('stores separate nightly rates and daily goals once per planned date without rewriting financial settings',()=>{
 const data=structuredClone(emptyData)
 data.plannerSettings.monthlyRevenueGoal=30000
 data.plannerSettings.operators=[{id:'a',name:'A',active:true,dailyHours:8,hourlyCost:20}]
 data.plannerSettings.internalCostSettings={...data.plannerSettings.internalCostSettings!,monthlyCostItems:[{id:'fixed',category:'affitto',description:'Struttura',active:true,monthlyAmount:2000}]}
 const state={serverNow:'2026-10-28T02:00:00Z',entries:[],dailyWork:[{date:'2026-10-27',operatorId:'a',productiveSeconds:14400,paidSeconds:18000}]}
 const plan=buildNightlyPlan(data,state,[],'2026-10-28')
 expect(plan.nightlyPlanning.economics.productiveHours).toBe(4)
 expect(plan.nightlyPlanning.economics.realHourlyCost).toBeGreaterThan(0)
 expect(plan.nightlyPlanning.economics.targetHourlyRate).toBeGreaterThan(0)
 expect(plan.nightlyPlanning.economics.dailyGoal).toBeGreaterThan(0)
 expect(plan.plannerSettings).toEqual(data.plannerSettings)
 expect(plan.invoices).toEqual(data.invoices)
 const twice=buildNightlyPlan(plan,state,[],'2026-10-28')
 expect(twice.nightlyPlanning.economicsHistory).toHaveLength(1)
})

it('assigns the next automatic phase after a manual signature, and keeps an unsigned manual phase open',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-27T08:00:00Z'))
 let data=structuredClone(emptyData)
 data.plannerSettings.operators=[{id:'b',name:'Federica',active:true,dailyHours:8,skillsConfigured:true,skills:['Lucidatura']}]
 data=createEstimate(data,{customerId:'c',plate:'HANDOFF',companyName:'Cliente',contactName:'',date:'2026-10-27',notes:'',selectedPhases:[],lines:[{description:'Ripristino',category:'carrozzeria',quantity:1,unitPrice:300,discount:0,vatRate:22,manualPhaseTimes:[{phase:'Lattoneria',minutes:60},{phase:'Lucidatura',minutes:30}]}]})
 data=approveEstimateAndCreateJob(data,data.estimates![0].id)
 const job=data.jobs![0];job.vehicleId='v'
 data.vehicles=[{id:'v',customerId:'c',plate:'HANDOFF',make:'',model:'',color:'',year:'',vin:'',mileage:'',status:'Accettata',coneNumber:1,estimatedHours:1.5,workedHours:0,plannedEntryDate:'2026-10-27',requestedDeliveryDate:'2026-10-28',calculatedDeliveryDate:'',expectedRevenue:300,expectedMargin:100,partsStatus:'Disponibili',blockReason:'',manualPlanningDate:'',createdAt:'2026-10-27T08:00:00Z'}]
 const body=job.phases.find(p=>p.name==='Lattoneria')!
 const completed={...body,status:'Completata' as const,serverWorkTracked:true,manualWorkTracked:true,notRequired:false,completedAt:'2026-10-27T18:00:00Z',endedAt:'2026-10-27T18:00:00Z',completedByName:'Filippo',tabletWorkedSeconds:3600}
 const state={serverNow:'2026-10-28T02:00:00Z',entries:[],phaseStates:[{jobId:job.id,phase:completed}]}
 const plan=buildNightlyPlan(data,state,[],'2026-10-28')
 expect(plan.operatorPrograms?.find(p=>p.operatorId==='b')?.tasks[0]?.phaseName).toBe('Lucidatura')
 expect(job.phases.find(p=>p.id===body.id)?.status).toBe('Da fare')
 const unfinished={...completed,status:'In lavorazione' as const,completedAt:undefined,endedAt:undefined,completedByName:undefined}
 const pending=buildNightlyPlan(data,{...state,phaseStates:[{jobId:job.id,phase:unfinished}]},[],'2026-10-28')
 expect(pending.operatorPrograms?.find(p=>p.operatorId==='b')?.tasks).toHaveLength(0)
 expect(pending.jobs![0].phases.find(p=>p.id===body.id)?.status).toBe('In lavorazione')
 const polish=job.phases.find(p=>p.name==='Lucidatura')!
 const advanced={...polish,status:'In lavorazione' as const,serverWorkTracked:true,manualWorkTracked:true}
 const notReady=buildNightlyPlan(data,{...state,phaseStates:[{jobId:job.id,phase:advanced}]},[],'2026-10-28')
 expect(notReady.operatorPrograms?.find(p=>p.operatorId==='b')?.tasks).toHaveLength(0)
})
