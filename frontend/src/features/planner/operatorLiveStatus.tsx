import { useEffect, useState } from 'react'
import { productionRpc } from '../../services/liveProduction'
import type { NoticesConnection } from '../production/PhaseNotices'

export interface RunningTask {operatorId:string;jobId:string;phaseId:string;remainingSeconds:number|null;overrunSeconds:number}
export function useOperatorStatus(connection?:NoticesConnection) {
 const [running,setRunning]=useState<RunningTask[]>([])
 const [message,setMessage]=useState('')
 useEffect(()=>{
  let stopped=false
  let timer:ReturnType<typeof setTimeout>
  setRunning([])
  if(!connection){setMessage('Stato in tempo reale non disponibile: collega il gestionale al cloud.');return}
  const {companyId,session,config}=connection
  async function poll(){
   try{
    const report=await productionRpc<{running:RunningTask[]}>('production_operator_status',{p_company_id:companyId},session,config)
    if(!stopped){setRunning(report.running);setMessage('')}
   }catch{if(!stopped){setRunning([]);setMessage('Stato dei timer non aggiornato. Verifica la connessione e l’attivazione dell’aggiornamento su Supabase.')}}
   if(!stopped)timer=setTimeout(poll,5000)
  }
  void poll()
  const stale=setInterval(()=>{if(document.hidden){setRunning([]);setMessage('Aggiornamento dei timer in attesa.')}},5000)
  return()=>{stopped=true;clearTimeout(timer);clearInterval(stale)}
 },[connection?.companyId,connection?.session.accessToken,connection?.config.url,connection?.config.anonKey])
 return {running,message}
}
export function RunningTaskCard({task,plate,phase,cone}:{task:RunningTask;plate:string;phase:string;cone?:number|null}) {
 const state=task.remainingSeconds===null?'unknown':task.overrunSeconds>0?'late':'on-time'
 return <div className={`day-job operator-live ${state}`} aria-label={`Lavoro attivo ${plate}`}>
  <strong>{state==='late'?'Fuori tempo':state==='on-time'?'In lavorazione · nei tempi':'In lavorazione · tempo da configurare'}</strong>
  <strong>{cone!=null?`Cono ${cone} · `:''}{plate}</strong><span>{phase}</span>
  {state==='late'&&<small>Ritardo: {Math.ceil(task.overrunSeconds/60)} min</small>}
  {state==='on-time'&&<small>Residuo: {Math.ceil(task.remainingSeconds!/60)} min</small>}
 </div>
}
