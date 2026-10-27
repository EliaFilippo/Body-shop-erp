import { describe,expect,it } from 'vitest'
import { paintFlowPriority } from './paintFlowPriority'
import type { JobPhase,RepairJob } from '../types'
const phase=(name:string,status:JobPhase['status']='Da fare'):JobPhase=>({id:name,name,status,notRequired:false,estimatedMinutes:20,actualMinutes:0,notes:'',blockedReason:'',operatorAssignments:[]})
const job=(phases:JobPhase[])=>({phases} as RepairJob)
describe('paint flow precedence',()=>{
 it('distinguishes actual finished painting from a virtual forecast and leaves unrelated masking ordinary',()=>{
  const unmask=phase('Scartatura'),pending=job([phase('Verniciatura'),unmask])
  const painted=job([phase('Verniciatura','Completata'),unmask])
  expect(paintFlowPriority(painted,unmask,painted).rank).toBe(0)
  expect(paintFlowPriority(painted,unmask,pending).rank).toBe(1)
  const masking=phase('Incartatura')
  expect(paintFlowPriority(job([masking]),masking).rank).toBe(5)
  expect(paintFlowPriority(job([masking,phase('Verniciatura')]),masking).rank).toBe(3)
 })
 it('continues a task already running before changing the queued work',()=>{
  const active=phase('Lavaggio interni','In lavorazione')
  active.operatorAssignments=[{id:'a',operatorName:'Davide',activityStatus:'Attivo',startedAt:'2026-10-27T08:00:00Z',workedMinutes:10}]
  expect(paintFlowPriority(job([active]),active).rank).toBe(-1)
 })
})
