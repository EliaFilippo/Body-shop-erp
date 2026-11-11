import { useEffect, useRef, useState } from 'react'
import type { CloudAuthConfig, CloudAuthSession } from '../../services/cloudAuth'
import { productionRpc } from '../../services/liveProduction'
import './phaseNotices.css'

export interface NoticesConnection { companyId: string; session: CloudAuthSession; config: CloudAuthConfig }
interface PhaseNotice { id: string; phaseId: string; phaseName: string; body: string; authorName: string; authorRole: string; createdAt: string; reviewedName: string | null; reviewedAt: string | null }
const noticesRefreshMs = 15_000
const noticesRetryMs = 60_000
const stamp = (value: string) => new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })

export function useTabletNotices(companyId: string, session: CloudAuthSession | null, config: CloudAuthConfig | null, jobIds: string[]) {
  const idsKey = JSON.stringify([...new Set(jobIds)].sort())
  const key = JSON.stringify([companyId, session?.userId, config?.url, idsKey])
  const [result, setResult] = useState<{ key: string; notices: Record<string, PhaseNotice[]>; error: string }>()
  const generation = useRef(0)

  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[]
    if (!session || !config || !companyId || !ids.length) return
    let stopped = false
    let request: AbortController | undefined
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (stopped || document.hidden || request) return
      const controller = new AbortController()
      request = controller
      const started = generation.current
      let nextDelay = noticesRefreshMs
      try {
        const notices = await productionRpc<Record<string, PhaseNotice[]>>('production_phase_notices_batch',
          { p_company_id: companyId, p_job_ids: ids }, session, config, undefined, controller.signal)
        if (!controller.signal.aborted && started === generation.current) setResult({ key, notices, error: '' })
      } catch (problem) {
        nextDelay = noticesRetryMs
        if (!controller.signal.aborted && started === generation.current) {
          const error = problem instanceof Error ? problem.message : 'Avvisi non disponibili.'
          setResult(previous => ({ key, notices: previous?.key === key ? previous.notices : {}, error }))
        }
      } finally {
        request = undefined
        if (!stopped && !document.hidden) timer = setTimeout(poll, nextDelay)
      }
    }
    const visibilityChanged = () => {
      clearTimeout(timer)
      if (document.hidden) request?.abort()
      else void poll()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    void poll()
    return () => {
      stopped = true
      request?.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [companyId, session, config, idsKey, key])

  return {
    forJob: (jobId: string) => ({
      notices: result?.key === key ? result.notices[jobId] ?? [] : [],
      loaded: result?.key === key,
      error: result?.key === key ? result.error : '',
      update: (notices: PhaseNotice[]) => {
        generation.current++
        setResult(previous => ({ key, notices: { ...(previous?.key === key ? previous.notices : {}), [jobId]: notices }, error: '' }))
      },
    }),
  }
}

export function PhaseNotices({ connection, jobId, phases, office = false, closed = false, shared }: {
  connection: NoticesConnection; jobId: string; phases: { id: string; name: string; notRequired?: boolean }[]; office?: boolean; closed?: boolean; shared?: { notices: PhaseNotice[]; loaded: boolean; error: string; update: (notices: PhaseNotice[]) => void }
}) {
  const [localNotices, setNotices] = useState<PhaseNotice[]>([])
  const [phaseId, setPhaseId] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [localLoaded, setLoaded] = useState(false)
  const [pending, setPending] = useState<{ id: string; body: string; phaseId: string } | null>(null)
  const lock = useRef(false)
  const generation = useRef(0)
  const { companyId, session, config } = connection
  const notices = shared?.notices ?? localNotices
  const loaded = shared?.loaded ?? localLoaded
  const usesSharedNotices = Boolean(shared)
  const available = phases.filter(phase => !phase.notRequired)
  const selected = available.some(phase => phase.id === phaseId) ? phaseId : available[0]?.id ?? ''
  useEffect(() => { setNotices([]); setLoaded(false); setBody(''); setPending(null); setError(''); setReadError('') }, [companyId, jobId])
  useEffect(() => {
    if (usesSharedNotices) return
    let stopped = false
    let pendingRead: AbortController | undefined
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (stopped || document.hidden || pendingRead) return
      if (lock.current) {
        timer = setTimeout(poll, noticesRefreshMs)
        return
      }
      const controller = new AbortController()
      pendingRead = controller
      const request = ++generation.current
      let nextDelay = noticesRefreshMs
      try {
        const result = await productionRpc<PhaseNotice[]>('production_phase_notices_action',
          { p_company_id: companyId, p_job_id: jobId }, session, config, undefined, controller.signal)
        if (!stopped && !controller.signal.aborted && request === generation.current) {
          setNotices(result)
          setLoaded(true)
          setReadError('')
        }
      } catch (problem) {
        nextDelay = noticesRetryMs
        if (!stopped && !controller.signal.aborted && request === generation.current) {
          setReadError(problem instanceof Error ? problem.message : 'Avvisi non disponibili.')
        }
      } finally {
        pendingRead = undefined
        if (!stopped && !document.hidden) timer = setTimeout(poll, nextDelay)
      }
    }
    const visibilityChanged = () => {
      clearTimeout(timer)
      if (document.hidden) pendingRead?.abort()
      else void poll()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    void poll()
    return () => {
      stopped = true
      pendingRead?.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visibilityChanged)
      generation.current++
    }
  }, [companyId, jobId, session.accessToken, config.url, config.anonKey, usesSharedNotices])
  async function act(action: 'add' | 'review', id?: string) {
    if (lock.current) return
    const draft = action === 'add' ? pending ?? { id: crypto.randomUUID(), body: body.trim(), phaseId: selected } : null
    if (draft && (!draft.body || !draft.phaseId)) return
    lock.current = true; setBusy(true); generation.current++; setError('')
    if (draft) setPending(draft)
    try {
      const result = await productionRpc<PhaseNotice[]>('production_phase_notices_action', { p_company_id: companyId, p_job_id: jobId, p_action: action,
        p_notice_id: draft?.id ?? id, ...(draft ? { p_phase_id: draft.phaseId, p_body: draft.body } : {}) }, session, config)
      if (shared) shared.update(result)
      else { setNotices(result); setLoaded(true) }
      if (draft) { setBody(''); setPending(null) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Invio non riuscito. Il testo resta disponibile: riprova.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="phase-notices" aria-label="Avvisi per fase">
    <h3>{office ? 'Avvisi e verifica prima della chiusura' : 'Avvisi per fase'}</h3>
    <p>{office ? `${notices.filter(note => !note.reviewedAt).length} avvisi da verificare. Il visto indica che l’ufficio ha controllato l’avviso.` : 'Leggi le indicazioni dell’ufficio e lascia un messaggio ai colleghi.'}</p>
    {(error || shared?.error || readError) && <p role="alert">{error || shared?.error || readError}</p>}
    {!loaded && <p>Caricamento avvisi…</p>}
    {loaded && !notices.length && <p>Nessun avviso registrato.</p>}
    <ul>{notices.map(note => <li key={note.id} className={note.reviewedAt ? 'notice-reviewed' : 'notice-open'}>
      <strong>{note.phaseName}</strong><p className="notice-body">{note.body}</p>
      <small>{note.authorName} · {note.authorRole === 'production' ? 'Operatore' : 'Ufficio'} · {stamp(note.createdAt)}</small>
      {note.reviewedAt ? <p>✓ Verificato da {note.reviewedName} · {stamp(note.reviewedAt)}</p>
        : office ? <button type="button" disabled={busy} onClick={() => void act('review', note.id)}>✓ Verificato dall’ufficio</button> : <p>Da verificare dall’ufficio</p>}
    </li>)}</ul>
    {!closed && !!available.length && <div className="notice-compose">
      <label>Fase dell’avviso<select value={selected} disabled={busy || !!pending} onChange={event => setPhaseId(event.target.value)}>{available.map(phase => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select></label>
      <label>Scrivi un avviso<textarea rows={3} maxLength={2000} value={body} disabled={busy || !!pending} onChange={event => setBody(event.target.value)} placeholder="Indicazioni, problemi riscontrati o informazioni per la fase successiva" /></label>
      <button type="button" disabled={busy || !body.trim() || !selected} onClick={() => void act('add')}>{busy ? 'Invio…' : pending ? 'Riprova invio avviso' : 'Invia avviso'}</button>
      {pending && !busy && <p>L’invio non è stato confermato: riprova per verificare la registrazione senza duplicare l’avviso.</p>}
    </div>}
    {closed && <p>Commessa chiusa: la cronologia degli avvisi resta consultabile.</p>}
  </section>
}
