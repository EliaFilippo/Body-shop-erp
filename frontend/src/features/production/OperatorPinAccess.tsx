import { useEffect, useState } from 'react'
import type { CloudAuthConfig, CloudAuthSession } from '../../services/cloudAuth'
import type { PlannerOperator } from '../../types'
import { configureOperatorPin, identifyTablet, signInWithPin, tabletLink, type TabletPairing } from '../../services/operatorPin'

export function OperatorPinLogin({ pairing,config,onLogin }:{pairing:TabletPairing;config:CloudAuthConfig;onLogin:(s:CloudAuthSession)=>void}) {
  const [name,setName]=useState('')
  const [pin,setPin]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{ let cancelled=false; void identifyTablet(pairing,config).then(r=>{if(!cancelled)setName(r.name)}).catch(()=>{if(!cancelled)setError('Tablet non collegato o accesso PIN non ancora attivato. Contatta il titolare.')}); return()=>{cancelled=true} },[pairing,config])
  return <form className="live-login" onSubmit={async e=>{
    e.preventDefault();if(busy)return;setBusy(true);setError('')
    try { onLogin(await signInWithPin(pairing,pin,config)) }
    catch(e){setError(e instanceof Error?e.message:'Accesso non riuscito.')}
    finally{setPin('');setBusy(false)}
  }}><h2>{name || 'Accesso operatore'}</h2><p>Produzione e programma lavorativo personale.</p>
    <label>PIN personale <input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} minLength={6} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))} required /></label>
    {error && <p role="alert">{error}</p>}<button disabled={busy || !name}>{busy?'Accesso…':'Inizia giornata'}</button></form>
}
export function OperatorPinAdmin({companyId,operators,session,config}:{companyId:string;operators:PlannerOperator[];session:CloudAuthSession;config:CloudAuthConfig}) {
  const [operatorId,setOperatorId]=useState('')
  const [pin,setPin]=useState('')
  const [confirm,setConfirm]=useState('')
  const [link,setLink]=useState('')
  const [name,setName]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [copied,setCopied]=useState(false)
  return <section className="live-pin-admin"><h2>Accessi tablet con PIN</h2>
    <p>Un profilo personale per operatore, senza email personale. Il collegamento abilita solo la produzione. Custodisci il link del tablet e comunica il PIN solo al dipendente.</p>
    <form onSubmit={async e=>{
      e.preventDefault();if(busy)return;setError('');setLink('');setCopied(false)
      if(pin!==confirm){setError('I due PIN non coincidono.');return}
      setBusy(true)
      try{const result=await configureOperatorPin(companyId,operatorId,pin,session,config);setName(result.name);setLink(tabletLink({companyId,operatorId,pairing:result.pairing}))}
      catch(e){setError(e instanceof Error?e.message:'Configurazione non riuscita.')}
      finally{setPin('');setConfirm('');setBusy(false)}
    }}><label>Operatore per accesso PIN <select required value={operatorId} onChange={e=>{setOperatorId(e.target.value);setLink('');setError('')}}><option value="">Scegli operatore</option>{operators.filter(o=>o.active).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label>Nuovo PIN di 6 cifre <input type="password" autoComplete="new-password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))} /></label>
      <label>Ripeti il PIN <input type="password" autoComplete="new-password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={confirm} onChange={e=>setConfirm(e.target.value.replace(/\D/g,''))} /></label>
      <p>Configurare di nuovo il PIN sostituisce anche il link: dovrai riaprire quello nuovo sul tablet. Il lavoro già registrato resta associato all’operatore.</p>
      <button disabled={busy}>{busy?'Configurazione…':'Attiva PIN e prepara tablet'}</button></form>
    {error && <p role="alert">{error}</p>}
    {link && <div><p>Profilo produzione di {name} pronto. Apri questo link sul tablet assegnato.</p><label>Link personale del tablet <input readOnly value={link} onFocus={e=>e.target.select()} /></label>
      <button onClick={async()=>{try{await navigator.clipboard.writeText(link);setCopied(true)}catch{setError('Seleziona il link e copialo manualmente.')}}}>{copied?'Link copiato':'Copia link tablet'}</button></div>}
  </section>
}
