import type { ErpData } from '../../types'
import { quoteStructureRate } from '../../services/quoteHourBudget'
const money=(n:number)=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
export function ConfirmedWorkOverview({data}:{data:ErpData}){
 const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit'}).format(new Date())
 const invoices=data.invoices.filter(i=>i.status!=='Stornata')
 const jobs=(data.jobs??[]).filter(j=>j.status!=='Annullata'&&!invoices.some(i=>i.vehicleId===j.vehicleId&&!!j.vehicleId||i.lines.some(l=>l.vehicleId===j.vehicleId&&!!j.vehicleId)))
 const open=jobs.filter(j=>j.status!=='Consegnata')
 const monthly=jobs.filter(j=>(j.expectedDeliveryDate||j.entryDate||j.createdAt).startsWith(month))
 const value=open.reduce((s,j)=>s+j.taxableAmount,0)
 const forecast=monthly.reduce((s,j)=>s+j.taxableAmount,0)
 const billed=invoices.filter(i=>i.issueDate.startsWith(month)).reduce((s,i)=>s+i.taxableAmount,0)
 const structure=quoteStructureRate(data.plannerSettings,month)
 const configured=structure.productiveHours>0&&structure.monthlyOverhead>0&&structure.excludedPayroll>0
 const materialPercent=data.plannerSettings.internalCostSettings?.budgetMaterialsPercent??20
 const margin=configured?open.reduce((sum,j)=>sum+j.taxableAmount-(j.materialActualCost?.amount??j.taxableAmount*materialPercent/100)-j.phases.filter(p=>!p.notRequired).reduce((s,p)=>s+p.estimatedMinutes,0)/60*structure.allInRate-j.lines.reduce((s,l)=>s+(l.budgetDirectUnitCost??0)*l.quantity,0),0):null
 const goal=Math.max(0,data.plannerSettings.monthlyRevenueGoal||0)
 return <section className="panel" aria-label="Lavori confermati e obiettivo"><h3>Lavori confermati e obiettivo mensile</h3>
 <div className="owner-kpi-grid">
 <article className="owner-kpi-card"><span>Commesse aperte da fatturare</span><strong>{open.length}</strong><small>Pratiche confermate, escluse annullate e già fatturate.</small></article>
 <article className="owner-kpi-card"><span>Valore lavori aperti, IVA esclusa</span><strong>{money(value)}</strong><small>Portafoglio di tutti i mesi.</small></article>
 <article className="owner-kpi-card"><span>Margine stimato lavori aperti</span><strong>{margin===null?'Da configurare':money(margin)}</strong><small>Materiali, costi diretti e costo medio di personale e struttura. Tempi previsti; non è utile consuntivo.</small></article>
 <article className="owner-kpi-card"><span>Fatturato + lavori previsti nel mese</span><strong>{money(billed+forecast)}</strong><small>{money(billed)} fatturati + {money(forecast)} da fatturare.</small></article>
 </div><p>Obiettivo {month}: <strong>{money(goal)}</strong> · Copertura prevista: <strong>{goal>0?((billed+forecast)/goal*100).toFixed(1)+'%':'Obiettivo da configurare'}</strong> · Mancano: <strong>{money(Math.max(0,goal-billed-forecast))}</strong>.</p>
 <p>Previsione basata sulla consegna prevista; se assente, sulla data di ingresso. Il caricamento di una vettura senza commessa confermata non genera ricavi. Gli importi previsti non sono incassi e non aumentano la liquidità.</p></section>
}
