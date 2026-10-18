import { useEffect, useRef, useState, type ReactNode } from 'react'
import { signInWithPassword, type CloudAuthSession } from '../../services/cloudAuth'
import { productionRpc } from '../../services/liveProduction'
import type { NoticesConnection } from './PhaseNotices'

export function OwnerPasswordGate({ connection, title, children, onAccessChange }: {
 connection?: NoticesConnection; title: string; children: (session: CloudAuthSession) => ReactNode; onAccessChange?: (unlocked: boolean) => void;
}) {
 const generation = useRef(0)
 const [verified, setVerified] = useState<CloudAuthSession | null>(null)
 const [password, setPassword] = useState('')
 const [until, setUntil] = useState(0)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [now, setNow] = useState(Date.now)
 const unlocked = !!verified && now < until
 useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
 useEffect(() => { generation.current++; setVerified(null); setUntil(0); setPassword(''); return()=>{generation.current++} }, [connection?.companyId, connection?.session.userId])
 useEffect(() => { onAccessChange?.(unlocked) }, [unlocked, onAccessChange])
 useEffect(() => {
  const hide = () => { if (document.hidden) { generation.current++; setVerified(null); setUntil(0); setPassword('') } }
  document.addEventListener('visibilitychange', hide)
  return () => document.removeEventListener('visibilitychange', hide)
 }, [])
 return <section className="panel" aria-label={`${title} protetto`}><h3>{title} · accesso protetto</h3>
  {unlocked && verified ? <><p>Sbloccato per 5 minuti. <button type="button" onClick={() => { generation.current++; setVerified(null); setUntil(0) }}>Blocca</button></p>{children(verified)}</>
  : <><p>Inserisci la password personale dell’account titolare.</p><form onSubmit={async e => {
   e.preventDefault(); if (!connection || busy) return
   const request = generation.current
   setBusy(true); setError('')
   try {
    const session = await signInWithPassword(connection.session.email, password, connection.config)
    if (session.userId !== connection.session.userId) throw new Error('Account diverso')
    await productionRpc('production_report_access', {p_company_id:connection.companyId}, session, connection.config)
    if (request !== generation.current || document.hidden) return
    setVerified(session); setUntil(Date.now()+300000); setNow(Date.now())
   } catch { setError('Sblocco non riuscito. Usa la password del tuo account titolare.') }
   finally { setPassword(''); setBusy(false) }
  }}><label>Password del titolare<input type="password" autoComplete="current-password" value={password} required onChange={e => setPassword(e.target.value)} /></label><button disabled={busy || !connection}>{busy ? 'Verifica…' : 'Sblocca con password'}</button></form></>}
  {error && <p role="alert">{error}</p>}
 </section>
}
