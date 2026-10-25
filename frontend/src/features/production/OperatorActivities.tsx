import type { OperatorActivity } from '../../services/liveProduction'
const clock=(seconds:number)=>{const n=Math.max(0,Math.floor(seconds));return `${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`}
export function OperatorActivities({activity,busy,stale,elapsed,onAction}:{activity:OperatorActivity|null|undefined;busy:boolean;stale:boolean;elapsed:number;onAction:(kind:string)=>void}){
 const extra=stale?0:Math.max(0,elapsed)
 return <section className="live-day-hours" aria-label="Pulizie e pausa caffè">
  <h2>Attività fuori vettura</h2>
  <div className="live-controls">
   <button disabled={busy||stale||!activity||activity.kind==='cleaning'} onClick={()=>onAction('cleaning')}>PULIZIE</button>
   <button disabled={busy||stale||!activity||activity.kind==='coffee'} onClick={()=>onAction('coffee')}>PAUSA CAFFÈ</button>
  </div>
  {!activity?<p>Funzione da attivare dall’ufficio.</p>:<>
   {activity.kind&&<div role="status"><h3>{activity.kind==='cleaning'?'PULIZIE IN CORSO':'PAUSA CAFFÈ IN CORSO'}</h3>
    <strong className="live-clock">{stale?'Da aggiornare':clock(activity.elapsedSeconds+extra)}</strong>
    <button disabled={busy||stale} onClick={()=>onAction('end')}>TERMINA ATTIVITÀ</button></div>}
   <p>Oggi · Pulizie: {clock(activity.cleaningSeconds+(activity.kind==='cleaning'?extra:0))} · Pausa caffè: {clock(activity.coffeeSeconds+(activity.kind==='coffee'?extra:0))}</p>
   <p>Questi pulsanti mettono in pausa il tuo timer sulla vettura e registrano il tempo separatamente. Al termine premi TERMINA ATTIVITÀ, poi Riprendi sulla vettura. Il conteggio continua anche chiudendo il tablet.</p>
  </>}
 </section>
}
