import { useEffect, useState } from 'react'
import { productionRpc } from '../../services/liveProduction'
import type { NoticesConnection } from './PhaseNotices'
export function PrivatePasswordSettings({connection}:{connection:NoticesConnection}) {
 const [configured,setConfigured]=useState<boolean|null>(null)
 const [old,setOld]=useState(''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState('')
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{let stop=false;void productionRpc<{configured:boolean}>('production_private_password',{p_company_id:connection.companyId},connection.session,connection.config).then(r=>{if(!stop)setConfigured(r.configured)}).catch(()=>{if(!stop)setMessage('Configurazione riservata al titolare. Attiva prima l’aggiornamento Supabase.')});return()=>{stop=true}},[connection.companyId,connection.session.accessToken,connection.config.url,connection.config.anonKey])
 useEffect(()=>{const hide=()=>{if(document.hidden){setOld('');setPassword('');setRepeat('')}};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide)},[])
 return <details className="panel"><summary>Imposta o cambia password dei blocchi</summary><p>Una password riservata per preventivi confermati, report ore e produttività. La password condivisa di accesso al gestionale rimane indipendente. Per cambiarla devi conoscere quella attuale.</p>
  {configured!==null&&<form onSubmit={async e=>{e.preventDefault();if(busy)return;if(password!==repeat){setMessage('Le password non coincidono.');return}setBusy(true);setMessage('');try{const r=await productionRpc<{ok:boolean;message?:string}>('production_private_password',{p_company_id:connection.companyId,p_action:'set',p_password:configured?old:null,p_new_password:password},connection.session,connection.config);if(!r.ok)throw Error(r.message||'Password non corretta.');setConfigured(true);setMessage('Password dei blocchi salvata. Usala nei pulsanti Sblocca con password.')}catch(e){setMessage(e instanceof Error?e.message:'Salvataggio non riuscito.')}finally{setOld('');setPassword('');setRepeat('');setBusy(false)}}}>
   {configured&&<label>Password attuale dei blocchi<input type="password" autoComplete="current-password" value={old} required onChange={e=>setOld(e.target.value)} /></label>}
   <label>Nuova password dei blocchi<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} /></label>
   <label>Ripeti nuova password<input type="password" autoComplete="new-password" minLength={8} required value={repeat} onChange={e=>setRepeat(e.target.value)} /></label>
   <button disabled={busy}>{busy?'Salvataggio…':configured?'Cambia password dei blocchi':'Imposta password dei blocchi'}</button>
  </form>}{message&&<p role="status">{message}</p>}
 </details>
}
