import type { AcceptanceQuote, PlannerSettings } from '../../types'
import { calculateQuoteHourBudget, quoteOperatorRate } from '../../services/quoteHourBudget'
import { recalculateDamageLine } from '../../services/damageQuote'

const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const time = (minutes: number | null) => minutes === null ? 'Da configurare' : `${Math.floor(minutes / 60)} h ${minutes % 60} min`

export function QuoteHourBudget({ quote, settings, activePanelId, onChange }: {
  quote: AcceptanceQuote; settings: PlannerSettings; activePanelId: string; onChange: (quote: AcceptanceQuote) => void
}) {
  const budget = calculateQuoteHourBudget(quote, settings)
  const rows = budget.rows.filter((row) => row.panelId === activePanelId)
  const lines = (quote.damageLines ?? []).filter((line) => line.panelId === activePanelId)
  const panelMinutes = rows.length && rows.every((row) => row.maxMinutes !== null) ? rows.reduce((sum, row) => sum + row.maxMinutes!, 0) : null
  const choices = settings.operators.filter((operator) => operator.active)
  return <section className="quote-hour-budget" aria-label="Ore a disposizione">
    <h3>Ore a disposizione su questo preventivo</h3>
    <p>Importo senza IVA meno materiali e costi diretti, diviso per costo struttura e costo dell’operatore. Il consumo è un costo interno: non viene aggiunto al prezzo del cliente.</p>
    <label>Operatore di riferimento del preventivo<select value={quote.budgetOperatorId ?? ''} onChange={(event) => onChange({ ...quote, budgetOperatorId: event.target.value })}><option value="">Seleziona operatore</option>{choices.map((operator) => <option key={operator.id} value={operator.id}>{operator.name} · {money(quoteOperatorRate(settings, operator.id).rate)}/h</option>)}</select></label>
    <div className="quote-budget-grid">
      <div><span>Importo senza IVA</span><strong>{money(budget.revenue)}</strong></div>
      <div><span>Consumo materiali interno ({budget.materialPercent}%)</span><strong>− {money(budget.materialsCost)}</strong></div>
      <div><span>Altri costi diretti</span><strong>− {money(budget.directCosts)}</strong></div>
      <div><span>Disponibile per struttura e operatori</span><strong>{money(budget.available)}</strong></div>
      <div><span>Costo struttura, personale separato</span><strong>{money(budget.structure.rate)}/h</strong></div>
      <div><span>Ore massime a pareggio</span><strong>{time(budget.maxMinutes)}</strong></div>
      <div><span>Ore con margine {budget.marginPercent}%</span><strong>{time(budget.targetMinutes)}</strong></div>
      <div><span>Ore attualmente previste</span><strong>{time(Math.round(budget.plannedMinutes))}</strong></div>
    </div>
    {budget.error && <p role="alert" className="damage-incomplete">{budget.error}</p>}
    {!budget.error && budget.maxMinutes !== null && budget.plannedMinutes > budget.maxMinutes && <p role="alert" className="damage-incomplete">Le ore previste superano il budget a pareggio. Riduci il tempo o rivedi il prezzo.</p>}
    {!budget.error && budget.targetMinutes !== null && budget.maxMinutes !== null && budget.plannedMinutes > budget.targetMinutes && budget.plannedMinutes <= budget.maxMinutes && <p className="damage-incomplete">Le ore previste lasciano un margine inferiore all’obiettivo impostato.</p>}
    {!budget.error && budget.fullyTimed && <p>Margine previsto dopo tutti i costi: <strong>{money(budget.margin)}</strong>.</p>}
    {quote.lines.some((line) => line.kind === 'labor' && line.quantity > 0) && <p className="damage-incomplete">Sono presenti ore aggiuntive oltre ai pannelli. Se erano un valore iniziale e non rappresentano altri lavori, azzerale negli importi aggiuntivi.</p>}
    <small>Il limite economico non è una stima tecnica del danno né la disponibilità del calendario. Le ore con margine mantengono la percentuale impostata in Costi e tariffe interne.</small>
    {lines.length > 0 && <div className="quote-budget-panel"><h4>{rows[0]?.panelName}</h4>
      <label>Operatore per questo pannello<select value={lines[0]?.budgetOperatorId ?? ''} onChange={(event) => onChange({ ...quote, damageLines: (quote.damageLines ?? []).map((line) => line.panelId === activePanelId ? { ...line, budgetOperatorId: event.target.value } : line) })}><option value="">Usa operatore di riferimento</option>{choices.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label>
      <p>Ore massime di questo pannello: <strong>{time(panelMinutes)}</strong>{budget.directCosts > 0 ? ' (prima degli altri costi diretti)' : ''}.</p>
      {rows.map((row) => <small key={row.lineId}>{row.operatorName || 'Operatore da scegliere'}: struttura {money(row.structureRate)}/h + operatore {money(row.operatorRate)}/h = {money(row.combinedRate)}/h.</small>)}
      <button type="button" className="secondary" disabled={Boolean(budget.error) || budget.directCosts > 0 || lines.some((line) => line.damageSeverity === 'grave') || rows.some((row) => !row.targetMinutes)} onClick={() => onChange({ ...quote, damageLines: (quote.damageLines ?? []).map((line) => { const row = rows.find((item) => item.lineId === line.id); return row && row.targetMinutes !== null ? recalculateDamageLine({ ...line, estimatedMinutes: row.targetMinutes }, settings) : line }) })}>Usa le ore con margine su questo pannello</button>
    </div>}
    <details className="damage-extra-details"><summary>Confronta le ore con gli altri operatori</summary><div className="elias-price-table"><table><thead><tr><th>Operatore</th><th>Costo operatore/h</th><th>Costo totale/h</th><th>Ore a pareggio</th></tr></thead><tbody>{budget.comparisons.map((operator) => <tr key={operator.id}><td>{operator.name}</td><td>{money(operator.operatorRate)}</td><td>{money(operator.combinedRate)}</td><td>{time(operator.maxMinutes)}</td></tr>)}</tbody></table></div></details>
  </section>
}
