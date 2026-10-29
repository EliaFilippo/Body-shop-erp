import type { CloudAuthConfig, CloudAuthSession } from './cloudAuth'
export const CLOUD_SESSION_KEY='body-shop-erp.cloud-session.v1'
export const CLOUD_SESSION_EVENT='elias-cloud-session-updated'
export type SessionSurface='office'|'production'
const prefix=(config:CloudAuthConfig)=>`${CLOUD_SESSION_KEY}:${config.url}`
const userKey=(config:CloudAuthConfig,user:string)=>`${prefix(config)}:user:${user}`
const logoutKey=(config:CloudAuthConfig,user:string)=>`${prefix(config)}:logout:${user}`
const pointerKey=(config:CloudAuthConfig,surface:SessionSurface)=>`${prefix(config)}:last:${surface}`
const pinRequiredKey='body-shop-erp.force-pin-login'
export const isCloudSessionClosed=(user:string,config:CloudAuthConfig)=>Boolean(localStorage.getItem(logoutKey(config,user)))
type TimedSession=CloudAuthSession & {expiresAt?:number}
function parse(raw:string|null):TimedSession|null {
 try {const s=JSON.parse(raw??'null');return s?.accessToken&&s?.userId&&typeof s.refreshToken==='string'?s:null}catch{return null}
}
function expiresAt(s:TimedSession):number {
 if(Number.isFinite(s.expiresAt))return s.expiresAt!
 try {const part=s.accessToken.split('.')[1];const value=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));if(Number.isFinite(value.exp))return value.exp*1000}catch{/* Legacy session metadata is migrated on first use. */}
 return Date.now()+Math.max(0,s.expiresIn??0)*1000
}
export function persistCloudSession(s:CloudAuthSession,surface:SessionSurface,config:CloudAuthConfig) {
 const stored={...s,expiresAt:expiresAt(s)}
 localStorage.setItem(userKey(config,s.userId),JSON.stringify(stored))
 localStorage.removeItem(logoutKey(config,s.userId))
 localStorage.setItem(pointerKey(config,surface),s.userId)
 sessionStorage.setItem(CLOUD_SESSION_KEY,JSON.stringify(stored))
 if(surface==='production')sessionStorage.removeItem(pinRequiredKey)
 window.dispatchEvent(new CustomEvent(CLOUD_SESSION_EVENT,{detail:{userId:s.userId}}))
}
export function readUserSession(user:string,config:CloudAuthConfig):TimedSession|null {
 const stored=parse(localStorage.getItem(userKey(config,user)))
 return stored?.userId===user?stored:null
}
export function readStoredCloudSession(surface:SessionSurface,config:CloudAuthConfig):TimedSession|null {
 if(surface==='production'&&sessionStorage.getItem(pinRequiredKey))return null
 const tab=parse(sessionStorage.getItem(CLOUD_SESSION_KEY))
 const user=tab?.userId??localStorage.getItem(pointerKey(config,surface))
 if(!user||localStorage.getItem(logoutKey(config,user)))return null
 const stored=readUserSession(user,config)
 if(stored){sessionStorage.setItem(CLOUD_SESSION_KEY,JSON.stringify(stored));return stored}
 if(tab){persistCloudSession(tab,surface,config);return readUserSession(user,config)}
 return null
}
export function clearCloudSession(user:string,config:CloudAuthConfig) {
 localStorage.setItem(logoutKey(config,user),crypto.randomUUID())
 localStorage.removeItem(userKey(config,user))
 for(const surface of ['office','production'] as const)if(localStorage.getItem(pointerKey(config,surface))===user)localStorage.removeItem(pointerKey(config,surface))
 if(parse(sessionStorage.getItem(CLOUD_SESSION_KEY))?.userId===user)sessionStorage.removeItem(CLOUD_SESSION_KEY)
 window.dispatchEvent(new CustomEvent(CLOUD_SESSION_EVENT,{detail:{userId:user}}))
}
export function requireTabletPin(){sessionStorage.setItem(pinRequiredKey,'1');sessionStorage.removeItem(CLOUD_SESSION_KEY)}
export class CloudSessionExpiredError extends Error { constructor(message='Occorre confermare nuovamente l’accesso. I dati e i timer sono conservati.'){super(message);this.name='CloudSessionExpiredError'} }
const inFlight=new Map<string,Promise<CloudAuthSession>>()
async function refreshLock<T>(key:string,task:()=>Promise<T>):Promise<T> {
 if(navigator.locks?.request)return navigator.locks.request(key,task)
 const leaseKey=`${key}:lease`,owner=crypto.randomUUID(),deadline=Date.now()+12000
 while(Date.now()<deadline){
  let lease:{owner:string;until:number}|null=null
  try{lease=JSON.parse(localStorage.getItem(leaseKey)??'null')}catch{/* Ignore an incomplete lease. */}
  if(!lease||lease.until<Date.now()){
   localStorage.setItem(leaseKey,JSON.stringify({owner,until:Date.now()+15000}))
   if(JSON.parse(localStorage.getItem(leaseKey)??'{}').owner===owner){
    try{return await task()}finally{if(JSON.parse(localStorage.getItem(leaseKey)??'{}').owner===owner)localStorage.removeItem(leaseKey)}
   }
  }
  await new Promise(resolve=>setTimeout(resolve,50))
 }
 throw new Error('Rinnovo accesso in corso. Il collegamento riproverà automaticamente.')
}
export async function ensureCloudSession(session:CloudAuthSession,config:CloudAuthConfig,fetcher:typeof fetch=fetch,force=false):Promise<CloudAuthSession> {
 const key=`elias-auth-refresh:${config.url}:${session.userId}`
 const existing=inFlight.get(key)
 if(existing){const shared=await existing;if(!force||shared.accessToken!==session.accessToken)return shared;if(inFlight.get(key)===existing)inFlight.delete(key);return ensureCloudSession(shared,config,fetcher,true)}
 const task=refreshLock(key,async()=>{
  if(localStorage.getItem(logoutKey(config,session.userId)))throw new Error('Accesso chiuso su questo dispositivo.')
  const current=readUserSession(session.userId,config)??session
  // Another tab may already have replaced the rejected token.
  if((!force||current.accessToken!==session.accessToken)&&expiresAt(current)>Date.now()+60000)return current
  if(!current.refreshToken)throw new CloudSessionExpiredError()
  const response=await fetcher(`${config.url}/auth/v1/token?grant_type=refresh_token`,{
   method:'POST',headers:{apikey:config.anonKey,'Content-Type':'application/json'},
   body:JSON.stringify({refresh_token:current.refreshToken}),signal:AbortSignal.timeout(10000),
  })
  const payload=await response.json()
  const newest=readUserSession(session.userId,config)
  if(localStorage.getItem(logoutKey(config,session.userId)))throw new Error('Accesso chiuso su questo dispositivo.')
  if(newest&&newest.refreshToken!==current.refreshToken)return newest
  if(!response.ok||!payload.access_token||payload.user?.id!==session.userId){
   if([400,401,403].includes(response.status))throw new CloudSessionExpiredError()
   throw new Error('Collegamento temporaneamente non disponibile. Il rinnovo dell’accesso riproverà automaticamente.')
  }
  const renewed:TimedSession={...current,accessToken:payload.access_token,refreshToken:payload.refresh_token??current.refreshToken,expiresIn:payload.expires_in??3600,expiresAt:Date.now()+(payload.expires_in??3600)*1000}
  localStorage.setItem(userKey(config,session.userId),JSON.stringify(renewed))
  if(parse(sessionStorage.getItem(CLOUD_SESSION_KEY))?.userId===session.userId)sessionStorage.setItem(CLOUD_SESSION_KEY,JSON.stringify(renewed))
  window.dispatchEvent(new CustomEvent(CLOUD_SESSION_EVENT,{detail:{userId:session.userId}}))
  return renewed
 })
 inFlight.set(key,task)
 try{return await task}finally{if(inFlight.get(key)===task)inFlight.delete(key)}
}
/** Refresh before requests; retry an authentication rejection once, never a save timeout. */
export async function authenticatedCloudFetch(url:string,init:RequestInit,session:Pick<CloudAuthSession,'accessToken'>,config:CloudAuthConfig,fetcher:typeof fetch=fetch):Promise<Response> {
 if(new URL(url).origin!==new URL(config.url).origin)throw new Error('Destinazione cloud non valida.')
 const full=session as CloudAuthSession
 const canRefresh=Boolean(full.userId&&full.refreshToken)
 let current=canRefresh?await ensureCloudSession(full,config,fetcher):session
 const send=(token:string)=>{
  const values=Object.fromEntries(new Headers(init.headers).entries());delete values.authorization;delete values.apikey
  return fetcher(url,{...init,headers:{...values,apikey:config.anonKey,Authorization:`Bearer ${token}`}})
 }
 let response=await send(current.accessToken)
 if(response.status===401&&canRefresh){current=await ensureCloudSession(current as CloudAuthSession,config,fetcher,true);response=await send(current.accessToken)}
 return response
}
