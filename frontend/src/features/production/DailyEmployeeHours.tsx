import { useEffect, useRef, useState } from 'react'
import { productionRpc } from '../../services/liveProduction'
import type { NoticesConnection } from './PhaseNotices'
import './dailyEmployeeHours.css'

type Kind='vehicle'|'cleaning'|'coffee'|'other'
export interface HourEntry {kind:Kind;jobId:string|null;phaseId?:string;plate?:string;number?:string;phase?:string;startedAt:string;endedAt:string;seconds:number;running:boolean}
interface HourAdjustment {id:string;kind:Kind;jobId:string|null;plate?:string;number?:string;seconds:number;reason:string;actorId:string;createdAt:string}
interface EmployeeDay {operatorId:string;name:string;vehicleSeconds:number;cleaningSeconds:number;coffeeSeconds:number;otherSeconds:number;totalSeconds:number;ordinarySeconds:number|null;extraSeconds:number|null;entries:HourEntry[];adjustments:HourAdjustment[]}
export interface DailyHoursReport {day:string;serverNow:string;canAdjust:boolean;operators:EmployeeDay[];jobs:{id:string;plate:string;number:string}[]}
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export const hourLabel=(s:number|null)=>s===null?'Da configurare':`${Math.floor(Math.abs(s)/3600)} h ${String(Math.floor(Math.abs(s)/60)%60).padStart(2,'0')} min`
const kindLabel=(kind:Kind)=>({vehicle:'Vettura',cleaning:'Pulizie',coffee:'Pausa caffè',other:'Altre ore lavorate'})[kind]
const time=(value:string)=>new Date(value).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'})
interface Correction {operatorId:string;kind:Kind;jobId:string|null;deltaMinutes:number;reason:string;password:string;requestId:string}

export function DailyEmployeeHours({connection,onBack}:{connection:NoticesConnection;onBack?:()=>void}){
 const [day,setDay]=useState(today),[name,setName]=useState('')
 const [report,setReport]=useState<DailyHoursReport|null>(null),[error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 const generation=useRef(0),mutating=useRef(false)
 const {companyId,session,config}=connection
 useEffect(()=>{
  let stopped=false;let timer:ReturnType<typeof setTimeout>
  generation.current++;setReport(null);setError('')
  async function poll(){
   if(!mutating.current&&!document.hidden){
    const id=++generation.current
    try{
     const next=await productionRpc<DailyHoursReport>('production_daily_hours',{p_company_id:companyId,p_day:day},session,config)
     if(!stopped&&id===generation.current){setReport(next);setError('')}
    }catch(e){if(!stopped&&id===generation.current)setError(e instanceof Error?e.message:'Monte ore non aggiornato.')}
   }
   if(!stopped)timer=setTimeout(poll,5000)
  }
  void poll();return()=>{stopped=true;generation.current++;clearTimeout(timer)}
 },[companyId,day,session.accessToken,config.url,config.anonKey])
 function move(days:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);setDay(d.toISOString().slice(0,10))}
 async function correct(c:Correction){
  if(mutating.current)throw Error('Attendi il salvataggio in corso.')
  mutating.current=true;setBusy(true);generation.current++
  try{
   const unlocked=await productionRpc<{ok:boolean;message?:string}>('production_private_password',{p_company_id:companyId,p_action:'unlock',p_password:c.password},session,config)
   if(!unlocked.ok)throw Error(unlocked.message||'Password dei blocchi non corretta.')
   const next=await productionRpc<DailyHoursReport>('production_adjust_hours',{p_company_id:companyId,p_operator_id:c.operatorId,p_day:day,p_kind:c.kind,p_job_id:c.jobId,p_delta_minutes:c.deltaMinutes,p_reason:c.reason,p_request_id:c.requestId},session,config)
   generation.current++;setReport(next);setError('')
  }finally{generation.current++;mutating.current=false;setBusy(false)}
 }
 const current=report?.day===day?report:null
 const employees=current?.operators.filter(o=>o.name.toLocaleLowerCase('it-IT').includes(name.trim().toLocaleLowerCase('it-IT')))??[]
 return <section className="daily-hours" aria-label="Monte ore giornaliero">
  <div className="panel-head"><div><span className="eyebrow">MONTE ORE GIORNALIERO</span><h2>Chi ha lavorato, dove e per quanto</h2></div>{onBack&&<button onClick={onBack} disabled={busy}>← Programma operatori</button>}</div>
  <p>Totale lavorato = vetture + pulizie + altre ore lavorate. La pausa caffè è indicata separatamente. Sono attività registrate, non timbrature di presenza.</p>
  <div className="daily-hours-filters"><button disabled={busy} onClick={()=>move(-1)}>← Giorno precedente</button><label>Giornata<input type="date" value={day} max={today()} disabled={busy} onChange={e=>{if(e.target.value&&e.target.value<=today())setDay(e.target.value)}}/></label><button disabled={busy} onClick={()=>setDay(today())}>Oggi</button><button disabled={busy||day>=today()} onClick={()=>move(1)}>Giorno successivo →</button><label>Cerca dipendente<input value={name} onChange={e=>setName(e.target.value)} placeholder="Nome operatore"/></label></div>
  {error&&<p role="alert">Monte ore non aggiornato: {error} · I dati visualizzati sono gli ultimi ricevuti.</p>}
  {!current&&!error&&<p>Caricamento monte ore…</p>}
  {current&&<p>Aggiornato alle {time(current.serverNow)} · aggiornamento ogni 5 secondi</p>}
  {current&&!employees.length&&<p>Nessun dipendente trovato per questa giornata.</p>}
  {employees.map(employee=><article className="panel daily-hours-employee" key={employee.operatorId} aria-label={`Monte ore ${employee.name}`}>
   <h3>{employee.name}</h3>
   <div className="daily-hours-grid"><div><span>Sulle vetture</span><strong>{hourLabel(employee.vehicleSeconds)}</strong></div><div><span>Pulizie</span><strong>{hourLabel(employee.cleaningSeconds)}</strong></div><div><span>Altre ore lavorate</span><strong>{hourLabel(employee.otherSeconds)}</strong></div><div className="daily-hours-total"><span>Totale lavorato</span><strong>{hourLabel(employee.totalSeconds)}</strong></div></div>
   <p>Pausa caffè: <strong>{hourLabel(employee.coffeeSeconds)}</strong> · Ordinarie: <strong>{hourLabel(employee.ordinarySeconds)}</strong> · Extra: <strong>{hourLabel(employee.extraSeconds)}</strong></p>
   <details open><summary>Attività e vetture lavorate</summary><div className="table-wrap"><table><thead><tr><th>Orario</th><th>Attività / vettura</th><th>Lavorazione</th><th>Tempo registrato</th></tr></thead><tbody>
    {employee.entries.map((entry,i)=><tr key={i}><td>{time(entry.startedAt)}–{entry.running?'in corso':time(entry.endedAt)}</td><td>{entry.kind==='vehicle'?`${entry.plate??'Vettura'} · ${entry.number??''}`:kindLabel(entry.kind)}</td><td>{entry.kind==='vehicle'?entry.phase:'—'}</td><td>{hourLabel(entry.seconds)}</td></tr>)}
    {!employee.entries.length&&<tr><td colSpan={4}>Nessuna attività registrata dai tablet.</td></tr>}
   </tbody></table></div></details>
   {!!employee.adjustments.length&&<details open><summary>Rettifiche tracciate</summary>{employee.adjustments.map(a=><div className="daily-hours-audit" key={a.id}><strong>{a.seconds>0?'+':'−'}{hourLabel(a.seconds)} · {a.kind==='vehicle'?`${a.plate??'Vettura'} · ${a.number??''}`:kindLabel(a.kind)}</strong><p>{a.reason}</p><small>{new Date(a.createdAt).toLocaleString('it-IT',{timeZone:'Europe/Rome'})} · Titolare · utente {a.actorId}</small></div>)}</details>}
   {current!.canAdjust&&<HourCorrection key={employee.operatorId+day} employee={employee} jobs={current!.jobs} onSave={correct} disabled={busy||!!error}/>}
  </article>)}
  <p>Le rettifiche aggiornano questo monte ore e restano nello storico. Non modificano i timer originali, i tempi del preventivo o il budget delle vetture.</p>
 </section>
}

function HourCorrection({employee,jobs,onSave,disabled}:{employee:EmployeeDay;jobs:DailyHoursReport['jobs'];onSave:(c:Correction)=>Promise<void>;disabled:boolean}){
 const [kind,setKind]=useState<Kind>('vehicle'),[job,setJob]=useState(''),[direction,setDirection]=useState('add')
 const [minutes,setMinutes]=useState(''),[reason,setReason]=useState(''),[password,setPassword]=useState('')
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const pending=useRef<{signature:string;id:string}|null>(null)
 useEffect(()=>{const hide=()=>{if(document.hidden)setPassword('')};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide)},[])
 return <details><summary>Correggi ore con password</summary><form className="daily-hours-correction" onSubmit={async e=>{
  e.preventDefault();if(disabled||busy)return
  const n=Number(minutes)
  if(!Number.isInteger(n)||n<1||n>1440||reason.trim().length<3||!password||kind==='vehicle'&&!job){setError('Scegli attività e vettura, minuti e causale, poi inserisci la password.');return}
  const data={operatorId:employee.operatorId,kind,jobId:kind==='vehicle'?job:null,deltaMinutes:direction==='add'?n:-n,reason:reason.trim()}
  const signature=JSON.stringify(data)
  if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()}
  setBusy(true);setError('');setMessage('')
  try{await onSave({...data,password,requestId:pending.current!.id});pending.current=null;setMessage('Rettifica salvata. Totale giornaliero aggiornato.');setMinutes('');setReason('')}catch(e){setError(e instanceof Error?e.message:'Rettifica non salvata.')}finally{setBusy(false);setPassword('')}
 }}>
  <label>Operazione<select value={direction} disabled={disabled||busy} onChange={e=>setDirection(e.target.value)}><option value="add">Aggiungi ore</option><option value="remove">Togli ore</option></select></label>
  <label>Attività da correggere<select value={kind} disabled={disabled||busy} onChange={e=>setKind(e.target.value as Kind)}><option value="vehicle">Vettura</option><option value="cleaning">Pulizie</option><option value="coffee">Pausa caffè</option><option value="other">Altre ore lavorate</option></select></label>
  {kind==='vehicle'&&<label>Vettura<select required value={job} disabled={disabled||busy} onChange={e=>setJob(e.target.value)}><option value="">Scegli targa</option>{jobs.map(j=><option key={j.id} value={j.id}>{j.plate} · {j.number}</option>)}</select></label>}
  <label>Minuti da aggiungere o togliere<input aria-label="Minuti da aggiungere o togliere" type="number" required min="1" max="1440" step="1" value={minutes} disabled={disabled||busy} onChange={e=>setMinutes(e.target.value)}/><small>60 minuti = 1 ora</small></label>
  <label>Causale della rettifica<input required minLength={3} maxLength={500} value={reason} disabled={disabled||busy} onChange={e=>setReason(e.target.value)} placeholder="Es. timer non avviato per 30 minuti"/></label>
  <label>Password dei blocchi<input type="password" autoComplete="current-password" required value={password} disabled={disabled||busy} onChange={e=>setPassword(e.target.value)}/></label>
  <button className="primary" disabled={disabled||busy}>{busy?'Salvataggio…':'Salva rettifica protetta'}</button>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </form></details>
}
