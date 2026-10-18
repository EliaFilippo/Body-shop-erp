import { useEffect, useRef, useState, type ReactNode } from 'react'
import { type CloudAuthSession } from '../../services/cloudAuth'
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
 useEffect(()=>{if(!unlocked||!connection||!verified)return;let stop=false;const timer=setInterval(()=>{void productionRpc('production_report_access',{p_company_id:connection.companyId},verified,connection.config).catch(()=>{if(!stop){setVerified(null);setUntil(0)}})},5000);return()=>{stop=true;clearInterval(timer)}},[unlocked,connection?.companyId,connection?.config.url,connection?.config.anonKey,verified])
 useEffect(() => {
  const hide = () => { if (document.hidden) { generation.current++; setVerified(null); setUntil(0); setPassword('') } }
  document.addEventListener('visibilitychange', hide)
  return () => document.removeEventListener('visibilitychange', hide)
 }, [])
 return <section className="panel" aria-label={`${title} protetto`}><h3>{title} · accesso protetto</h3>
  {unlocked && verified ? <><p>Sbloccato per 5 minuti. <button type="button" onClick={() => { generation.current++; setVerified(null); setUntil(0) }}>Blocca</button></p>{children(verified)}</>
  : <><p>Inserisci la password dei blocchi, separata da quella di accesso al gestionale.</p><form onSubmit={async e => {
   e.preventDefault(); if (!connection || busy) return
   const request = generation.current
   setBusy(true); setError('')
   try {
    const session = connection.session
    const result = await productionRpc<{ok:boolean;message?:string}>('production_private_password', {p_company_id:connection.companyId,p_action:'unlock',p_password:password}, session, connection.config)
    if (!result.ok) throw new Error(result.message || 'Password dei blocchi non corretta.')
    await productionRpc('production_report_access', {p_company_id:connection.companyId}, session, connection.config)
    if (request !== generation.current || document.hidden) return
    setVerified(session); setUntil(Date.now()+300000); setNow(Date.now())
   } catch (e) { setError(e instanceof Error ? e.message : 'Sblocco non riuscito.') }
   finally { setPassword(''); setBusy(false) }
  }}><label>Password dei blocchi<input type="password" autoComplete="current-password" value={password} required onChange={e => setPassword(e.target.value)} /></label><button disabled={busy || !connection}>{busy ? 'Verifica…' : 'Sblocca con password'}</button></form></>}
  {error && <p role="alert">{error}</p>}
 </section>
}
