import type { ErpData } from '../types'
import type { CloudAuthConfig, CloudAuthSession } from './cloudAuth'
import { CloudSyncRequestError } from './cloudSync'
import { authenticatedCloudFetch } from './cloudSession'

/** Read-only publication input, deliberately separate from the editable archive. */
export interface ProductionArchiveSnapshot {
 companyId:string; revision:number; updatedAt:string
 payload:Pick<ErpData,'plannerSettings'|'jobs'>
}
const cached=new Map<string,ProductionArchiveSnapshot>()
const pending=new Map<string,Promise<ProductionArchiveSnapshot|null>>()
export function clearProductionArchiveCache(){cached.clear();pending.clear()}
export async function loadProductionArchive(companyId:string,session:Pick<CloudAuthSession,'accessToken'>&{userId?:string},config:CloudAuthConfig,force=false,fetcher:typeof fetch=fetch):Promise<ProductionArchiveSnapshot|null>{
 const key=`${config.url}|${companyId}|${session.userId??session.accessToken}`
 const running=pending.get(key)
 if(running)return running
 const read=async(select:string)=>{
  const query=new URLSearchParams({company_id:`eq.${companyId}`,select,limit:'1'})
  const response=await authenticatedCloudFetch(`${config.url}/rest/v1/erp_snapshots?${query}`,{headers:{apikey:config.anonKey,Authorization:`Bearer ${session.accessToken}`},cache:'no-store'},session,config,fetcher)
  if(!response.ok)throw new CloudSyncRequestError(`Lettura lavori per i tablet non riuscita (errore ${response.status}).`,response.status)
  return (await response.json() as Array<{company_id:string;revision:number;updated_at?:string;jobs?:ErpData['jobs'];planner_settings?:ErpData['plannerSettings']}>)[0]
 }
 const task=(async()=>{
  const previous=cached.get(key)
  if(previous&&!force){
   const version=await read('company_id,revision')
   if(!version){cached.delete(key);return null}
   if(version.company_id!==companyId)throw new Error('Archivio di produzione non valido.')
   if(Number(version.revision)===previous.revision)return previous
  }
  const row=await read('company_id,revision,updated_at,jobs:payload->jobs,planner_settings:payload->plannerSettings')
  if(!row){cached.delete(key);return null}
  if(row.company_id!==companyId||!row.planner_settings||!Array.isArray(row.jobs)||!Number.isFinite(Number(row.revision)))throw new Error('Archivio di produzione non valido.')
  const snapshot:ProductionArchiveSnapshot={companyId,revision:Number(row.revision),updatedAt:String(row.updated_at??''),payload:{jobs:row.jobs,plannerSettings:row.planner_settings}}
  cached.set(key,snapshot)
  if(cached.size>4)cached.delete(cached.keys().next().value!)
  return snapshot
 })()
 pending.set(key,task)
 try{return await task}finally{if(pending.get(key)===task)pending.delete(key)}
}
