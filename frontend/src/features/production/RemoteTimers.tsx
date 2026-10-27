import { useEffect, useRef, useState } from 'react'
import { productionRpc } from '../../services/liveProduction'
import type { NoticesConnection } from './PhaseNotices'

interface Timer {key:string;operatorId:string;name:string;kind:'vehicle'|'cleaning'|'coffee';jobId?:string;phaseId?:string;plate?:string;startedAt:string}
interface Report {serverNow:string;canStop:boolean;timers:Timer[]}
const activity=(t:Timer)=>t.kind==='vehicle'?t.plate??'Vettura':t.kind==='cleaning'?'Pulizie':'Pausa caffè'

export function RemoteTimers({connection,onBack}:{connection:NoticesConnection;onBack:()=>void}){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [selected,setSelected]=useState<Timer[]>([]),[password,setPassword]=useState(''),[busy,setBusy]=useState(false)
 const lock=useRef(false),generation=useRef(0)
 const {companyId,session,config}=connection
 useEffect(()=>{
  let disposed=false;let timer:ReturnType<typeof setTimeout>
  setReport(null);setSelected([]);setPassword('');setError('')
  async function poll(){
   if(!lock.current&&!document.hidden){
    const id=++generation.current
    try{
     const next=await productionRpc<Report>('production_open_timers',{p_company_id:companyId},session,config)
     if(!disposed&&id===generation.current){setReport(next);setError('')}
    }catch(e){if(!disposed&&id===generation.current){setReport(null);setError(e instanceof Error?e.message:'Timer non aggiornati.')}}
   }
   if(!disposed)timer=setTimeout(poll,5000)
  }
  void poll()
  const hide=()=>{if(document.hidden)setPassword('')}
  document.addEventListener('visibilitychange',hide)
  return()=>{disposed=true;generation.current++;clearTimeout(timer);document.removeEventListener('visibilitychange',hide)}
 },[companyId,session.accessToken,config.url,config.anonKey])
 async function stop(){
  if(lock.current||!password||!selected.length)return
  lock.current=true;generation.current++;setBusy(true);setError('');setMessage('')
  try{
   const unlocked=await productionRpc<{ok:boolean;message?:string}>('production_private_password',{p_company_id:companyId,p_action:'unlock',p_password:password},session,config)
   if(!unlocked.ok)throw Error(unlocked.message||'Password dei blocchi non corretta.')
   const next=await productionRpc<{stoppedCount:number;report:Report}>('production_stop_timers',{p_company_id:companyId,p_keys:selected.map(t=>t.key)},session,config)
   setReport(next.report);setSelected([])
   setMessage(next.stoppedCount? `Fermati ${next.stoppedCount} timer. Ore conservate; lavorazioni non completate.`:'I timer selezionati erano già fermi. Nessun nuovo timer è stato interrotto.')
  }catch(e){setError(e instanceof Error?e.message:'Arresto non confermato. Aggiorna la lista e verifica prima di riprovare.')}
  finally{generation.current++;lock.current=false;setBusy(false);setPassword('')}
 }
 return <section className="panel" aria-label="Timer attivi">
  <div className="panel-head"><h2>Timer attivi · controllo dal PC</h2><button disabled={busy} onClick={onBack}>← Programma operatori</button></div>
  <p>Ferma i timer anche se il tablet non risponde. Il tempo viene registrato fino al momento dello stop; la lavorazione resta aperta e l’operatore potrà riprenderla con Start.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {!report&&!error&&<p>Caricamento timer…</p>}
  {report&&<>
   <p>Aggiornato alle {new Date(report.serverNow).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome'})}. Sono inclusi anche i timer iniziati nei giorni precedenti.</p>
   {!report.timers.length&&<p>Nessun timer attivo.</p>}
   <div className="table-wrap"><table><thead><tr><th>Operatore</th><th>Attività / vettura</th><th>Avviato</th><th>Azione</th></tr></thead><tbody>
    {report.timers.map(t=><tr key={t.key}><td>{t.name}</td><td>{activity(t)}</td><td>{new Date(t.startedAt).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}</td><td>{report.canStop&&<button disabled={busy} onClick={()=>{setSelected([t]);setPassword('');setMessage('')}}>Ferma timer di {t.name}</button>}</td></tr>)}
   </tbody></table></div>
   {report.canStop&&!!report.timers.length&&<button disabled={busy} onClick={()=>{setSelected([...report.timers]);setPassword('');setMessage('')}}>Ferma tutti i timer visualizzati</button>}
   {!report.canStop&&<p>Solo il titolare può fermare i timer.</p>}
  </>}
  {!!selected.length&&<form onSubmit={e=>{e.preventDefault();void stop()}}>
   <h3>Timer da fermare</h3><ul>{selected.map(t=><li key={t.key}>{t.name} · {activity(t)}</li>)}</ul>
   <p>Lo stop avviene adesso. Per correggere ore registrate in eccesso usa Monte ore giornaliero → Correggi ore con password. Le fasi non vengono firmate o completate.</p>
   <label>Password dei blocchi<input type="password" autoComplete="current-password" required disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <button className="primary" disabled={busy||!password}>{busy?'Arresto…':'Conferma stop dei timer selezionati'}</button>
   <button type="button" disabled={busy} onClick={()=>{setSelected([]);setPassword('')}}>Annulla</button>
  </form>}
 </section>
}
