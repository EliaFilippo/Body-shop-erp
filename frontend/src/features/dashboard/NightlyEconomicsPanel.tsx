import type {NightlyEconomicSnapshot} from '../../types'
const money=(n:number|null)=>n===null?'Dato non disponibile':n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
const hours=(n:number)=>`${n.toLocaleString('it-IT',{maximumFractionDigits:2})} h`
export function NightlyEconomicsPanel({snapshot:s}:{snapshot:NightlyEconomicSnapshot}){
 return <section className="panel" aria-label="Tariffe e obiettivo dal ricalcolo notturno">
  <div className="panel-head"><div><span className="eyebrow">RICALCOLO NOTTURNO · {s.plannedFor}</span><h3>Tariffe separate e obiettivo giornaliero</h3></div></div>
  <div className="planner-detail-summary-grid economic-grid">
   <div><span>Costo orario consuntivo · struttura e personale</span><strong>{money(s.realHourlyCost)}{s.realHourlyCost!==null?'/h':''}</strong></div>
   <div><span>Tariffa obiettivo sul fatturato residuo</span><strong>{money(s.targetHourlyRate)}{s.targetHourlyRate!==null?'/h':''}</strong></div>
   <div><span>Obiettivo del {s.plannedFor}</span><strong>{money(s.dailyGoal)}</strong></div>
   <div><span>Ore produttive registrate nel mese</span><strong>{hours(s.productiveHours)}</strong></div>
   <div><span>Ore produttive residue stimate</span><strong>{hours(s.remainingProductiveHours)}</strong></div>
   <div><span>Fatturato netto ancora necessario</span><strong>{money(s.residualRevenue)}</strong></div>
  </div>
  <p>Priorità ai box: scartare le vetture verniciate e asciutte, verniciare quelle pronte, incartare e preparare le successive. Poi consegna, margine e attesa.</p>
  <details><summary>Come vengono calcolati i valori</summary>
   <p>Obiettivo mensile {money(s.monthlyGoal)}; fatturato emesso IVA esclusa {money(s.realizedNetRevenue)}. Il fatturato residuo è ripartito sulle ore produttive ancora disponibili; il peso di ogni giornata segue i suoi turni e le assenze.</p>
   <p>Capacità residua: {s.capacitySource==='observed'?'resa osservata nelle ore registrate':'efficienza configurata in attesa di uno storico sufficiente'} ({s.utilizationPercent.toLocaleString('it-IT')}%). Ore extra e fasi fuori preventivo registrate dai timer sono incluse.</p>
   <p>Costo consuntivo: {money(s.accruedOperatingCosts)} di costi operativi maturati ÷ {hours(s.productiveHours)} produttive. I costi mensili configurati sono riproporzionati ai giorni trascorsi. {s.payrollInMonthlyCosts?'Il personale è già nei costi mensili; si aggiungono solo gli operatori con costo esterno extra.':'Il personale è valorizzato alle tariffe operatore sulle ore registrate, comprese pulizie e pause caffè.'} Materiali e ricambi restano costi separati.</p>
   <p>Calcolo aggiornato alle {new Date(s.asOf).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}. I valori restano stabili fino al successivo ricalcolo notturno.</p>
  </details>
  {s.warnings.length>0&&<ul>{s.warnings.map(w=><li key={w}>{w}</li>)}</ul>}
 </section>
}
