import type { AcceptanceQuote, PlannerSettings } from '../../types'
import { quoteEconomics } from '../../services/quoteEconomics'
const money=(value:number)=>value.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
const time=(minutes:number|null)=>minutes===null?'Da configurare':`${Math.floor(minutes/60)} h ${minutes%60} min`
const labels = {
 unknown:'Margine da verificare',loss:'SOTTOCOSTO · perdita stimata',
 'break-even':'A PAREGGIO · nessun margine stimato','below-target':'IN GUADAGNO · sotto l’obiettivo orario',
 'on-target':'IN GUADAGNO · obiettivo orario raggiunto','no-target':'IN GUADAGNO · obiettivo da configurare',
}
export function QuoteEconomicsPreview({quote,settings}:{quote:AcceptanceQuote;settings:PlannerSettings}) {
 const result=quoteEconomics(quote,settings)
 const color=result.status==='loss'?'#ff8b8b':result.status==='on-target'?'#79dfb4':'#f6c76f'
 return <section className="panel quote-hour-budget" aria-label="Convenienza del preventivo">
  <h3>Sto guadagnando su questo lavoro?</h3>
  <div className="quote-budget-grid">
   <div><span>Ricavo orario del preventivo</span><strong>{result.hourlyRevenue===null?'Da calcolare':money(result.hourlyRevenue)+'/h'}</strong></div>
   <div><span>Tariffa oraria obiettivo</span><strong>{result.target.hourlyRate===null?'Da configurare':money(result.target.hourlyRate)+'/h'}</strong></div>
   <div><span>Tempo tecnico da listino e lavorazioni manuali</span><strong>{time(result.minutes)}</strong></div>
   <div><span>Ore a disposizione a pareggio sui costi configurati</span><strong>{time(result.maxMinutes)}</strong></div>
   <div><span>Ore disponibili con margine {settings.internalCostSettings?.minimumMarginPercent??0}%</span><strong>{time(result.targetMinutes)}</strong></div>
  </div>
  {result.timingError&&result.hourlyRevenue!==null&&<p>Ricavo orario provvisorio sui tempi inseriti: completa la riga indicata prima di confermare.</p>}
  <p>Le ore a disposizione sono il limite economico dopo materiali e costi diretti, non ore aggiunte alle fasi né disponibilità del calendario.</p>
  <p><strong style={{color}}>{labels[result.status]}</strong></p>
  <p>Prezzo senza IVA diviso per le ore tecniche del lavoro, compreso l’eventuale lavaggio. Obiettivo del mese {quote.monthKey}: {money(result.target.goal)} su {result.target.hours.toLocaleString('it-IT')} ore produttive.</p>
  <div className="quote-budget-grid">
   <div><span>Margine stimato sui costi configurati</span><strong style={{color}}>{result.margin===null?'Da calcolare':money(result.margin)}</strong></div>
   <div><span>Prezzo minimo a pareggio, IVA esclusa</span><strong>{result.breakEvenRevenue===null?'Da calcolare':money(result.breakEvenRevenue)}</strong></div>
  </div>
  {result.timingError&&<p>{result.timingError}</p>}
  {result.costError&&<p>{result.costError}</p>}
  {result.target.hourlyRate===null&&<p>Imposta l’obiettivo mensile e le ore produttive per confrontare le tariffe.</p>}
  <details><summary>Come viene calcolato il margine</summary>
   <p>Ricavo senza IVA: {money(result.revenue)}. Tempo tecnico: {result.minutes} min.</p>
   <p>Materiali stimati ({result.materialPercent}%): {money(result.materialsCost)}. Altri costi diretti: {money(result.directCosts)}.</p>
   <p>Costi aziendali configurati: {result.personnelAndStructureCost===null?'Da configurare':money(result.personnelAndStructureCost)}{result.hourlyCost===null?'': ' ('+money(result.hourlyCost)+'/h)'}. Costo medio ricavato dal totale delle spese mensili configurate e dalle ore produttive. Verifica che il totale comprenda anche il personale.</p>
   <p>Stima iniziale: il risultato effettivo dipenderà dai tempi e dai costi realmente sostenuti. Essere sotto l’obiettivo orario non significa necessariamente essere in perdita.</p>
  </details>
 </section>
}
