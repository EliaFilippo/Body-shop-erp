import { useEffect, useRef, useState } from 'react'
import type { Customer, ErpData, Invoice, Vehicle } from '../../types'
import { invoiceResidual } from '../../services/finance'

const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const today = () => new Date().toISOString().slice(0, 10)

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

function paymentStatus(invoice?: Invoice) {
  if (!invoice) return { label: 'Da fatturare', symbol: '○' }
  if (invoice.status === 'Incassata') return { label: 'Incassata', symbol: '●' }
  if (invoice.status === 'Insoluta') return { label: 'Insoluta', symbol: '●' }
  if (invoice.dueDate < today() && invoiceResidual(invoice) > 0) return { label: 'Scaduta', symbol: '●' }
  if (invoice.ribaAllocatedAmount > 0) return { label: 'In R.I.B.A.', symbol: '●' }
  return { label: invoice.status, symbol: '●' }
}

function customerRisk(row: CustomerRow) {
  if (row.insolvents > 0 || row.expired > 20000 || row.rating === 'D') {
    return {
      label: 'RISCHIO ALTO',
      color: '#ff6b6b',
      background: 'rgba(255, 107, 107, 0.10)',
      message: 'Prima di accettare nuove lavorazioni, controlla insoluti e credito scaduto.',
    }
  }

  if (row.expired > 0 || row.averageDelay > 15 || row.rating === 'B' || row.rating === 'C') {
    return {
      label: 'DA MONITORARE',
      color: '#e6b85c',
      background: 'rgba(230, 184, 92, 0.10)',
      message: 'Il cliente presenta ritardi o importi scaduti: monitora l’esposizione.',
    }
  }

  return {
    label: 'REGOLARE',
    color: '#67d9a3',
    background: 'rgba(103, 217, 163, 0.10)',
    message: 'Al momento non risultano criticità nei pagamenti registrati.',
  }
}

export function CustomerFinanceDetail({ row, data, onEditTerms }: {
  row: CustomerRow
  data: ErpData
  onEditTerms: () => void
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const [highlighted, setHighlighted] = useState(false)
  const invoiceByVehicle = new Map<string, Invoice>()
  row.invoices.forEach((invoice) => invoice.lines.forEach((line) => invoiceByVehicle.set(line.vehicleId, invoice)))

  const nextDueInvoice = row.open
    .filter((invoice) => invoiceResidual(invoice) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  const notInvoiced = row.vehicles.filter((vehicle) => !invoiceByVehicle.has(vehicle.id)).length
  const presentableRiba = row.invoices
    .filter((invoice) => invoice.paymentMethod === 'R.I.B.A.' && invoice.status !== 'Incassata' && invoice.status !== 'Stornata')
    .reduce((sum, invoice) => sum + invoiceResidual(invoice), 0)
  const notExpired = Math.max(0, row.outstanding - row.expired)
  const risk = customerRisk(row)

  const alerts = [
    row.expired > 0 ? `${money(row.expired)} di fatture scadute da sollecitare.` : '',
    notInvoiced > 0 ? `${notInvoiced} vetture risultano ancora da fatturare.` : '',
    presentableRiba > 0 ? `${money(presentableRiba)} ancora disponibili per nuove R.I.B.A.` : '',
    row.insolvents > 0 ? `${row.insolvents} insoluti registrati sul cliente.` : '',
  ].filter(Boolean)

  useEffect(() => {
    const handleDetailClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const button = target.closest('button')
      if (!button || button.textContent?.trim() !== 'Dettaglio') return

      window.setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setHighlighted(true)
        window.setTimeout(() => setHighlighted(false), 1600)
      }, 50)
    }

    document.addEventListener('click', handleDetailClick)
    return () => document.removeEventListener('click', handleDetailClick)
  }, [])

  return <section
    ref={sectionRef}
    id="customer-finance-detail"
    className="panel table-panel"
    style={{
      scrollMarginTop: '18px',
      outline: highlighted ? '2px solid rgba(214, 178, 92, 0.9)' : '2px solid transparent',
      boxShadow: highlighted ? '0 0 0 6px rgba(214, 178, 92, 0.12)' : undefined,
      transition: 'outline-color 220ms ease, box-shadow 220ms ease',
    }}
  >
    <div className="panel-head">
      <div>
        <span className="eyebrow">SCHEDA FINANZIARIA CLIENTE</span>
        <h3>{row.customer.name}</h3>
        <p>{row.customer.usualPaymentMethod ?? 'Bonifico'} · {row.customer.endOfMonth ? 'Fine mese + ' : ''}{row.customer.paymentDays ?? data.financeSettings.defaultPaymentDays} giorni</p>
      </div>
      <div className="row-actions"><span className="tag">Rating {row.rating}</span><button onClick={onEditTerms}>Modifica condizioni</button></div>
    </div>

    <div style={{ border: `1px solid ${risk.color}`, background: risk.background, borderRadius: '14px', padding: '14px 16px', marginBottom: '18px', display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
      <div>
        <span className="eyebrow">AFFIDABILITÀ PAGAMENTI</span>
        <h3 style={{ margin: '4px 0', color: risk.color }}>{risk.label}</h3>
        <p style={{ margin: 0 }}>{risk.message}</p>
      </div>
      <div className="row-actions">
        <span className="tag">Scaduto {money(row.expired)}</span>
        <span className="tag">Ritardo {row.averageDelay} gg</span>
        <span className="tag">Insoluti {row.insolvents}</span>
      </div>
    </div>

    <div className="stat-grid">
      <div className="stat-card"><span>Credito aperto</span><strong>{money(row.outstanding)}</strong><small>{row.open.length} fatture aperte</small></div>
      <div className="stat-card"><span>Scaduto</span><strong>{money(row.expired)}</strong><small>Da sollecitare</small></div>
      <div className="stat-card"><span>Non ancora scaduto</span><strong>{money(notExpired)}</strong><small>Credito futuro</small></div>
      <div className="stat-card"><span>In R.I.B.A.</span><strong>{money(row.inRiba)}</strong><small>Già presentato</small></div>
      <div className="stat-card"><span>Prossimo incasso</span><strong>{nextDueInvoice ? money(invoiceResidual(nextDueInvoice)) : money(0)}</strong><small>{nextDueInvoice?.dueDate ?? 'Nessuna scadenza'}</small></div>
      <div className="stat-card"><span>Vetture lavorate</span><strong>{row.vehicles.length}</strong><small>Storico complessivo</small></div>
      <div className="stat-card"><span>Fatturato</span><strong>{money(row.invoiced)}</strong><small>Totale fatture</small></div>
      <div className="stat-card"><span>Incassato</span><strong>{money(row.collected)}</strong><small>Incassi definitivi</small></div>
      <div className="stat-card"><span>Ritardo medio</span><strong>{row.averageDelay} gg</strong><small>{row.insolvents} insoluti registrati</small></div>
    </div>

    <div className="panel-head"><div><span className="eyebrow">CONTROLLO AUTOMATICO</span><h3>Avvisi sul cliente</h3></div></div>
    <div className="activity">
      {alerts.map((alert) => <div key={alert}><b>!</b><span><strong>Attenzione</strong><small>{alert}</small></span></div>)}
      {!alerts.length && <div className="empty"><div>✓</div><p>Nessuna criticità rilevata per questo cliente.</p></div>}
    </div>

    <div className="panel-head"><div><span className="eyebrow">VETTURE E PAGAMENTI</span><h3>Situazione per singola vettura</h3></div></div>
    <div className="table-wrap"><table>
      <thead><tr><th>Targa</th><th>Vettura</th><th>Stato lavorazione</th><th>Fattura</th><th>Scadenza</th><th>Importo</th><th>R.I.B.A.</th><th>Residuo</th><th>Stato pagamento</th></tr></thead>
      <tbody>{row.vehicles.map((vehicle) => {
        const invoice = invoiceByVehicle.get(vehicle.id)
        const line = invoice?.lines.find((item) => item.vehicleId === vehicle.id)
        const status = paymentStatus(invoice)
        return <tr key={vehicle.id}>
          <td><strong>{vehicle.plate}</strong><small>{vehicle.createdAt.slice(0, 10)}</small></td>
          <td>{vehicle.make} {vehicle.model}<small>{vehicle.color || 'Colore non indicato'}</small></td>
          <td><span className="tag">{vehicle.status}</span></td>
          <td>{invoice ? <><strong>{invoice.number}</strong><small>{invoice.issueDate}</small></> : 'Non fatturata'}</td>
          <td>{invoice?.dueDate ?? '—'}</td>
          <td>{line ? money(line.total) : money(vehicle.expectedRevenue)}</td>
          <td>{invoice ? money(invoice.ribaAllocatedAmount) : '—'}</td>
          <td>{invoice ? money(invoiceResidual(invoice)) : '—'}</td>
          <td><span className="tag">{status.symbol} {status.label}</span></td>
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
        <td>{invoice.dueDate}</td><td>{money(invoice.total)}</td><td>{money(invoice.collectedAmount)}</td><td>{money(invoice.ribaAllocatedAmount)}</td><td>{money(invoiceResidual(invoice))}</td><td><span className="tag">{paymentStatus(invoice).label}</span></td>
      </tr>)}</tbody>
    </table></div>
    {!row.invoices.length && <div className="empty"><div>◇</div><p>Nessuna fattura collegata a questo cliente.</p></div>}
  </section>
}
