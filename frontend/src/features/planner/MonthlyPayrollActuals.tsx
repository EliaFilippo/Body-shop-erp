import type { VehicleWork } from '../../services/productionPlanningState'
import { useState } from 'react'
import type { ErpData, PlannerSettings } from '../../types'
import { MoneyInput } from '../../components/MoneyInput'
import { calculateGoalProgress } from '../../services/goalProgress'
const money=(n:number)=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
export function MonthlyPayrollActuals({data,onSave,vehicleWork}:{data:ErpData;vehicleWork?:VehicleWork[];onSave:(settings:PlannerSettings)=>void}) {
 const [month,setMonth]=useState(new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'}).slice(0,7))
 const [amount,setAmount]=useState<number|null>(null)
 const [note,setNote]=useState('')
 const [saved,setSaved]=useState(false)
 const [year,m]=month.split('-').map(Number)
 const end=month+'-'+String(new Date(Date.UTC(year,m,0)).getUTCDate()).padStart(2,'0')
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'})
 const p=calculateGoalProgress(data,end<today?end:today,vehicleWork)[2]
 const valid=month<=today.slice(0,7)&&amount!==null&&Number.isFinite(amount)&&amount>=0
 const delta=amount===null?p.payrollAdjustment:Math.round((amount-p.recognizedInternalLabor)*100)/100
 return <section className="panel"><h3>Consuntivo mensile dipendenti</h3>
 <p>Inserisci il costo aziendale totale comunicato dal commercialista nel mese di competenza, esclusi gli artigiani esterni. Si applica soltanto la differenza rispetto alla manodopera già sottratta dal margine mensile. Ore, tariffe e costi delle singole vetture restano registrati.</p>
 <div className="form-grid"><label>Mese di competenza<input type="month" value={month} onChange={e=>{if(e.target.value){setMonth(e.target.value);setAmount(null);setSaved(false)}}}/></label>
 <label>Costo effettivo dipendenti (€)<MoneyInput allowEmpty minValue={0} value={amount} onValueChange={n=>{setAmount(n??null);setSaved(false)}}/></label>
 <label>Nota<input value={note} onChange={e=>setNote(e.target.value)}/></label></div>
 <p>Costo dipendenti già conteggiato: <strong>{money(p.recognizedInternalLabor)}</strong>. Effettivo salvato: <strong>{p.payrollActual===undefined?'Non inserito':money(p.payrollActual)}</strong>.</p>
 <p style={{color:delta>0?'#ff6b6b':delta<0?'#67d9a3':undefined}}>{delta>0?'Costo da aggiungere':delta<0?'Costo da togliere':'Nessun conguaglio'}: <strong>{money(Math.abs(delta))}</strong></p>
 <p>Margine mensile dopo il conguaglio salvato: <strong>{money(p.done)}</strong>. Il conguaglio riguarda il totale mensile.</p>
 {p.incomplete&&<p role="status">Confronto parziale: alcuni consuntivi non sono disponibili.</p>}
 <button type="button" className="primary" disabled={!valid} onClick={()=>{if(!valid)return;onSave({...data.plannerSettings,monthlyPayrollActuals:[...(data.plannerSettings.monthlyPayrollActuals??[]),{id:crypto.randomUUID(),monthKey:month,amount:Math.round(amount!*100)/100,note:note.trim(),updatedAt:new Date().toISOString()}]});setAmount(null);setSaved(true)}}>Salva costo effettivo</button>
 {saved&&<p role="status">Consuntivo salvato e risultato del mese ricalcolato.</p>}
 <details><summary>Storico rettifiche</summary><ul>{[...(data.plannerSettings.monthlyPayrollActuals??[])].filter(r=>r.monthKey===month).reverse().map(r=><li key={r.id}>{money(r.amount)} · {new Date(r.updatedAt).toLocaleString('it-IT')} · {r.note}</li>)}</ul></details></section>
}
