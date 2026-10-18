import { OwnerPasswordGate } from './OwnerPasswordGate'
import { useEffect, useRef, useState } from 'react'
import { productionRpc } from '../../services/liveProduction'
import type { NoticesConnection } from './PhaseNotices'
import './productionControl.css'

export interface ProductionControlReport {
 serverNow: string;
 phaseReview?: { phase:string; samples:number; pending:number; missing:number; assignedSeconds:number; workedSeconds:number; averageWorkedSeconds:number|null; deviationPercent:number|null; review:string;
  jobs:{jobId:string;plate:string;number:string;assignedSeconds:number;workedSeconds:number;completed:boolean;active:boolean}[] }[];
 alerts: { id: number; jobId: string; plate: string; number: string; phase: string; detectedAt: string; acknowledgedAt: string | null; overrunSeconds: number; active: boolean; operators: { name: string }[] }[];
 operators: { operatorId: string; name: string; assignedSeconds: number; workedSeconds: number; score: number | null; completedGroups: number; unscoredSharedSeconds: number }[];
 teams: { jobId: string; plate: string; phase: string; assignedSeconds: number; workedSeconds: number; score: number; operators: { name: string }[] }[];
}
const duration = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`
const monthNow = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' }).format(new Date())
export function ProductionControlPanel({ connection }: { connection: NoticesConnection }) {
 const [month, setMonth] = useState(monthNow)
 const [report, setReport] = useState<ProductionControlReport | null>(null)
 const [error, setError] = useState('')
 const [busy, setBusy] = useState(false)
 const [history, setHistory] = useState(false)
 const requestId = useRef(0)
 const { companyId, config, session } = connection
 const from = `${month}-01`
 const [year, monthNumber] = month.split('-').map(Number)
 const to = `${month}-${new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()}`
 useEffect(() => {
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  setReport(null)
  async function poll() {
   const id = ++requestId.current
   try {
    const next = await productionRpc<ProductionControlReport>('production_control_report', { p_company_id: companyId, p_from: from, p_to: to }, session, config)
    if (!stopped && id === requestId.current) { setReport(next); setError('') }
   } catch (e) { if (!stopped && id === requestId.current) setError(e instanceof Error ? e.message : 'Controllo produzione non disponibile.') }
   if (!stopped) timer = setTimeout(poll, 5000)
  }
  void poll()
  return () => { stopped = true; clearTimeout(timer); requestId.current++ }
 }, [companyId, session.accessToken, config.url, config.anonKey, from, to])
 async function acknowledge(id: number) {
  if (busy) return
  setBusy(true); requestId.current++
  try {
   const next = await productionRpc<ProductionControlReport>('production_control_report', { p_company_id: companyId, p_from: from, p_to: to, p_ack_id: id }, session, config)
   setReport(next); setError('')
  } catch (e) { setError(e instanceof Error ? e.message : 'Presa in carico non riuscita.') }
  finally { setBusy(false) }
 }
 const open = report?.alerts.filter(a => !a.acknowledgedAt) ?? []
 return <section className="production-control" aria-label="Controllo tempi e produttività">
  {!!open.length && <div className="production-overruns" role="alert"><h2>{open.length} sforamenti da verificare</h2>
   <p>Il lavoro continua nella stessa fase. Tempo aggiuntivo totale degli operatori:</p>
   {open.map(a => <article key={a.id}><strong>{a.plate} · {a.number} · {a.phase}</strong>
    <p>+{duration(a.overrunSeconds)} · {a.operators.map(o => o.name).join(', ')} · {a.active ? 'Timer attivo' : 'Timer fermi'}</p>
    <button type="button" disabled={busy || !!error} onClick={() => void acknowledge(a.id)}>Preso in carico</button></article>)}
  </div>}
  <details><summary>Tempi e produttività operatori{open.length ? ` · ${open.length} avvisi` : ''}</summary>
   <p>Avvisi interni al gestionale, aggiornati ogni 5 secondi con questa pagina aperta.</p>
   <label>Mese del rapporto <input type="month" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value) }} /></label>
   {!report && !error && <p>Caricamento…</p>}
   <OwnerPasswordGate title="Ore e produttività dei dipendenti" connection={connection}>{session => <PrivateProductivity connection={{...connection,session}} from={from} to={to} />}</OwnerPasswordGate>
   <details><summary>Report di tutte le fasi · verifica del tempario</summary>
    <p>Confronto delle lavorazioni concluse nel mese; quelle aperte sono indicate a parte. Uno scostamento medio oltre il 15%, con almeno 5 lavori, segnala una verifica. Vetture, pannelli e difficoltà possono essere diversi: il tempario non cambia da solo.</p>
    <p>S/R e I/S hanno un tempo totale condiviso: il confronto li considera insieme per non duplicare le ore.</p>
    {report?.phaseReview?.map(phase => <article key={phase.phase}><h3>{phase.phase}</h3>
     <p>{phase.samples} concluse confrontabili · {phase.pending} aperte · {phase.missing} con tempo da configurare</p>
     <p>Totale assegnato: {duration(phase.assignedSeconds)} · lavorato: {duration(phase.workedSeconds)} · scostamento: {phase.deviationPercent === null ? '—' : `${phase.deviationPercent > 0 ? '+' : ''}${phase.deviationPercent.toLocaleString('it-IT')}%`}</p>
     <strong>{phase.review}</strong>
     <details><summary>Dettaglio per vettura</summary><div className="production-score-table"><table><thead><tr><th>Vettura</th><th>Assegnato</th><th>Lavorato</th><th>Stato</th></tr></thead><tbody>
      {phase.jobs.map(job => <tr key={job.jobId}><td>{job.plate} · {job.number}</td><td>{job.assignedSeconds > 0 ? duration(job.assignedSeconds) : 'Da configurare'}</td><td>{duration(job.workedSeconds)}</td><td>{job.completed ? 'Conclusa' : job.active ? 'Al lavoro' : 'Aperta'}</td></tr>)}
     </tbody></table></div></details>
    </article>)}
    {report && !report.phaseReview?.length && <p>Nessuna fase disponibile per il confronto.</p>}
    <p>Puoi modificare i tempi preimpostati in Listino prezzi; i tempi già conservati sulle commesse avviate restano invariati.</p>
   </details>
   <button type="button" onClick={() => setHistory(!history)}>{history ? 'Nascondi storico avvisi' : 'Mostra storico avvisi'}</button>
   {history && report?.alerts.filter(a => a.acknowledgedAt).map(a => <p key={a.id}>✓ {a.plate} · {a.phase} · preso in carico il {new Date(a.acknowledgedAt!).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</p>)}
  </details>
  {error && <p role="alert">Controllo tempi non aggiornato: {error}</p>}
 </section>
}

function PrivateProductivity({connection,from,to}:{connection:NoticesConnection;from:string;to:string}) {
 const [report,setReport]=useState<ProductionControlReport|null>(null)
 const [error,setError]=useState('')
 useEffect(()=>{let stopped=false; let timer:ReturnType<typeof setTimeout>;
  async function poll(){try{const next=await productionRpc<ProductionControlReport>('production_productivity_report',{p_company_id:connection.companyId,p_from:from,p_to:to},connection.session,connection.config);if(!stopped){setReport(next);setError('')}}catch(e){if(!stopped){setReport(null);setError(e instanceof Error?e.message:'Report non disponibile.')}}if(!stopped)timer=setTimeout(poll,5000)}
  void poll();return()=>{stopped=true;clearTimeout(timer)}
 },[connection.companyId,connection.session.accessToken,connection.config.url,connection.config.anonKey,from,to])
 return <>{error&&<p role="alert">{error}</p>}   <p>Punteggio = tempo assegnato ÷ tempo lavorato × 100. 100 rispetta il tempo, oltre 100 indica tempo risparmiato. Solo fasi concluse; pause e attese tecniche escluse. I tempi di S/R e I/S contano una sola volta, dopo entrambe le fasi.</p>
   {report && <div className="production-score-table"><table><thead><tr><th>Operatore</th><th>Assegnato</th><th>Lavorato</th><th>Punteggio</th><th>Gruppi conclusi</th><th>Condiviso senza quota personale</th></tr></thead>
    <tbody>{report.operators.map(o => <tr key={o.operatorId}><th>{o.name}</th><td>{duration(o.assignedSeconds)}</td><td>{duration(o.workedSeconds)}</td><td>{o.score === null ? '—' : o.score.toLocaleString('it-IT')}</td><td>{o.completedGroups}</td><td>{duration(o.unscoredSharedSeconds)}</td></tr>)}</tbody></table></div>}
   {report && !report.operators.length && <p>Nessuna fase conclusa con tempo standard e lavoro registrato in questo mese.</p>}
   <p>Le quote personali dei lavori condivisi vengono conservate al primo Start. Senza una ripartizione affidabile, il risultato resta della squadra e non modifica il punteggio individuale. Il punteggio misura i tempi, non la qualità né gli incassi.</p>
   {!!report?.teams.length && <details><summary>Risultati delle squadre</summary>{report.teams.map(t => <p key={`${t.jobId}:${t.phase}`}>{t.plate} · {t.phase} · {t.operators.map(o => o.name).join(', ')}: {t.score.toLocaleString('it-IT')} punti ({duration(t.assignedSeconds)} assegnate / {duration(t.workedSeconds)} lavorate)</p>)}</details>}
</>
}
