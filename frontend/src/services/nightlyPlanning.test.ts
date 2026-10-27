import {describe,it,expect,vi} from 'vitest'
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
