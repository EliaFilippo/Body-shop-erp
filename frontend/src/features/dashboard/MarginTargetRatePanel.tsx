import type { marginTargetRate } from '../../services/marginTargetRate'

const money = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const number = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 })

export function MarginTargetRatePanel({ target }: { target: NonNullable<ReturnType<typeof marginTargetRate>> }) {
  return <section className="panel" aria-label="Tariffa oraria per l’obiettivo di margine">
    <div className="panel-head"><h3>Tariffa oraria per l’obiettivo di margine</h3></div>
    <div className="planner-detail-summary-grid economic-grid">
      <div><span>Fatturato da ottenere per ora</span><strong>{target.hourlyRate === null ? 'Da calcolare' : money.format(target.hourlyRate) + '/h'}</strong></div>
      <div><span>Margine ancora da raggiungere</span><strong>{money.format(target.remainingMargin)}</strong></div>
      <div><span>Ore produttive residue stimate</span><strong>{number.format(target.hours)} h</strong></div>
    </div>
    <p>La stima somma il costo interno, il costo medio dei collaboratori esterni previsto dai turni e il margine necessario per ora. Tiene conto dei materiali stimati al {number.format(target.materialsPercent)}% del ricavo.</p>
    {target.partial && <small>Il margine maturato è parziale perché alcune fasi hanno dati di costo da completare.</small>}
  </section>
}
