import { useEffect, useRef, useState } from 'react'
import type { CloudAuthConfig, CloudAuthSession } from '../../services/cloudAuth'
import { productionRpc } from '../../services/liveProduction'
import './phaseNotices.css'

export interface NoticesConnection { companyId: string; session: CloudAuthSession; config: CloudAuthConfig }
interface PhaseNotice { id: string; phaseId: string; phaseName: string; body: string; authorName: string; authorRole: string; createdAt: string; reviewedName: string | null; reviewedAt: string | null }
const stamp = (value: string) => new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })

export function PhaseNotices({ connection, jobId, phases, office = false, closed = false }: {
  connection: NoticesConnection; jobId: string; phases: { id: string; name: string; notRequired?: boolean }[]; office?: boolean; closed?: boolean
}) {
  const [notices, setNotices] = useState<PhaseNotice[]>([])
  const [phaseId, setPhaseId] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState<{ id: string; body: string; phaseId: string } | null>(null)
  const lock = useRef(false)
  const generation = useRef(0)
  const { companyId, session, config } = connection
  const available = phases.filter(phase => !phase.notRequired)
  const selected = available.some(phase => phase.id === phaseId) ? phaseId : available[0]?.id ?? ''
  useEffect(() => { setNotices([]); setLoaded(false); setBody(''); setPending(null); setError('') }, [companyId, jobId])
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!lock.current) {
        const request = ++generation.current
        try {
          const result = await productionRpc<PhaseNotice[]>('production_phase_notices_action', { p_company_id: companyId, p_job_id: jobId }, session, config)
          if (!stopped && request === generation.current) { setNotices(result); setLoaded(true) }
        } catch (e) { if (!stopped && request === generation.current) setError(e instanceof Error ? e.message : 'Avvisi non disponibili.') }
      }
      if (!stopped) timer = setTimeout(poll, 5000)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer); generation.current++ }
  }, [companyId, jobId, session.accessToken, config.url, config.anonKey])
  async function act(action: 'add' | 'review', id?: string) {
    if (lock.current) return
    const draft = action === 'add' ? pending ?? { id: crypto.randomUUID(), body: body.trim(), phaseId: selected } : null
    if (draft && (!draft.body || !draft.phaseId)) return
    lock.current = true; setBusy(true); generation.current++; setError('')
    if (draft) setPending(draft)
    try {
      const result = await productionRpc<PhaseNotice[]>('production_phase_notices_action', { p_company_id: companyId, p_job_id: jobId, p_action: action,
        p_notice_id: draft?.id ?? id, ...(draft ? { p_phase_id: draft.phaseId, p_body: draft.body } : {}) }, session, config)
      setNotices(result); setLoaded(true)
      if (draft) { setBody(''); setPending(null) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Invio non riuscito. Il testo resta disponibile: riprova.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="phase-notices" aria-label="Avvisi per fase">
    <h3>{office ? 'Avvisi e verifica prima della chiusura' : 'Avvisi per fase'}</h3>
    <p>{office ? `${notices.filter(note => !note.reviewedAt).length} avvisi da verificare. Il visto indica che l’ufficio ha controllato l’avviso.` : 'Leggi le indicazioni dell’ufficio e lascia un messaggio ai colleghi.'}</p>
    {error && <p role="alert">{error}</p>}
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
