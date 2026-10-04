import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudAuthSession } from '../../services/cloudAuth'
import { getCloudAuthConfig, signInWithPassword, signOutCloud } from '../../services/cloudAuth'
import { loadCloudSnapshot, type CloudSnapshot } from '../../services/cloudSync'
import { liveCountdown, prepareLiveJob, productionRpc, refreshProductionSession, type LiveFeed } from '../../services/liveProduction'
import './liveProduction.css'
import { EmployeeHours, HoursTotals } from './EmployeeHours'

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
  const [session, setSession] = useState(storedSession)
  const [companyId, setCompanyId] = useState('')
  const [feed, setFeed] = useState<LiveFeed | null>(null)
  const [snapshot, setSnapshot] = useState<CloudSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    finally { sessionStorage.removeItem(sessionKey); setSession(null); setFeed(null); setCompanyId(''); setSnapshot(null); setBusy(false) }
  }
  const stale = performance.now() - lastSample.current > 8000
  const ownRunning = feed?.jobs.find(j => j.ownStatus === 'running')

  return <main className="live-production">
    <header><div><p>ELIAS · BODY SHOP ERP</p><h1>{feed && ['owner', 'office'].includes(feed.role) ? 'Produzione e monte ore' : 'Il mio lavoro'}</h1></div>
      <div>{feed?.operatorName && <strong>{feed.operatorName}</strong>} {session && <button disabled={busy} onClick={() => void logout()}>Esci dal profilo</button>}
        <a href={import.meta.env.BASE_URL}>Gestionale</a></div></header>
    {!config && <p role="alert">Collegamento Supabase non configurato.</p>}
    {error && <p className="live-alert" role="alert">{error}</p>}
    {config && !session && <form className="live-login" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('')
      try { const result = await signInWithPassword(email, password, config); sessionStorage.setItem(sessionKey, JSON.stringify(result)); setPassword(''); setSession(result) }
      catch (e) { setError(e instanceof Error ? e.message : 'Accesso non riuscito.') }
      finally { setBusy(false) }
    }}><h2>Accedi al tuo profilo</h2><label>Email <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>Password <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      <button disabled={busy}>Accedi</button><p>Usa il tuo account aziendale personale.</p></form>}
    {session && feed && <>
      {!feed.operatorName && <p className="live-alert">Il titolare deve collegare questo account al tuo operatore prima di avviare il lavoro.</p>}
      <p role="status">{stale ? 'Collegamento interrotto: il tempo sul server continua. I comandi sono sospesi finché la connessione non torna.' : 'Tablet aggiornato · sincronizzazione ogni 2 secondi'}</p>
      {feed.today && <section className="live-day-hours"><h2>Le mie ore di oggi</h2><HoursTotals report={feed.today} elapsed={(performance.now() - lastSample.current) / 1000} stale={stale} />
        <p>Conteggio dei periodi di lavoro avviati con Start. Pausa e Fine fermano il conteggio personale. Gli extra superano l’orario giornaliero configurato.</p></section>}
      {feed.operatorName && <section className="live-day-hours"><h2>I miei lavori assegnati</h2>
        {feed.program?.length ? <ol>{feed.program.map(task => <li key={task.id}><strong>{task.plate} · {task.phaseName}</strong>
          <p>Previsto: {new Date(task.startAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</p>
          {!!task.panels?.length && <p>{task.panels.join(', ')}</p>}
          {task.ready ? <a href={`#vettura-${encodeURIComponent(task.jobId)}`} onClick={() => setPhaseChoices(current => ({ ...current, [task.jobId]: task.phaseId }))}>Apri vettura e fase</a>
            : <p>Il titolare deve confermare il budget prima di avviare il lavoro.</p>}</li>)}</ol>
          : <p>Nessun lavoro assegnato nel Programma operatori. Puoi consultare le vetture disponibili qui sotto.</p>}
      </section>}
      <p>Il tempo è condiviso fra tutti gli operatori attivi sulla vettura. Pausa e Fine riguardano soltanto il tuo lavoro. Fine non chiude la commessa.</p>
      <section className="live-job-grid" aria-label="Vetture disponibili">
        {feed.jobs.map(job => {
          const clock = liveCountdown(job, (performance.now() - lastSample.current) / 1000)
          const availablePhases = (job.phases ?? []).filter(p => !p.notRequired && !['Completata', 'Bloccata'].includes(p.status))
          const selected = [phaseChoices[job.jobId], job.ownPhaseId, availablePhases[0]?.id].find(id => availablePhases.some(p => p.id === id)) ?? ''
          const requiresPhase = (job.phases ?? []).some(p => !p.notRequired)
          return <article key={job.jobId} id={`vettura-${job.jobId}`} className={`live-job ${!stale && clock.warning ? 'live-warning' : ''}`}>
            <h2>{job.plate}</h2><p>Commessa {job.number}</p>
            <p>{feed.operatorName ? 'Ore disponibili per te se lavori da solo · costo totale' : 'Tempo residuo della squadra attiva'}</p>
            <strong className="live-clock" aria-label={feed.operatorName ? 'Ore disponibili per te' : 'Tempo residuo squadra'}>{stale ? 'Da aggiornare' : clockText(feed.operatorName ? clock.individualSeconds : clock.seconds)}</strong>
            {job.activeCount > 1 && <p>Anche il lavoro dei colleghi riduce le tue ore disponibili sul budget comune.</p>}
            {job.activeCount > 0 && feed.operatorName && <p>{`Tempo residuo con ${job.activeCount} operatori attivi`}: <strong>{stale ? 'Da aggiornare' : clockText(clock.seconds)}</strong></p>}
            {!stale && clock.warning && <p role="status">{clock.exhausted ? 'Budget esaurito: lavoro oltre il tempo disponibile' : 'Attenzione: rimane meno del 20% del budget di lavoro'}</p>}
            <p>{job.operators.map(o => `${o.name}: ${o.status === 'running' ? 'al lavoro' : o.status === 'paused' ? 'in pausa' : 'terminato'}`).join(' · ') || 'Nessun operatore avviato'}</p>
            {requiresPhase && <label>Fase da lavorare<select aria-label={`Fase da lavorare su ${job.plate}`} value={selected} disabled={busy || job.ownStatus === 'running'}
              onChange={e => setPhaseChoices(current => ({ ...current, [job.jobId]: e.target.value }))}>
              {!availablePhases.length && <option value="">Nessuna fase disponibile</option>}
              {availablePhases.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}
            <div className="live-controls"><button disabled={busy || stale || !feed.operatorName || job.ownStatus === 'running' || (requiresPhase && !selected) || !!(ownRunning && ownRunning.jobId !== job.jobId)}
              onClick={() => void act('production_timer_action', { p_job_id: job.jobId, p_action: 'start', p_phase_id: selected || null })}>{job.ownStatus === 'paused' ? 'Riprendi' : 'Start'}</button>
              <button disabled={busy || stale || job.ownStatus !== 'running'} onClick={() => void act('production_timer_action', { p_job_id: job.jobId, p_action: 'pause' })}>Pausa</button>
              <button disabled={busy || stale || !['running', 'paused'].includes(job.ownStatus ?? '')} onClick={() => void act('production_timer_action', { p_job_id: job.jobId, p_action: 'finish' })}>Fine</button></div>
            {!!job.tasks?.length && <details open><summary>Lavori da fare</summary><ul>{job.tasks.map(task => <li key={task.id}>{task.description}{task.quantity > 1 ? ` × ${task.quantity}` : ''}</li>)}</ul></details>}
            {!!job.phases?.length && <section className="live-phases" aria-label={`Fasi di ${job.plate}`}><h3>Avanzamento fasi</h3>
              <p>{availablePhases[0] ? `Prossima fase da completare: ${availablePhases[0].name}` : 'Nessuna fase aperta e disponibile'}</p>
              <ol>{job.phases.filter(p => !p.notRequired).map(phase => <li key={phase.id}>
                <strong>{phase.status === 'Completata' ? '✓ ' : ''}{phase.name}</strong>
                {phase.checkedBy && phase.checkedAt ? <p>Visto di {phase.checkedBy} · {new Date(phase.checkedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</p>
                  : <p>{phase.status === 'Completata' ? 'Completata nel gestionale · visto non registrato' : phase.status}</p>}
                {phase.blockedReason && phase.status === 'Bloccata' && <p>{phase.blockedReason}</p>}
                {!['Completata', 'Bloccata'].includes(phase.status) && <button disabled={busy || stale || !phase.canComplete}
                  onClick={() => void act('production_complete_phase', { p_job_id: job.jobId, p_phase_id: phase.id })}>✓ Completa {phase.name}</button>}
              </li>)}</ol><p>Il visto registra chi ha completato la fase e ferma il suo timer su quella fase. Gli altri operatori devono prima mettere in pausa o terminare il lavoro sulla stessa fase.</p>
            </section>}
          </article>
        })}
        {!feed.jobs.length && <p>Il titolare deve confermare il budget della prima commessa.</p>}
      </section>
      {['owner', 'office'].includes(feed.role) && <EmployeeHours feed={feed} session={session} config={config!} elapsed={(performance.now() - lastSample.current) / 1000} stale={stale} />}
      {feed.role === 'owner' && snapshot && <details className="live-admin"><summary>Configurazione tablet e budget · Titolare</summary>
        <h2>Collega gli account agli operatori</h2><p>Gli account devono già appartenere all’azienda. Un profilo per operatore. Anche un account Ufficio può essere collegato: conserva l’accesso all’ufficio e usa sul tablet le mansioni e gli orari del proprio operatore.</p>
        {feed.members.map(member => <label key={member.userId}>{member.name}<select aria-label={`Operatore per ${member.name}`} value={member.operatorId ?? ''} disabled={busy}
          onChange={e => { if (e.target.value) void act('production_bind_profile', { p_user_id: member.userId, p_operator_id: e.target.value }) }}>
          <option value="">Da collegare</option>{snapshot.payload.plannerSettings.operators.filter(o => o.active).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>)}
        <h2>Conferma il budget delle commesse</h2><p>Prezzi IVA esclusa, meno materiali e costi diretti. Il budget e le tariffe si congelano al primo Start. Queste ore sono il limite economico a pareggio; non riservano un margine di utile.</p>
        <button disabled={busy} onClick={async () => { try { setSnapshot(await loadCloudSnapshot(companyId, session, config!)) } catch (e) { setError(e instanceof Error ? e.message : 'Aggiornamento non riuscito.') } }}>Aggiorna preventivi e costi</button>
        {(snapshot.payload.jobs ?? []).filter(j => !['Consegnata', 'Annullata'].includes(j.status)).map(job => {
          let budget: ReturnType<typeof prepareLiveJob> | undefined; let problem = ''
          try { budget = prepareLiveJob(snapshot.payload, job) } catch (e) { problem = e instanceof Error ? e.message : 'Budget non valido' }
          const used = feed.jobs.find(j => j.jobId === job.id)?.operators.length
          return <div key={job.id} className="live-budget"><strong>{job.plate} · {job.number}</strong>
            {problem ? <p>{problem}</p> : <p>Ricavo {budget!.revenue.toFixed(2)} € − materiali {budget!.materials.toFixed(2)} € − costi diretti {budget!.directCosts.toFixed(2)} € = budget {budget!.budget.toFixed(2)} €</p>}
            <button disabled={busy || !!problem || !!used} onClick={() => void act('production_prepare_job', { p_job_id: job.id, p_revision: snapshot.revision, p_budget: budget!.budget, p_rates: budget!.operators })}>
              {used ? 'Budget congelato · lavoro registrato' : 'Conferma budget e tariffe'}</button></div>
        })}
      </details>}
    </>}
  </main>
}
