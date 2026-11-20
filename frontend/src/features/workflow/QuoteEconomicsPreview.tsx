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
   <div><span>Ricavo orario del preventivo</span><strong>{result.hourlyRevenue===null?'Da calcolare':money(result.hourlyRevenue)+'/h'}</strong></div>
   <div><span>Tariffa oraria obiettivo</span><strong>{result.target.hourlyRate===null?'Da configurare':money(result.target.hourlyRate)+'/h'}</strong></div>
   <div><span>Tempo tecnico da listino e lavorazioni manuali</span><strong>{time(result.minutes)}</strong></div>
   <div><span>Tempo massimo per rispettare l’obiettivo</span><strong>{time(result.objectiveMinutes)}</strong></div>
  </div>
  {result.timingError&&result.hourlyRevenue!==null&&<p>Ricavo orario provvisorio sui tempi inseriti: completa la riga indicata prima di confermare.</p>}
  <p>Tempo massimo = importo del preventivo senza IVA ÷ tariffa oraria obiettivo. È espresso in ore e minuti e confrontato con il tempo tecnico previsto, senza modificare le fasi o aggiungere ore al calendario.</p>
  <p><strong style={{color}}>{verdict}</strong></p>
  <p>Prezzo senza IVA diviso per le ore tecniche del lavoro, compreso l’eventuale lavaggio. {marginTarget
    ? `La tariffa obiettivo tiene conto del margine residuo di ${money(marginTarget.remainingMargin)} e dei costi stimati.`
    : `${result.target.isResidual ? 'Fatturato da raggiungere a fine mese' : 'Obiettivo del mese'} ${quote.monthKey} · ${money(result.target.goal)} su ${result.target.hours.toLocaleString('it-IT')} ore produttive${result.target.isResidual ? ' rimanenti (ultimo ricalcolo notturno)' : ''}.`}</p>
  {result.objectiveDelta!==null&&<p>{result.objectiveDelta<0?'Tempo previsto oltre il limite dell’obiettivo: ':'Tempo ancora disponibile rispetto all’obiettivo: '}<strong>{time(Math.abs(result.objectiveDelta))}</strong>.</p>}
  {result.timingError&&<p>{result.timingError}</p>}
  {result.costError&&<p>{result.costError}</p>}
  {result.target.hourlyRate===null&&<p>Imposta l’obiettivo mensile e le ore produttive per confrontare le tariffe.</p>}
  <details><summary>Dettaglio dei costi e del margine stimato</summary>
   <p>Ricavo senza IVA: {money(result.revenue)}. Tempo tecnico: {result.minutes} min.</p>
   <p>Materiali stimati ({result.materialPercent}%): {money(result.materialsCost)}. Altri costi diretti: {money(result.directCosts)}.</p>
   <p>Costi aziendali configurati: {result.personnelAndStructureCost===null?'Da configurare':money(result.personnelAndStructureCost)}{result.hourlyCost===null?'': ' ('+money(result.hourlyCost)+'/h)'}. Costo medio ricavato dal totale delle spese mensili configurate e dalle ore produttive. Verifica che il totale comprenda anche il personale.</p>
   <p>Margine stimato sui costi configurati: {result.margin===null?'Da calcolare':money(result.margin)}.</p>
   <p>Stima iniziale: il risultato effettivo dipenderà dai tempi e dai costi realmente sostenuti. Essere sotto l’obiettivo orario non significa necessariamente essere in perdita.</p>
  </details>
 </section>
}
