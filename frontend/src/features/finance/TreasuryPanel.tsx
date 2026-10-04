import type { ErpData } from '../../types'
import { treasuryPlan } from '../../services/treasury'
const money=(amount:number)=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(amount)
export function TreasuryPanel({data,compact = false}: {data:ErpData;compact?:boolean}) {
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date())
 const plan=treasuryPlan(data,today)
 if(compact) return <section className="panel"><h3>Scadenze da controllare · 15 giorni</h3>{plan.alerts.length?<ul>{plan.alerts.slice(0,8).map(item=><li key={`${item.kind}-${item.id}`}><strong>{item.kind} · {item.date}</strong>: {item.title} · {money(item.amount)}</li>)}</ul>:<p>Nessuna scadenza da segnalare.</p>}<p>Apri Finance per tutte le scadenze e il prospetto degli anticipi R.I.B.A.</p></section>
 return <section className="panel"><span className="eyebrow">SCADENZE E ANTICIPI · 90 GIORNI</span><h3>Castelletto R.I.B.A. · 40.000 €</h3>
 <div className="stat-grid"><div className="stat-card"><span>Castelletto utilizzato</span><strong>{money(plan.exposure)}</strong></div><div className="stat-card"><span>Disponibile</span><strong>{money(plan.available)}</strong></div><div className="stat-card"><span>Fabbisogno stimato di anticipo</span><strong>{money(plan.needed)}</strong><small>Prima del {plan.criticalDate}</small></div><div className="stat-card"><span>Anticipo proponibile</span><strong>{money(plan.proposedAmount)}</strong><small>{plan.proposed.length} fatture / distinte · prima di commissioni e interessi</small></div></div>
 <p>Calcolo sui saldi bancari aggiornati, fatture emesse e uscite registrate. I preventivi non fatturati non sono considerati denaro certo. Un anticipo non aumenta il fatturato: per l’obiettivo mensile restano {money(plan.revenueGap)} di fatturato IVA esclusa.</p>
 {!plan.hasBankBalance&&<p role="alert">Inserisci il saldo della banca: senza saldo il fabbisogno non è attendibile.</p>}
 {plan.uncovered>0&&<p role="alert">Fabbisogno non coperto dalle R.I.B.A. disponibili: {money(plan.uncovered)}. Mancano copertura o crediti anticipabili. La banca deve confermare ammissibilità e data di accredito.</p>}
 {plan.proposed.length>0&&<table><thead><tr><th>Documento da anticipare</th><th>Scadenza</th><th>Importo proposto</th></tr></thead><tbody>{plan.proposed.map(item=><tr key={`${item.kind}-${item.id}`}><td>{item.kind} {item.number}</td><td>{item.date}</td><td>{money(item.proposedAmount)}</td></tr>)}</tbody></table>}
 <h3>Avvisi a 15 giorni</h3><p>Gli avvisi sono visibili nel gestionale e restano fino alla registrazione del pagamento o della presentazione della R.I.B.A.</p>
 {plan.alerts.length? <ul>{plan.alerts.map(item=><li key={`${item.kind}-${item.id}`}><strong>{item.kind} · {item.date<today?'SCADUTO':item.date}</strong>: {item.title} · {money(item.amount)}</li>)}</ul>:<p>Nessuna scadenza da segnalare nei prossimi 15 giorni.</p>}
 </section>
}
