import {describe,it,expect} from 'vitest'
import {emptyData} from './erp'
import {applyProductionPlanningState,type ProductionPlanningState} from './productionPlanningState'
import type {RepairJob} from '../types'
const fixture=()=>({...structuredClone(emptyData),jobs:[{id:'j',number:'COMM-1',customerId:'c',plate:'AA111AA',coneNumber:1,entryDate:'2026-10-27',expectedDeliveryDate:'2026-10-28',priority:'Normale',responsible:'',status:'Pianificata',companyName:'',contactName:'',notes:'',blocks:[],lines:[],qualityChecklist:[],taxableAmount:100,vatAmount:22,total:122,progressPercent:0,createdAt:'',updatedAt:'',history:[],phases:[{id:'p',name:'Lattoneria',status:'Da fare',operatorAssignments:[],estimatedMinutes:60,actualMinutes:0,notes:'',blockedReason:''}]} satisfies RepairJob]})
const state:ProductionPlanningState={serverNow:'2026-10-27T08:15:00Z',entries:[{jobId:'j',phaseId:'p',operatorId:'a',operatorName:'Mario',closedSeconds:600,runningSince:'2026-10-27T08:10:00Z',firstStartedAt:'2026-10-27T07:00:00Z',lastEndedAt:'2026-10-27T07:10:00Z'}]}
describe('canonical operational replanning',()=>{
 it('imports actual running work without completing, signing or changing the technical allowance',()=>{
  const data=fixture(),before=JSON.stringify(data),next=applyProductionPlanningState(data,state),phase=next.jobs![0].phases[0]
  expect(phase.status).toBe('In lavorazione')
  expect(phase.estimatedMinutes).toBe(60)
  expect(phase.completedAt).toBeUndefined()
  expect(phase.operatorAssignments[0]).toMatchObject({id:'tablet:a',startedAt:state.entries[0].runningSince,workedMinutes:10,activityStatus:'Attivo'})
  expect(JSON.stringify(data)).toBe(before)
  expect(applyProductionPlanningState(next,state)).toBe(next)
 })
 it('imports a pause as concluded timer, never as completed phase, and preserves manual history',()=>{
  const data=fixture()
  data.jobs[0].phases[0].operatorAssignments=[{id:'manual',operatorName:'Altro',startedAt:'2026-10-26T08:00:00Z',endedAt:'2026-10-26T08:05:00Z',workedMinutes:5,activityStatus:'Concluso'}]
  const paused={...state,entries:[{...state.entries[0],runningSince:null,closedSeconds:900,lastEndedAt:state.serverNow}]}
  const next=applyProductionPlanningState(data,paused),phase=next.jobs![0].phases[0]
  expect(phase.status).not.toBe('Completata')
  expect(phase.operatorAssignments).toHaveLength(2)
  expect(phase.operatorAssignments[1]).toMatchObject({workedMinutes:15,endedAt:state.serverNow,activityStatus:'Concluso'})
 })
 it('never overwrites the signed phase',()=>{
  const data=fixture();data.jobs[0].phases[0].status='Completata';data.jobs[0].phases[0].completedByName='Firmato'
  expect(applyProductionPlanningState(data,state).jobs![0].phases[0]).toBe(data.jobs[0].phases[0])
 })
})
