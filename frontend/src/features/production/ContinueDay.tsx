import { useState } from 'react'
import type { LiveFeed } from '../../services/liveProduction'
import { phaseDisplayName } from '../../services/workCycle'
import { formatMinutesToTime } from '../../services/workCalendar'
export function ContinueDay({feed,busy,stale,onContinue}:{feed:LiveFeed;busy:boolean;stale:boolean;onContinue:(until:string)=>void}) {
 const [open,setOpen]=useState(false)
 const [until,setUntil]=useState('')
 const state=feed.dayContinuation
 if(!state)return null
 const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(feed.serverNow))
 const [hour,minute]=clock.split(':').map(Number)
 const base=Math.max(state.untilMinute??state.ordinaryEndMinute??0,Number.isFinite(hour*60+minute)?hour*60+minute:0)
 const defaultUntil=formatMinutesToTime(Math.min(1439,base+60))
 const choices=feed.jobs.flatMap(job=>(job.phases??[]).filter(phase=>!phase.notRequired&&!['Bloccata','Completata'].includes(phase.status)&&phase.name!=='Consegna').map(phase=>({job,phase})))
 return <section className="live-day-hours" aria-label="Prosecuzione giornata">
  <h2>Continua giornata</h2>
  {state.untilMinute!=null&&<p>Disponibilità extra confermata fino alle <strong>{formatMinutesToTime(state.untilMinute)}</strong>. Il timer registra solo il lavoro effettivamente avviato.</p>}
  <button disabled={busy||stale||!state.canContinue} onClick={()=>setOpen(true)}>Continua giornata</button>
  {!state.canContinue&&<p>{state.ordinaryEndMinute==null?'Chiedi all’ufficio di configurare gli orari di inizio e fine giornata.':'Disponibile al termine dell’orario concordato.'}</p>}
  {open&&<div><label>Disponibile fino alle<input type="time" value={until||defaultUntil} onChange={e=>setUntil(e.target.value)}/></label>
   <button disabled={busy||stale} onClick={()=>onContinue(until||defaultUntil)}>Conferma disponibilità extra</button>
   <p>La disponibilità vale solo per oggi; aggiorna il planner e le ore previste del mese. Non avvia il timer.</p></div>}
  {state.untilMinute!=null&&<><h3>Vetture da lavorare</h3>{choices.length?<ul>{choices.map(({job,phase})=><li key={job.jobId+'|'+phase.id}><a href={'#vettura-'+encodeURIComponent(job.jobId)}>{job.coneNumber!=null?'CONO '+job.coneNumber+' · ':''}{job.plate} · {phaseDisplayName(phase.name)}</a></li>)}</ul>:<p>Nessuna fase compatibile disponibile al momento: avvisa l’ufficio.</p>}</>}
 </section>
}
