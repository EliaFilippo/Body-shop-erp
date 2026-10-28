import { ContinueDay } from './ContinueDay'
import { OperatorActivities } from './OperatorActivities'
import { phaseDisplayName } from '../../services/workCycle'
import { panelTaskDescription } from '../../services/eliasPriceList'
import { ProductionControlPanel } from './ProductionControlPanel'
import { PhaseNotices } from './PhaseNotices'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudAuthSession } from '../../services/cloudAuth'
import { getCloudAuthConfig, signInWithPassword, signOutCloud } from '../../services/cloudAuth'
import { loadCloudSnapshot, type CloudSnapshot } from '../../services/cloudSync'
import { syncConfirmedProductionJobs, liveTimeAlert, liveCountdown, prepareLiveJob, productionRpc, refreshProductionSession, type LiveFeed } from '../../services/liveProduction'
import './liveProduction.css'
import { EmployeeHours, HoursTotals } from './EmployeeHours'
import { OperatorPinAdmin, OperatorPinLogin } from './OperatorPinAccess'
import { readTabletPairing } from '../../services/operatorPin'

const config = getCloudAuthConfig()
const sessionKey = 'body-shop-erp.cloud-session.v1'
function storedSession(): CloudAuthSession | null {
  try { const s = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); return s?.accessToken && s?.userId ? s : null } catch { return null }
}
const clockText = (seconds: number | null) => {
  if (seconds === null) return '—'
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

export function LiveProductionPage() {
  const [tabletPairing,setTabletPairing] = useState(readTabletPairing)
  const [session, setSession] = useState(storedSession)
  const [companyId, setCompanyId] = useState('')
  const [feed, setFeed] = useState<LiveFeed | null>(null)
  const [snapshot, setSnapshot] = useState<CloudSnapshot | null>(null)
  const [error, setError] = useState('')
  const [publicationWarning,setPublicationWarning]=useState('')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [selectionMode,setSelectionMode] = useState<'automatic'|'manual'>('manual')
  const [vehicleSearch,setVehicleSearch]=useState('')
  const [phaseChoices, setPhaseChoices] = useState<Record<string, string>>({})
  const [tick, setTick] = useState(0)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const lastSample = useRef(-Infinity)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  const actionLock = useRef(false)
  const refreshing = useRef(false)
  const userId = session?.userId
  useEffect(() => {
    if (!userId || !config) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    async function renew() {
      const current = sessionRef.current
      if (!current || current.userId !== userId) return
      let delay = 20000
      try {
        const next = await refreshProductionSession(current, config!)
        if (stopped) return
        sessionStorage.setItem(sessionKey, JSON.stringify(next)); setSession(next)
        delay = Math.max(10000, Math.min(20 * 60 * 1000, next.expiresIn * 800))
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : 'Impossibile rinnovare l’accesso.') }
      if (!stopped) timer = setTimeout(renew, delay)
    }
    // Refresh restored sessions before a shift and periodically throughout it.
    timer = setTimeout(renew, 1000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [userId])
  const refresh = useCallback(async () => {
    if (!session || !config || !companyId || refreshing.current) return
    refreshing.current = true
    const request = ++generation.current
    try {
      const result = await productionRpc<LiveFeed>('production_live_feed', { p_company_id: companyId }, session, config)
      if (request !== generation.current) return
      setFeed(result); lastSample.current = performance.now(); setError('')
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Connessione non disponibile.') }
    finally { refreshing.current = false }
  }, [session, companyId])

  useEffect(() => {
    if (!session || !config) return
    let cancelled = false
    async function membership() {
      try {
        const response = await fetch(`${config!.url}/rest/v1/company_members?${new URLSearchParams({ user_id: `eq.${session!.userId}`, active: 'eq.true', select: 'company_id,role', limit: '1' })}`,
          { headers: { apikey: config!.anonKey, Authorization: `Bearer ${session!.accessToken}` }, signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error('Accesso scaduto o non valido. Esci e accedi di nuovo.')
        const memberships = await response.json() as { company_id: string; role: string }[]
        if (!memberships.length) throw new Error('Questo account deve essere abilitato dal titolare per la carrozzeria.')
        if (cancelled) return
        setCompanyId(memberships[0].company_id)
        if (memberships[0].role === 'owner') {
          const loaded = await loadCloudSnapshot(memberships[0].company_id, session!, config!)
          if (!cancelled) setSnapshot(loaded)
        }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Impossibile caricare il profilo.') }
    }
    void membership()
    return () => { cancelled = true }
  }, [session])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!actionLock.current) await refresh()
      if (!stopped) timer = setTimeout(poll, 2000)
    }
    void poll()
    const visibility = () => { if (!document.hidden && !actionLock.current) void refresh() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('online', visibility)
    return () => { stopped = true; clearTimeout(timer); invalidate(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', visibility) }
  }, [refresh, invalidate])
  useEffect(() => { const timer = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(timer) }, [])
  void tick

  async function act(name: string, body: Record<string, unknown>) {
    if (!session || !config || actionLock.current) return
    actionLock.current = true; setBusy(true); generation.current++
    try {
      await productionRpc(name, { p_company_id: companyId, ...body }, session, config)
      // Ignore a feed sampled before the action; then read authoritative state again.
      while (refreshing.current) await new Promise(resolve => setTimeout(resolve, 50))
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Comando non riuscito. Verifica lo stato prima di riprovare.') }
    finally { actionLock.current = false; setBusy(false) }
  }
  async function logout() {
    if (!session || !config) return
    setBusy(true)
    try { await signOutCloud(session, config); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Disconnessione non riuscita.') }
    finally { sessionStorage.removeItem(sessionKey); setSession(null); setFeed(null); setCompanyId(''); setSnapshot(null); setBusy(false); setSelectionMode('manual'); setPhaseChoices({}) }
  }
  useEffect(()=>{
    if(!session||!config||!companyId||!feed||!['owner','office'].includes(feed.role))return
    let stopped=false
    let publishing=false
    const publish=async()=>{
      if(publishing||document.hidden||actionLock.current)return
      publishing=true
      try{
        const result=await syncConfirmedProductionJobs(companyId,session,config)
        if(!stopped){
          if(result.snapshot)setSnapshot(result.snapshot)
          if(result.warnings.length)setPublicationWarning(result.warnings.join(' · '))
          else setPublicationWarning('')
          await refresh()
        }
      }catch(problem){if(!stopped)setPublicationWarning(problem instanceof Error?problem.message:'Pubblicazione automatica da riprovare.')}
      finally{publishing=false}
    }
    void publish()
    const timer=setInterval(()=>void publish(),15000)
    return()=>{stopped=true;clearInterval(timer)}
  },[session,companyId,feed?.role,refresh])

  useEffect(()=>{
    const activate=()=>{
      const params=new URLSearchParams(location.hash.slice(1))
      if(!params.has('tablet'))return // In-page vehicle anchors must not change the login.
      const pairing=readTabletPairing()
      if(!pairing)return
      generation.current++
      setTabletPairing(pairing)
      setSession(null);setFeed(null);setCompanyId('');setSnapshot(null);setError('');setSelectionMode('manual');setPhaseChoices({})
    }
    window.addEventListener('hashchange',activate)
    return()=>window.removeEventListener('hashchange',activate)
  },[])

  const stale = performance.now() - lastSample.current > 8000
  const ownRunning = feed?.jobs.find(j => j.ownStatus === 'running')

  const timeAlert = liveTimeAlert(feed, (performance.now() - lastSample.current) / 1000, stale)

  return <main className={`live-production ${timeAlert ? 'live-time-alert-screen' : ''}`}>
    {timeAlert && <aside className="live-time-alert-banner" role="alert"><strong>{timeAlert.exhausted ? 'TEMPO DELLA FASE ESAURITO' : 'ATTENZIONE: TEMPO RESIDUO AL 20% O MENO'}</strong>
      <span>{timeAlert.plate} · {timeAlert.phase} · {timeAlert.overrunSeconds > 0 ? `+${clockText(timeAlert.overrunSeconds)}` : clockText(timeAlert.seconds)}</span></aside>}
    <header><div><p>ELIAS · BODY SHOP ERP</p><h1>{feed && ['owner', 'office'].includes(feed.role) ? 'Produzione e monte ore' : 'Il mio lavoro'}</h1></div>
      <div>{feed?.operatorName && <strong>{feed.operatorName}</strong>} {session && <button disabled={busy} onClick={() => void logout()}>Esci dal profilo</button>}
        {feed && ['owner','office'].includes(feed.role) && <a href={import.meta.env.BASE_URL}>Gestionale</a>}</div></header>
    {!config && <p role="alert">Collegamento Supabase non configurato.</p>}
    {error && <p className="live-alert" role="alert">{error}</p>}
    {config && !session && tabletPairing && <OperatorPinLogin pairing={tabletPairing} config={config} onLogin={result=>{setError('');sessionStorage.setItem(sessionKey,JSON.stringify(result));setSession(result)}} />}
    {config && !session && <details open={!tabletPairing}><summary>Accesso titolare o account con email</summary><form className="live-login" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('')
      try { const result = await signInWithPassword(email, password, config); sessionStorage.setItem(sessionKey, JSON.stringify(result)); setPassword(''); setSession(result) }
      catch (e) { setError(e instanceof Error ? e.message : 'Accesso non riuscito.') }
      finally { setBusy(false) }
    }}><h2>Accedi al tuo profilo</h2><label>Email <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>Password <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      <button disabled={busy}>Accedi</button><p>Usa il tuo account aziendale personale.</p></form></details>}
    {session && feed && <>
      {!feed.operatorName && <p className="live-alert">Il titolare deve collegare questo account al tuo operatore prima di avviare il lavoro.</p>}
      <p role="status">{stale ? 'Collegamento interrotto: il tempo sul server continua. I comandi sono sospesi finché la connessione non torna.' : 'Tablet aggiornato · sincronizzazione ogni 2 secondi'}</p>
      {feed.operatorName && <OperatorActivities activity={feed.activity} busy={busy} stale={stale} elapsed={(performance.now()-lastSample.current)/1000} onAction={kind=>void act('production_activity_action',{p_kind:kind})}/>}
      {feed.operatorName && <ContinueDay feed={feed} busy={busy} stale={stale} onContinue={until=>void act('production_continue_day',{p_until:until})}/>}
      {feed.today && <section className="live-day-hours"><h2>Le mie ore di oggi</h2><HoursTotals report={feed.today} elapsed={(performance.now() - lastSample.current) / 1000} stale={stale} />
        <p>Conteggio dei periodi di lavoro avviati con Start. Pausa e Fine fermano il conteggio personale. Gli extra superano l’orario giornaliero configurato.</p></section>}
      {feed.operatorName && <section className="live-day-hours"><h2>Programma automatico · i miei lavori assegnati</h2><p>Proposte secondo le priorità di consegna, margine e attesa. Puoi scegliere il lavoro manualmente qui sotto senza modificare il programma.</p>
        {feed.program?.length ? <ol>{feed.program.map(task => <li key={task.id}><strong>{task.coneNumber!=null&&<span className="live-program-cone">CONO {task.coneNumber}</span>}{task.plate} · {phaseDisplayName(task.phaseName)}</strong>
          <p>Previsto: {new Date(task.startAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</p>
          {!!task.panels?.length && <p>{task.panels.join(', ')}</p>}
          {task.ready ? <a href={`#vettura-${encodeURIComponent(task.jobId)}`} onClick={() => {setSelectionMode('automatic');setVehicleSearch('');setPhaseChoices(current => ({ ...current, [task.jobId]: task.phaseId }))}}>Apri vettura e fase</a>
            : <p>Pubblicazione automatica in corso. Se il lavoro non compare, l’ufficio può verificare i dati mancanti in Produzione.</p>}</li>)}</ol>
          : <p>Nessun lavoro assegnato nel Programma operatori. Puoi consultare le vetture disponibili qui sotto.</p>}
      </section>}
      {publicationWarning&&['owner','office'].includes(feed.role)&&<p role="status">Pubblicazione automatica: {publicationWarning}</p>}
      {['owner', 'office'].includes(feed.role) && <ProductionControlPanel connection={{ companyId, session, config: config! }} />}
      <p>Ogni fase ha una quota del budget della vettura. I colleghi sulla stessa fase consumano la stessa quota. Pausa e Fine fermano soltanto il tuo timer.</p>
      <section className="live-day-hours"><h2>Scegli una vettura · anche fuori programma</h2><label>Cerca targa o cono<input type="search" value={vehicleSearch} onChange={e=>setVehicleSearch(e.target.value)} /></label><p>Tutti vedono le vetture aperte. In manuale scegli qualsiasi fase di lavorazione, anche non prevista nel preventivo, fuori mansione o già completata per un intervento aggiuntivo. Passando a un altro lavoro, il tuo timer precedente va in pausa. Il programma automatico mantiene le priorità e il ricalcolo serale.</p>{feed.manualSelection && <label>Scelta del lavoro<select aria-label="Modalità scelta lavoro" value={selectionMode} disabled={busy} onChange={e=>{setSelectionMode(e.target.value as 'automatic'|'manual');setPhaseChoices({})}}>
        <option value="automatic">Automatica · fasi abilitate e programma</option><option value="manual">Manuale · scegli vettura e fase</option>
      </select></label>}</section>
      <section className="live-job-grid" aria-label="Vetture disponibili">
        {feed.jobs.filter(job=>!vehicleSearch.trim()||`${job.plate} ${job.coneNumber??''} ${job.number}`.replace(/\s/g,'').toLowerCase().includes(vehicleSearch.replace(/\s/g,'').toLowerCase())).map(job => {
          const totalClock = liveCountdown(job, (performance.now() - lastSample.current) / 1000)
          const manual = selectionMode === 'manual' && feed.manualSelection
          const availablePhases = (job.phases ?? []).filter(p => p.name !== 'Consegna' && (manual || (!p.notRequired && p.automaticAllowed !== false && !['Completata', 'Bloccata'].includes(p.status))))
          const selected = [phaseChoices[job.jobId], job.ownStatus === 'running' || job.ownStatus === 'paused' ? job.ownPhaseId : undefined, availablePhases[0]?.id].find(id => availablePhases.some(p => p.id === id)) ?? ''
          const requiresPhase = job.dutiesFiltered || (manual ? (job.phases ?? []).length > 0 : (job.phases ?? []).some(p => !p.notRequired))
          const selectedPhase = availablePhases.find(p => p.id === selected)
          const switchesWork=Boolean(feed.activity?.kind || ownRunning && (ownRunning.jobId!==job.jobId || (ownRunning.ownPhaseId??'')!==selected))
          const startBlockedReason=!selected&&requiresPhase ? [...new Set((job.phases??[]).filter(p=>!p.notRequired&&p.name!=='Consegna'&&p.automaticAllowed!==false&&p.status==='Bloccata').map(p=>p.blockedReason||'La fase è bloccata: verifica le lavorazioni precedenti.'))].join(' · ')||'Nessuna fase aperta abilitata per questo operatore.' : ''
          const permissionRemoved = job.dutiesFiltered && !job.phases?.some(p => p.id === job.ownPhaseId) && ['running','paused'].includes(job.ownStatus ?? '')
          const phaseActiveCount = selectedPhase?.clock?.activeCount ?? job.activeCount
          const standardClock = !selectedPhase?.notRequired && selectedPhase?.standardClock ? liveCountdown({ ...job, ...selectedPhase.standardClock }, (performance.now() - lastSample.current) / 1000) : null
          const clock = !selectedPhase?.notRequired && selectedPhase?.clock ? liveCountdown({ ...job, ...selectedPhase.clock }, (performance.now() - lastSample.current) / 1000) : totalClock
          const workClock = standardClock ?? clock
          const myTimerRunning = job.ownStatus === 'running'
          const activeNames = job.operators.filter(o => o.status === 'running').map(o => o.name)
          return <article key={job.jobId} id={`vettura-${job.jobId}`} className={`live-job ${!stale && myTimerRunning ? 'live-own' : ''} ${!stale && myTimerRunning && workClock.warning ? 'live-warning' : ''}`}>
            <div className="live-cone-identity">{job.coneNumber!=null?<><span>CONO</span><strong aria-label={`Cono ${job.coneNumber}`}>{job.coneNumber}</strong></>:<span>Cono non assegnato</span>}<h2>{job.plate}</h2></div><p>Commessa {job.number}</p>{permissionRemoved && <p role="alert">La mansione precedente non è più abilitata. Puoi mettere in pausa o terminare il timer; chiedi all’ufficio per la riassegnazione.</p>}
            <section className={`live-timer-identity ${!stale && myTimerRunning ? 'is-own' : 'is-other'}`} aria-label={`Stato del tuo timer su ${job.plate}`}>
              <strong>{stale ? 'Stato del timer da aggiornare' : myTimerRunning ? 'Il tuo timer è attivo' : job.ownStatus === 'paused' ? 'Il tuo timer è in pausa' : 'Il tuo timer non è attivo'}</strong>
              {!stale && !myTimerRunning && !!activeNames.length && <p>{activeNames.map(name => `${name} al lavoro`).join(' · ')}</p>}
              {!stale && !myTimerRunning && !!activeNames.length && <p>Sta lavorando un collega. Pausa e Fine fermano soltanto il tuo timer.</p>}
            </section>
            <p className="live-shared-label">Tempo residuo condiviso della vettura / fase</p>
            <p>{selectedPhase?.notRequired ? 'Tempo complessivo residuo della vettura · fase extra senza tempo preventivato' : standardClock && workClock.overrunSeconds > 0 ? `Tempo oltre il previsto · ${selectedPhase?.standardClock?.label}` : standardClock ? `Tempo da rispettare · ${selectedPhase?.standardClock?.label}` : selectedPhase?.clock ? `Tempo disponibile · ${selectedPhase.name}` : 'Tempo complessivo residuo della vettura'}</p>
            <strong className="live-clock" aria-label="Tempo residuo condiviso">{stale ? 'Da aggiornare' : standardClock && workClock.overrunSeconds > 0 ? `+${clockText(workClock.overrunSeconds)}` : clockText(feed.operatorName ? workClock.individualSeconds : workClock.seconds)}</strong>
            <p>Questo conto alla rovescia usa il tempo condiviso della lavorazione. Le tue ore personali sono in «Le mie ore di oggi».</p>
            {selectedPhase?.notRequired ? null : standardClock ? standardClock.individualSeconds === null && <p>Tempo standard non impostato su questa commessa: richiedi la configurazione all’ufficio.</p> : selectedPhase?.clock && selectedPhase.clock.ownRemainingSeconds === null && <p>Tempo della fase da configurare oppure costo operatore mancante.</p>}
            {standardClock && <section aria-label="Tempo standard della lavorazione"><p>Tempo standard · {selectedPhase?.standardClock?.label}</p>
              <p>Totale condiviso: {selectedPhase?.standardClock?.totalMinutes} min. Ogni minuto lavorato da ciascun operatore consuma questo tempo.</p>
              {!stale && standardClock.warning && <p role="status">{standardClock.exhausted ? 'Tempo standard superato. Il timer continua su questa fase e l’ufficio riceve un avviso nel gestionale.' : 'Attenzione: rimane meno del 20% del tempo standard.'}</p>}
            </section>}
            <details><summary>Limite economico · non aumenta il tempo di lavorazione</summary>
              {!selectedPhase?.notRequired && <p>Residuo economico della fase: {stale ? 'Da aggiornare' : clockText(clock.individualSeconds)}</p>}
            <p>Residuo complessivo vettura: {stale ? 'Da aggiornare' : clockText(totalClock.individualSeconds)}</p>
            {clock.seconds !== null && phaseActiveCount > 0 && feed.operatorName && <p>{`${selectedPhase?.clock ? 'Tempo residuo fase con' : 'Tempo residuo con'} ${phaseActiveCount} operatori attivi`}: <strong>{stale ? 'Da aggiornare' : clockText(clock.seconds)}</strong></p>}
            </details>
            {!stale && clock.warning && <p role="status">{clock.exhausted ? 'Budget esaurito: lavoro oltre il tempo disponibile' : 'Attenzione: rimane meno del 20% del budget di lavoro'}</p>}
            <p>{job.operators.map(o => `${o.name}: ${o.status === 'running' ? 'al lavoro' : o.status === 'paused' ? 'in pausa' : 'terminato'}`).join(' · ') || 'Nessun operatore avviato'}</p>
            {!manual && feed.manualSelection && <button type="button" disabled={busy} aria-label={`Mostra tutte le fasi su ${job.plate}`} onClick={()=>{setSelectionMode('manual');setPhaseChoices(current=>({...current,[job.jobId]:''}))}}>Mostra tutte le fasi</button>}
            {requiresPhase && <label>Fase da lavorare<select aria-label={`Fase da lavorare su ${job.plate}`} value={selected} disabled={busy}
              onChange={e => setPhaseChoices(current => ({ ...current, [job.jobId]: e.target.value }))}>
              {!availablePhases.length && <option value="">Nessuna fase disponibile</option>}
              {availablePhases.map(p => <option value={p.id} key={p.id}>{phaseDisplayName(p.name)}{manual && p.notRequired ? ' · non prevista nel preventivo' : manual && p.status === 'Completata' ? ' · intervento aggiuntivo' : ''}</option>)}</select></label>}
            {manual && selectedPhase?.notRequired && <p>Fase non prevista nel preventivo: le ore effettive vengono registrate sulla vettura. Non viene aggiunto un tempo preventivato.</p>}
            {manual && !selectedPhase?.notRequired && selectedPhase?.status === 'Completata' && <p>Intervento aggiuntivo: il visto precedente resta nello storico; il nuovo tempo si aggiunge alle ore lavorate.</p>}
            {startBlockedReason&&<p role="status">Avvio non disponibile: {startBlockedReason}{!manual && feed.manualSelection ? ' Puoi passare alla scelta manuale.' : ''}</p>}
            {feed.activity?.kind&&selected&&<p>Premendo Start termini {feed.activity.kind==='cleaning'?'Pulizie':'Pausa caffè'} e avvii questa vettura. Se l’avvio non riesce, l’attività precedente continua.</p>}
            <div className="live-controls"><button disabled={busy || stale || !feed.operatorName || (job.ownStatus === 'running' && !switchesWork) || (requiresPhase && !selected) || (manual && job.manualStartAllowed === false)}
              onClick={() => void act(manual ? 'production_manual_start' : switchesWork ? 'production_start_selected_job' : 'production_timer_action', { p_job_id: job.jobId, ...(manual || switchesWork ? {} : {p_action:'start'}), p_phase_id: selected || null })}>{ownRunning && ownRunning.jobId !== job.jobId ? 'Passa a questa vettura' : job.ownStatus === 'paused' ? 'Riprendi' : manual ? 'Avvia manualmente' : 'Start'}</button>
              <button disabled={busy || stale || job.ownStatus !== 'running'} onClick={() => void act('production_timer_action', { p_job_id: job.jobId, p_action: 'pause' })}>Pausa</button>
              <button disabled={busy || stale || !['running', 'paused'].includes(job.ownStatus ?? '')} onClick={() => void act('production_timer_action', { p_job_id: job.jobId, p_action: 'finish' })}>Fine</button></div>
            {!!job.tasks?.length && <details open><summary>Lavori da fare</summary><ul>{job.tasks.map(task => <li key={task.id}>{panelTaskDescription(task.description, task.panel)}{task.quantity > 1 ? ` × ${task.quantity}` : ''}</li>)}</ul></details>}
            {!!job.phases?.length && <section className="live-phases" aria-label={`Fasi di ${job.plate}`}><h3>Avanzamento fasi</h3>
              <p>{availablePhases[0] ? `Prossima fase da completare: ${phaseDisplayName(availablePhases[0].name)}` : 'Nessuna fase aperta e disponibile'}</p>
              <ol>{job.phases.filter(p => !p.notRequired || (manual && p.id === selected) || (p.id === job.ownPhaseId && ['running','paused'].includes(job.ownStatus ?? ''))).map(phase => <li key={phase.id}>
                <strong>{phase.status === 'Completata' ? '✓ ' : ''}{phaseDisplayName(phase.name)}{phase.notRequired ? ' · non prevista nel preventivo' : ''}</strong>
                {!phase.notRequired && phase.clock && phase.name !== 'Consegna' && <p>{phase.standardClock ? 'Tempo standard residuo' : 'Tempo residuo per te'}: {!stale && phase.standardClock && liveCountdown({ ...job, ...phase.standardClock }, (performance.now() - lastSample.current) / 1000).overrunSeconds > 0 ? `+${clockText(liveCountdown({ ...job, ...phase.standardClock }, (performance.now() - lastSample.current) / 1000).overrunSeconds)} oltre il previsto` : stale ? 'Da aggiornare' : (liveCountdown({ ...job, ...(phase.standardClock ?? phase.clock) }, (performance.now() - lastSample.current) / 1000).individualSeconds === null ? 'Da configurare' : clockText(liveCountdown({ ...job, ...(phase.standardClock ?? phase.clock) }, (performance.now() - lastSample.current) / 1000).individualSeconds))}</p>}
                {phase.checkedBy && phase.checkedAt ? <p>Visto di {phase.checkedBy} · {new Date(phase.checkedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</p>
                  : <p>{phase.status === 'Completata' ? 'Completata nel gestionale · visto non registrato' : phase.status}</p>}
                {phase.blockedReason && phase.status === 'Bloccata' && <p>{phase.blockedReason}</p>}
                {!phase.notRequired && !['Completata', 'Bloccata'].includes(phase.status) && <button disabled={busy || stale || !phase.canComplete}
                  onClick={() => void act('production_complete_phase', { p_job_id: job.jobId, p_phase_id: phase.id })}>✓ Completa {phaseDisplayName(phase.name)}</button>}
              </li>)}</ol><p>Il visto registra chi ha completato la fase e ferma il suo timer su quella fase. Gli altri operatori devono prima mettere in pausa o terminare il lavoro sulla stessa fase.</p>
            </section>}
            <PhaseNotices connection={{ companyId, session, config: config! }} jobId={job.jobId} phases={job.phases ?? []} office={['owner', 'office'].includes(feed.role)} />
          </article>
        })}
        {!feed.jobs.length && <p>Le commesse confermate compariranno automaticamente dopo la sincronizzazione.</p>}
      </section>
      {['owner', 'office'].includes(feed.role) && <EmployeeHours feed={feed} session={session} config={config!} elapsed={(performance.now() - lastSample.current) / 1000} stale={stale} />}
      {feed.role === 'owner' && snapshot && <details className="live-admin"><summary>Configurazione tablet e budget · Titolare</summary>
        <OperatorPinAdmin companyId={companyId} operators={snapshot.payload.plannerSettings.operators} session={session} config={config!} />
        <h2>Collega gli account agli operatori</h2><p>Gli account devono già appartenere all’azienda. Un profilo per operatore. Anche un account Ufficio può essere collegato: conserva l’accesso all’ufficio e usa sul tablet le mansioni e gli orari del proprio operatore.</p>
        {feed.members.map(member => <label key={member.userId}>{member.name}<select aria-label={`Operatore per ${member.name}`} value={member.operatorId ?? ''} disabled={busy}
          onChange={e => { void act(e.target.value ? 'production_bind_profile' : 'production_unbind_profile', { p_user_id: member.userId, ...(e.target.value ? { p_operator_id: e.target.value } : {}) }) }}>
          <option value="">Da collegare</option>{snapshot.payload.plannerSettings.operators.filter(o => o.active).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>)}
        <h2>Pubblicazione automatica delle commesse</h2><p>Prezzi IVA esclusa, meno materiali e costi diretti. Il budget e le tariffe si congelano al primo Start. Queste ore sono il limite economico a pareggio; non riservano un margine di utile.</p>
        <button disabled={busy} onClick={async () => { try { setSnapshot(await loadCloudSnapshot(companyId, session, config!)) } catch (e) { setError(e instanceof Error ? e.message : 'Aggiornamento non riuscito.') } }}>Aggiorna stato pubblicazione</button>
        {(snapshot.payload.jobs ?? []).filter(j => !['Consegnata', 'Annullata'].includes(j.status)).map(job => {
          let budget: ReturnType<typeof prepareLiveJob> | undefined; let problem = ''
          try { budget = prepareLiveJob(snapshot.payload, job) } catch (e) { problem = e instanceof Error ? e.message : 'Budget non valido' }
          return <div key={job.id} className="live-budget"><strong>{job.plate} · {job.number}</strong>
            {problem ? <p>{problem}</p> : <p>Ricavo {budget!.revenue.toFixed(2)} € − materiali {budget!.materials.toFixed(2)} € − costi diretti {budget!.directCosts.toFixed(2)} € = budget {budget!.budget.toFixed(2)} €</p>}
            <p>{feed.jobs.some(j=>j.jobId===job.id)?'Disponibile sui tablet':problem?'Completa i dati indicati: la pubblicazione riprova automaticamente.':'Pubblicazione automatica in corso.'}</p></div>
        })}
      </details>}
    </>}
  </main>
}
