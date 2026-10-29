import {useEffect,useRef} from 'react'
import type {CloudAuthConfig,CloudAuthSession} from '../services/cloudAuth'
import {CLOUD_SESSION_EVENT,ensureCloudSession,isCloudSessionClosed,readUserSession} from '../services/cloudSession'
export function useCloudSessionRenewal(session:CloudAuthSession|null,config:CloudAuthConfig|null,onRenew:(session:CloudAuthSession)=>void,onClosed?:()=>void) {
 const latest=useRef(session);latest.current=session
 const callback=useRef(onRenew);callback.current=onRenew
 const closed=useRef(onClosed);closed.current=onClosed
 const userId=session?.userId
 useEffect(()=>{
  if(!userId||!config)return
  let stopped=false,running=false
  const adopt=()=>{if(!stopped&&isCloudSessionClosed(userId,config)){closed.current?.();return}const stored=readUserSession(userId,config);if(!stopped&&stored&&stored.userId===latest.current?.userId&&stored.accessToken!==latest.current.accessToken)callback.current(stored)}
  const renew=async()=>{
   if(stopped||running||document.hidden||latest.current?.userId!==userId)return
   running=true
   try{const next=await ensureCloudSession(latest.current,config);if(!stopped&&latest.current?.userId===next.userId&&latest.current.accessToken!==next.accessToken)callback.current(next)}
   catch{/* Preserve local work on connection failures. Each request also refreshes before sending. */}
   finally{running=false}
  }
  void renew()
  const timer=setInterval(()=>void renew(),30000)
  const resume=()=>{adopt();void renew()}
  window.addEventListener('online',resume);window.addEventListener('focus',resume)
  window.addEventListener('storage',adopt);window.addEventListener(CLOUD_SESSION_EVENT,adopt)
  document.addEventListener('visibilitychange',resume)
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener('online',resume);window.removeEventListener('focus',resume);window.removeEventListener('storage',adopt);window.removeEventListener(CLOUD_SESSION_EVENT,adopt);document.removeEventListener('visibilitychange',resume)}
 },[userId,config?.url])
}
