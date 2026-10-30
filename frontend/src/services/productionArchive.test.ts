import {beforeEach,describe,expect,it,vi} from 'vitest'
import {clearProductionArchiveCache,loadProductionArchive} from './productionArchive'
import {emptyData} from './erp'
const config={url:'https://project.supabase.co',anonKey:'public'},session={accessToken:'token',userId:'owner'}
const row=(revision=7)=>({company_id:'company',revision,jobs:[],planner_settings:structuredClone(emptyData.plannerSettings)})
beforeEach(()=>clearProductionArchiveCache())
describe('lightweight read-only production publication archive',()=>{
 it('reads only jobs and settings and reuses them only after checking the authoritative revision',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json([row()])).mockResolvedValueOnce(Response.json([{company_id:'company',revision:7}]))
  const first=await loadProductionArchive('company',session,config,false,fetcher)
  const next=await loadProductionArchive('company',session,config,false,fetcher)
  expect(next).toBe(first)
  const query=(n:number)=>new URL(String(fetcher.mock.calls[n][0])).searchParams.get('select')
  expect(query(0)).toContain('jobs:payload->jobs')
  expect(query(0)).not.toMatch(/operatorProgramHistory|photos|,payload,/)
  expect(query(1)).toBe('company_id,revision')
  expect(fetcher.mock.calls[1][1]).toMatchObject({cache:'no-store'})
 })
 it('reloads changed revisions, deduplicates simultaneous reads, and isolates other users',async()=>{
  const fetcher=vi.fn().mockImplementation(async()=>Response.json([row()]))
  await Promise.all([loadProductionArchive('company',session,config,false,fetcher),loadProductionArchive('company',session,config,false,fetcher)])
  expect(fetcher).toHaveBeenCalledTimes(1)
  fetcher.mockResolvedValueOnce(Response.json([{company_id:'company',revision:8}])).mockResolvedValueOnce(Response.json([row(8)]))
  expect((await loadProductionArchive('company',session,config,false,fetcher))?.revision).toBe(8)
  await loadProductionArchive('company',{...session,userId:'other'},config,false,fetcher)
  expect(new URL(String(fetcher.mock.calls[3][0])).searchParams.get('select')).toContain('jobs:payload->jobs')
 })
 it('never serves an old cached archive after access is denied or the row disappears',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json([row()])).mockResolvedValueOnce(new Response('{}',{status:403})).mockResolvedValueOnce(Response.json([]))
  await loadProductionArchive('company',session,config,false,fetcher)
  await expect(loadProductionArchive('company',session,config,false,fetcher)).rejects.toThrow('403')
  expect(await loadProductionArchive('company',session,config,false,fetcher)).toBeNull()
 })
})
