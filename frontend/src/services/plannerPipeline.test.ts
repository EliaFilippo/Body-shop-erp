import { describe,it,expect } from 'vitest'
import { emptyData } from './erp'
import { createEstimate,approveEstimateAndCreateJob } from './workflow'
import { generateOperatorPrograms } from './planner'
import type { ErpData, Vehicle } from '../types'

function fixture(count=4) {
 let data:ErpData=structuredClone(emptyData)
 data.plannerSettings={...data.plannerSettings,workingDays:[1,2,3,4,5],efficiencyPercent:100,safetyMarginPercent:0,holidays:[],closures:[],absences:[],
 operators:[
 {id:'wash',name:'Lavaggio',active:true,dailyHours:8,hourlyCost:20,skillsConfigured:true,skills:['Lavaggio esterno']},
 {id:'prep',name:'Preparazione',active:true,dailyHours:8,hourlyCost:20,skillsConfigured:true,skills:['Stuccatura']},
 {id:'mask',name:'Incartatore',active:true,dailyHours:8,hourlyCost:20,skillsConfigured:true,skills:['Incartatura','Scartatura']},
 {id:'paint',name:'Verniciatore',active:true,dailyHours:8,hourlyCost:40,skillsConfigured:true,skills:['Verniciatura']},
 ]}
 for(let n=0;n<count;n++){
  data=createEstimate(data,{customerId:'c',plate:'CAR'+String(n).padStart(4,'0'),companyName:'',contactName:'',date:'2026-10-26',requestedDeliveryDate:'2026-11-10',notes:'',selectedPhases:['Lavaggio esterno'],lines:[{
   description:'Ripristino',standardWorkName:'Verniciatura',category:'verniciatura',quantity:1,unitPrice:600,discount:0,vatRate:22,estimatedMinutes:90,
   manualPhaseTimes:[{phase:'Verniciatura',minutes:60},{phase:'Incartatura',minutes:20},{phase:'Scartatura',minutes:10}],
  }]})
  data=approveEstimateAndCreateJob(data,data.estimates![0].id)
  const job=data.jobs![0]
  const vehicleId='car-'+n
  job.vehicleId=vehicleId
  data.vehicles.push({id:vehicleId,customerId:'c',plate:job.plate,make:'',model:'',color:'',year:'',vin:'',mileage:'',status:'Accettata',coneNumber:n+1,priority:'Normale',deliveryDate:'2026-11-10',estimatedHours:2,workedHours:0,plannedEntryDate:'2026-10-26',requestedDeliveryDate:'2026-11-10',calculatedDeliveryDate:'',expectedRevenue:600,expectedMargin:300,partsStatus:'Disponibili',blockReason:'',manualPlanningDate:'',createdAt:'2026-10-25T08:00:00Z'} as Vehicle)
 }
 data.jobs=data.jobs!.map(j=>({...j,entryDate:'2026-10-26',expectedDeliveryDate:'2026-11-10'}))
 return data
}
describe('giornata completa di lavoro prevista',()=>{
 it('programma le fasi successive per tutti i mestieri senza completare realmente le fasi',()=>{
  const data=fixture()
  const before=JSON.stringify(data)
  const result=generateOperatorPrograms(data,'2026-10-26','test','2026-10-26T06:00:00Z')
  for(const id of ['wash','prep','mask','paint'])expect(result.programs.filter(p=>p.operatorId===id).flatMap(p=>p.tasks).length,id).toBeGreaterThan(0)
  const tasks=result.programs.flatMap(p=>p.tasks)
  for(const job of data.jobs!){
   const own=tasks.filter(t=>t.jobId===job.id)
   const prep=own.find(t=>t.phaseName==='Stuccatura')!
   const mask=own.find(t=>t.phaseName==='Incartatura')!
   const paint=own.find(t=>t.phaseName==='Verniciatura')!
   const unwrap=own.find(t=>t.phaseName==='Scartatura')!
   expect(prep.endAt<=mask.startAt).toBe(true)
   expect(mask.endAt<=paint.startAt).toBe(true)
   expect(new Date(unwrap.startAt).getTime()-new Date(paint.endAt).getTime()).toBeGreaterThanOrEqual(3600000)
   expect(own.filter(t=>['Stuccatura','Verniciatura'].includes(t.phaseName)).reduce((sum,t)=>sum+t.plannedMinutes,0)).toBe(60)
  }
  expect(JSON.stringify(data)).toBe(before)
  for(const program of result.programs)for(let i=1;i<program.tasks.length;i++)expect(program.tasks[i].startAt>=program.tasks[i-1].endAt).toBe(true)
 })
 it('non assegna fasi a chi non ha la mansione e non forza lavori bloccati',()=>{
  const data=fixture(1)
  data.plannerSettings.operators.push({id:'none',name:'Non abilitato',active:true,dailyHours:8,skillsConfigured:true,skills:['Meccanica / gommista']})
  data.jobs![0].blocks=['Ricambi mancanti']
  const tasks=generateOperatorPrograms(data,'2026-10-26','test','2026-10-26T06:00:00Z').programs.flatMap(p=>p.tasks)
  expect(tasks).toHaveLength(0)
 })
})

it('prosegue nei turni successivi conservando tutti i minuti tecnici',()=>{
 const data=fixture(1)
 const job=data.jobs![0]
 job.phases=job.phases.map(p=>p.sharedTimeKey==='v'?{...p,sharedTimeMinutes:1200,estimatedMinutes:p.name==='Stuccatura'?1200:0}:p)
 const result=generateOperatorPrograms(data,'2026-10-26','test','2026-10-26T06:00:00Z')
 const tasks=result.programs.flatMap(p=>p.tasks).filter(t=>t.jobId===job.id)
 expect(tasks.filter(t=>['Stuccatura','Verniciatura'].includes(t.phaseName)).reduce((sum,t)=>sum+t.plannedMinutes,0)).toBe(1200)
 expect(new Set(tasks.map(t=>t.startAt.slice(0,10))).size).toBeGreaterThan(1)
 expect(tasks.every(t=>t.startAt.slice(0,10)===t.endAt.slice(0,10))).toBe(true)
})

it('due colleghi non moltiplicano un tempo condiviso dispari',()=>{
 const data=fixture(1)
 data.plannerSettings.operators.push({id:'prep2',name:'Seconda preparazione',active:true,dailyHours:8,hourlyCost:20,skillsConfigured:true,skills:['Stuccatura']})
 data.jobs![0].phases=data.jobs![0].phases.map(p=>p.sharedTimeKey==='v'?{...p,sharedTimeMinutes:61,estimatedMinutes:p.name==='Stuccatura'?61:0,supportOperatorId:p.name==='Stuccatura'?'prep2':undefined}:p)
 const tasks=generateOperatorPrograms(data,'2026-10-26','test','2026-10-26T06:00:00Z').programs.flatMap(p=>p.tasks)
 expect(tasks.filter(t=>['Stuccatura','Verniciatura'].includes(t.phaseName)).reduce((sum,t)=>sum+t.plannedMinutes,0)).toBe(61)
 expect(tasks.filter(t=>t.phaseName==='Stuccatura')).toHaveLength(2)
})
