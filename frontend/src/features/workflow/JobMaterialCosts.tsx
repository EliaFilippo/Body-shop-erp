import { useState } from 'react'
import type { RepairJob } from '../../types'
import { MoneyInput } from '../../components/MoneyInput'
import { calculateJobMaterialMargin } from '../../services/jobMaterialCosts'
const euro=(n:number)=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
export function JobMaterialCosts({job,onSave}:{job:RepairJob;onSave:(amount:number,note:string)=>void}){
 const [amount,setAmount]=useState<number|null>(job.materialActualCost?.amount??null)
 const [note,setNote]=useState(job.materialActualCost?.note??'')
 const [message,setMessage]=useState('');const [error,setError]=useState('')
 const snapshot=calculateJobMaterialMargin(job)
 const preview=amount===null?snapshot:calculateJobMaterialMargin({...job,materialActualCost:{amount,at:'',note}})
 return <section className="panel" aria-label="Materiali a consuntivo"><h3>Materiali a consuntivo</h3>
  <p>Nel preventivo il consumo è stimato al 20% delle lavorazioni, salvo valori già concordati. A fine lavoro inserisci il totale reale dei materiali di consumo utilizzati: vernice, trasparente, fondo, abrasivi e altri consumabili.</p>
  <div className="summary-grid"><div className="summary-card"><span>Materiali stimati nel preventivo</span><strong>{euro(snapshot.estimatedMaterials)}</strong></div>
   <div className="summary-card"><span>Materiali reali salvati</span><strong>{snapshot.actualMaterials===null?'Da inserire':euro(snapshot.actualMaterials)}</strong></div>
   <div className="summary-card"><span>{amount===null&&snapshot.actualMaterials===null?'Margine previsto':'Margine con materiali reali'}{amount!==(job.materialActualCost?.amount??null)?' · anteprima':''}</span><strong>{preview.margin===null?'Costi da completare':euro(preview.margin)}</strong>{preview.marginPercent!==null&&<small>{preview.marginPercent}%</small>}</div>
   {preview.materialsSaving!==null&&<div className="summary-card"><span>Differenza materiali rispetto alla stima</span><strong>{euro(preview.materialsSaving)}</strong></div>}
  </div>
  <p>Il totale reale sostituisce la stima dei consumi e comprende anche gli eventuali consumabili già conteggiati nel preventivo. Ricambi e lavorazioni esterne restano costi separati. Il prezzo al cliente non cambia.</p>
  <p>Il margine mantiene la manodopera, i costi di struttura e gli altri costi del preventivo: questo riquadro aggiorna il consuntivo dei materiali.</p>
  {snapshot.missingCosts&&<p role="status">Completa le tariffe interne e i costi diretti del preventivo per ottenere il margine. Il costo effettivo dei materiali può comunque essere salvato.</p>}
  <form onSubmit={e=>{e.preventDefault();try{if(amount===null)throw new Error('Inserisci il totale effettivo, anche zero se non hai consumato materiali.');onSave(amount,note);setMessage(snapshot.missingCosts?'Costo reale salvato. Completa gli altri costi per calcolare il margine.':'Costo reale salvato. Margine ricalcolato.');setError('')}catch(problem){setError(problem instanceof Error?problem.message:'Salvataggio non riuscito.')}}}>
   <div className="form-grid"><label>Totale materiali effettivi · IVA esclusa<MoneyInput value={amount} onValueChange={value=>{setAmount(value);setMessage('')}}/></label>
    <label>Nota materiali<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Es. costo vernice e consumabili della riparazione"/></label></div>
   <button className="primary" disabled={job.status==='Annullata'}>Salva costo reale materiali</button>
   {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </form>
  {!!job.materialCostHistory?.length&&<details><summary>Storico costi materiali</summary>{job.materialCostHistory.slice(0,10).map((item,i)=><p key={i}>{new Date(item.at).toLocaleString('it-IT')} · {item.before===null?'Prima registrazione':euro(item.before)} → {euro(item.amount)}{item.note?` · ${item.note}`:''}</p>)}</details>}
 </section>
}
