import type { AcceptanceQuote, NightlyEconomicSnapshot, PlannerSettings } from '../../types'
import type { marginTargetRate } from '../../services/marginTargetRate'
import { quoteEconomics } from '../../services/quoteEconomics'
const money=(value:number)=>value.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
const time=(minutes:number|null)=>minutes===null?'Da configurare':`${Math.floor(minutes/60)} h ${minutes%60} min`
export function QuoteEconomicsPreview({quote,settings,nightly,marginTarget}:{quote:AcceptanceQuote;settings:PlannerSettings;nightly?:NightlyEconomicSnapshot; marginTarget?:ReturnType<typeof marginTargetRate>}) {
 const result=quoteEconomics(quote,settings,nightly,marginTarget)
 const color=result.objectiveHourlyDelta===null||result.objectiveHourlyDelta===0?undefined:result.objectiveHourlyDelta>0?'#79dfb4':'#ff8b8b'
 const verdict=result.objectiveHourlyDelta===null?'Confronto con l’obiettivo da completare':result.objectiveHourlyDelta<0?'SOTTO L’OBIETTIVO ORARIO':result.objectiveHourlyDelta===0?'IN LINEA CON L’OBIETTIVO ORARIO':'SOPRA L’OBIETTIVO ORARIO'
 return <section className="panel quote-hour-budget" aria-label="Convenienza del preventivo">
  <h3>Preventivo rispetto all’obiettivo orario</h3>
  <div className="quote-budget-grid">
   <div><span>Margine orario stimato dopo i costi diretti</span><strong>{result.marginHourly===null?'Da calcolare':money(result.marginHourly)+'/h'}</strong></div>
   <div><span>Margine orario obiettivo</span><strong>{result.target.hourlyRate===null?'Da configurare':money(result.target.hourlyRate)+'/h'}</strong></div>
   <div><span>Tempo tecnico da listino e lavorazioni manuali</span><strong>{time(result.minutes)}</strong></div>
   <div><span>Tempo massimo per rispettare l’obiettivo</span><strong>{time(result.objectiveMinutes)}</strong></div>
  </div>
  {result.timingError&&result.hourlyRevenue!==null&&<p>Ricavo orario provvisorio sui tempi inseriti: completa la riga indicata prima di confermare.</p>}
  <p>Tempo massimo = (ricavo senza IVA − materiali − ricambi e altri costi diretti) ÷ (margine orario obiettivo + costo orario stimato degli operatori). È espresso in ore e minuti e confrontato con il tempo tecnico previsto, senza modificare le fasi o aggiungere ore al calendario.</p>
  <p><strong style={{color}}>{verdict}</strong></p>
  <p>Confronto: (ricavo senza IVA − materiali − ricambi − manodopera − altri costi diretti) ÷ ore tecniche. L’obiettivo comprende già le spese generali: non vengono sottratte nuovamente. Obiettivo residuo: {money(result.target.goal)} su {result.target.hours.toLocaleString('it-IT')} ore produttive.</p>
  {result.objectiveDelta!==null&&<p>{result.objectiveDelta<0?'Tempo previsto oltre il limite dell’obiettivo: ':'Tempo ancora disponibile rispetto all’obiettivo: '}<strong>{time(Math.abs(result.objectiveDelta))}</strong>.</p>}
  {result.timingError&&<p>{result.timingError}</p>}
  {result.costError&&<p>{result.costError}</p>}
  {result.target.hourlyRate===null&&<p>Imposta l’obiettivo mensile e le ore produttive per confrontare le tariffe.</p>}
  <details><summary>Dettaglio dei costi e del margine stimato</summary>
   <p>Ricavo senza IVA: {money(result.revenue)}. Tempo tecnico: {result.minutes} min.</p>
   <p>Materiali stimati ({result.materialPercent}%): {money(result.materialsCost)}. Altri costi diretti: {money(result.directCosts)}.</p>
   <p>Manodopera stimata: {result.personnelAndStructureCost===null?'Da configurare':money(result.personnelAndStructureCost)}. Usa il costo orario dell’operatore scelto per ogni riga; senza assegnazione usa la media degli operatori attivi. La manodopera è sottratta una sola volta.</p>
   <p>Margine disponibile stimato per l’obiettivo: {result.margin===null?'Da calcolare':money(result.margin)}.</p>
   <p>Stima iniziale: il risultato effettivo dipenderà dai tempi e dai costi realmente sostenuti. Essere sotto l’obiettivo orario non significa necessariamente essere in perdita.</p>
  </details>
 </section>
}
