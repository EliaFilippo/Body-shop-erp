import type { Customer, ErpData, Invoice, Vehicle } from '../../types'
import { invoiceResidual } from '../../services/finance'

const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })

type CustomerRow = {
  customer: Customer
  vehicles: Vehicle[]
  invoices: Invoice[]
  open: Invoice[]
  invoiced: number
  collected: number
  inRiba: number
  outstanding: number
  expired: number
  insolvents: number
  averageDelay: number
  rating: string
}

export function CustomerFinanceDetail({ row, data, onEditTerms }: {
  row: CustomerRow
  data: ErpData
  onEditTerms: () => void
}) {
  const invoiceByVehicle = new Map<string, Invoice>()
  row.invoices.forEach((invoice) => invoice.lines.forEach((line) => invoiceByVehicle.set(line.vehicleId, invoice)))

  return <section className="panel table-panel">
    <div className="panel-head">
      <div>
        <span className="eyebrow">SCHEDA FINANZIARIA CLIENTE</span>
        <h3>{row.customer.name}</h3>
        <p>{row.customer.usualPaymentMethod ?? 'Bonifico'} · {row.customer.endOfMonth ? 'Fine mese + ' : ''}{row.customer.paymentDays ?? data.financeSettings.defaultPaymentDays} giorni</p>
      </div>
      <div className="row-actions"><span className="tag">Rating {row.rating}</span><button onClick={onEditTerms}>Modifica condizioni</button></div>
    </div>

    <div className="stat-grid">
      <div className="stat-card"><span>Vetture lavorate</span><strong>{row.vehicles.length}</strong><small>Storico complessivo</small></div>
      <div className="stat-card"><span>Fatturato</span><strong>{money(row.invoiced)}</strong><small>Totale fatture</small></div>
      <div className="stat-card"><span>Incassato</span><strong>{money(row.collected)}</strong><small>Incassi definitivi</small></div>
      <div className="stat-card"><span>Credito aperto</span><strong>{money(row.outstanding)}</strong><small>{row.open.length} fatture aperte</small></div>
      <div className="stat-card"><span>Scaduto</span><strong>{money(row.expired)}</strong><small>Da sollecitare</small></div>
      <div className="stat-card"><span>In R.I.B.A.</span><strong>{money(row.inRiba)}</strong><small>Già presentato</small></div>
      <div className="stat-card"><span>Ritardo medio</span><strong>{row.averageDelay} gg</strong><small>Pagamenti chiusi</small></div>
      <div className="stat-card"><span>Insoluti</span><strong>{row.insolvents}</strong><small>Eventi registrati</small></div>
    </div>

    <div className="panel-head"><div><span className="eyebrow">VETTURE E PAGAMENTI</span><h3>Situazione per singola vettura</h3></div></div>
    <div className="table-wrap"><table>
      <thead><tr><th>Targa</th><th>Vettura</th><th>Stato lavorazione</th><th>Fattura</th><th>Scadenza</th><th>Importo</th><th>R.I.B.A.</th><th>Residuo</th><th>Stato pagamento</th></tr></thead>
      <tbody>{row.vehicles.map((vehicle) => {
        const invoice = invoiceByVehicle.get(vehicle.id)
        const line = invoice?.lines.find((item) => item.vehicleId === vehicle.id)
        return <tr key={vehicle.id}>
          <td><strong>{vehicle.plate}</strong><small>{vehicle.createdAt.slice(0, 10)}</small></td>
          <td>{vehicle.make} {vehicle.model}<small>{vehicle.color || 'Colore non indicato'}</small></td>
          <td><span className="tag">{vehicle.status}</span></td>
          <td>{invoice ? <><strong>{invoice.number}</strong><small>{invoice.issueDate}</small></> : 'Non fatturata'}</td>
          <td>{invoice?.dueDate ?? '—'}</td>
          <td>{line ? money(line.total) : money(vehicle.expectedRevenue)}</td>
          <td>{invoice ? money(invoice.ribaAllocatedAmount) : '—'}</td>
          <td>{invoice ? money(invoiceResidual(invoice)) : '—'}</td>
          <td><span className="tag">{invoice?.status ?? vehicle.billingStatus ?? 'Non fatturabile'}</span></td>
        </tr>
      })}</tbody>
    </table></div>
    {!row.vehicles.length && <div className="empty"><div>◇</div><p>Nessuna vettura collegata a questo cliente.</p></div>}

    <div className="panel-head"><div><span className="eyebrow">FATTURE</span><h3>Scadenze e residui del cliente</h3></div></div>
    <div className="table-wrap"><table>
      <thead><tr><th>Fattura</th><th>Vetture</th><th>Scadenza</th><th>Totale</th><th>Incassato</th><th>In R.I.B.A.</th><th>Residuo</th><th>Stato</th></tr></thead>
      <tbody>{row.invoices.map((invoice) => <tr key={invoice.id}>
        <td><strong>{invoice.number}</strong><small>{invoice.issueDate}</small></td>
        <td>{invoice.lines.map((line) => data.vehicles.find((vehicle) => vehicle.id === line.vehicleId)?.plate ?? line.description).join(', ')}</td>
        <td>{invoice.dueDate}</td><td>{money(invoice.total)}</td><td>{money(invoice.collectedAmount)}</td><td>{money(invoice.ribaAllocatedAmount)}</td><td>{money(invoiceResidual(invoice))}</td><td><span className="tag">{invoice.status}</span></td>
      </tr>)}</tbody>
    </table></div>
    {!row.invoices.length && <div className="empty"><div>◇</div><p>Nessuna fattura collegata a questo cliente.</p></div>}
  </section>
}
