import { useState } from 'react'
import type { ErpData } from '../../types'
import type { NoticesConnection } from '../production/PhaseNotices'
import { productionRpc } from '../../services/liveProduction'
import type { ProductionPlanningState } from '../../services/productionPlanningState'
import { payrollEstimate, saveMonthlyPayroll } from '../../services/monthlyPayroll'
const money = (value:number) => value.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
const previousMonth = () => {const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()-1); return d.toISOString().slice(0,7)}
export function MonthlyPayrollPanel({data, connection, onChange}:{data:ErpData; connection?:NoticesConnection; onChange:(data:ErpData)=>void}) {
 const [month,setMonth]=useState(previousMonth)
 const [total,setTotal]=useState(''),[office,setOffice]=useState('0'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const saved=data.plannerSettings.monthlyPayrollActuals?.find(row=>row.month===month)
 return <details className="panel"><summary><strong>Consuntivo costo dipendenti</strong></summary>
 <p>Inserisci il costo aziendale del mese comunicato dal commercialista. Sostituisce il costo stimato del personale interno; gli esterni restano separati. La quota ufficio è compresa nel totale.</p>
 <p>La quota produzione viene ripartita in proporzione ai costi orari registrati. Le fasi che attraversano due mesi mantengono la stima: richiedono una ripartizione giornaliera. Le quote senza ore attribuibili restano nel risultato mensile.</p>
 <form className="form-grid" onSubmit={async event=>{event.preventDefault();setBusy(true);setMessage('');try {
   if(!connection) throw new Error('Collega il gestionale per verificare le ore tablet prima di registrare il consuntivo.')
   const state=await productionRpc<ProductionPlanningState>('production_planning_state',{p_company_id:connection.companyId},connection.session,connection.config)
   if(!Array.isArray(state.dailyWork))throw new Error('Ore tablet non disponibili: nessun consuntivo salvato.')
   onChange(saveMonthlyPayroll(data,month,Number(total),Number(office),payrollEstimate(data,month,state.dailyWork)))
   setMessage('Consuntivo registrato per '+month+'. Il totale effettivo sostituisce la stima; le ore lavorate restano invariate.')
 }catch(error){setMessage(error instanceof Error?error.message:'Salvataggio non riuscito.')}finally{setBusy(false)}}}>
 <label>Mese di competenza<input type="month" required value={month} disabled={busy} onChange={event=>{setMonth(event.target.value);setTotal('');setOffice('0');setMessage('')}} /></label>
 <label>Costo aziendale totale dipendenti (€)<input type="number" required min="0" step="0.01" value={total} disabled={busy} onChange={event=>setTotal(event.target.value)} /></label>
 <label>Di cui ufficio e personale non produttivo (€)<input type="number" required min="0" step="0.01" value={office} disabled={busy} onChange={event=>setOffice(event.target.value)} /></label>
 <button disabled={busy} type="submit">{saved?'Correggi consuntivo mensile':'Registra consuntivo mensile'}</button>
 </form>
 {saved&&<><p>Competenza {month} · Costo stimato sulle ore: {money(saved.estimated)} · Costo effettivo: {money(saved.total)} · Rettifica: {money(saved.total-saved.estimated)} ({saved.total>=saved.estimated?'costi da aggiungere':'costi da togliere'}).</p><p>Produzione: {money(saved.total-saved.officeCost)} · Ufficio: {money(saved.officeCost)}. Totale riconciliato: {money(saved.total)}.</p><details><summary>Storico correzioni</summary><ul>{saved.history.map((row,index)=><li key={index}>{new Date(row.at).toLocaleString('it-IT')} · Totale {money(row.total)} · Ufficio {money(row.officeCost)}</li>)}</ul></details></>}
 {message&&<p role="status">{message}</p>}
 </details>
}
