import { useMemo } from 'react'
import type { Customer, ErpData } from '../../types'
import { createInvoice, createRibaBatch, invoiceResidual, markRibaInsolvent, registerRibaAdvance, settleRibaBatch } from '../../services/finance'

const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const today = () => new Date().toISOString().slice(0, 10)

export function FinancePage({ data, onChange, customerById, setError, setNotice }: {
  data: ErpData
  onChange: (data: ErpData) => void
  customerById: (id: string) => Customer | undefined
  setError: (value: string) => void
  setNotice: (value: string) => void
}) {
  const toInvoice = data.vehicles.filter((vehicle) => vehicle.billingStatus === 'Da fatturare' && !vehicle.invoiceId)
  const openInvoices = data.invoices.filter((invoice) => invoice.status !== 'Incassata' && invoice.status !== 'Stornata')
  const totalCredits = openInvoices.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0)
  const totalRiba = data.ribaBatches.filter((batch) => !['Chiusa', 'Stornata'].includes(batch.status)).reduce((sum, batch) => sum + batch.total, 0)
  const totalAdvanced = data.ribaBatches.filter((batch) => batch.status === 'Anticipata').reduce((sum, batch) => sum + batch.advancedAmount, 0)
  const overdue = openInvoices.filter((invoice) => invoice.dueDate < today()).reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0)

  const groups = useMemo(() => {
    const map = new Map<string, typeof toInvoice>()
    for (const vehicle of toInvoice) map.set(vehicle.customerId, [...(map.get(vehicle.customerId) ?? []), vehicle])
    return [...map.entries()]
  }, [toInvoice])

  const run = (action: () => ErpData, message: string) => {
    try { onChange(action()); setError(''); setNotice(message) }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') }
  }

  const invoiceCustomer = (customerId: string, vehicleIds: string[]) => {
    const number = window.prompt('Numero fattura')?.trim()
    if (!number) return
    const issueDate = window.prompt('Data fattura (AAAA-MM-GG)', today())?.trim()
    if (!issueDate) return
    run(() => createInvoice(data, { customerId, vehicleIds, number, issueDate }), `Fattura ${number} creata correttamente.`)
  }

  const createBatch = (invoiceId: string) => {
    if (!data.bankAccounts.length) { setError('Configura prima almeno una banca nel database.'); return }
    const invoice = data.invoices.find((item) => item.id === invoiceId)
    if (!invoice) return
    const residual = invoiceResidual(invoice)
    const number = window.prompt('Numero distinta R.I.B.A.')?.trim()
    if (!number) return
    const amount = Number(window.prompt(`Importo da inserire. Residuo disponibile ${money(residual)}`, String(residual)))
    if (!Number.isFinite(amount)) return
    const bank = data.bankAccounts[0]
    const presentationDate = today()
    const dueDate = invoice.dueDate
    run(() => createRibaBatch(data, { number, bankAccountId: bank.id, presentationDate, dueDate, allocations: [{ invoiceId, amount }] }), `Distinta ${number} creata senza duplicazioni.`)
  }

  return <>
    <section className="stat-grid finance-stats">
      <div className="stat-card"><span>Crediti clienti</span><strong>{money(totalCredits)}</strong><small>{openInvoices.length} fatture aperte</small></div>
      <div className="stat-card"><span>R.I.B.A. in corso</span><strong>{money(totalRiba)}</strong><small>{data.ribaBatches.filter((item) => !['Chiusa', 'Stornata'].includes(item.status)).length} distinte</small></div>
      <div className="stat-card"><span>Anticipi bancari</span><strong>{money(totalAdvanced)}</strong><small>Non chiudono il credito</small></div>
      <div className="stat-card"><span>Scaduto</span><strong>{money(overdue)}</strong><small>Da controllare</small></div>
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">LAVORAZIONI CONSEGNATE</span><h3>Vetture da fatturare</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Vetture</th><th>Imponibile previsto</th><th>Azione</th></tr></thead><tbody>
        {groups.map(([customerId, vehicles]) => <tr key={customerId}><td><strong>{customerById(customerId)?.name ?? 'Cliente'}</strong></td><td>{vehicles.map((vehicle) => vehicle.plate).join(', ')}</td><td>{money(vehicles.reduce((sum, vehicle) => sum + vehicle.expectedRevenue, 0))}</td><td><button className="primary" onClick={() => invoiceCustomer(customerId, vehicles.map((vehicle) => vehicle.id))}>Crea fattura mensile</button></td></tr>)}
      </tbody></table></div>
      {!groups.length && <div className="empty"><div>◇</div><p>Nessuna vettura consegnata da fatturare.</p></div>}
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">SCADENZIARIO</span><h3>Fatture e residui</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>Fattura</th><th>Cliente</th><th>Scadenza</th><th>Totale</th><th>In R.I.B.A.</th><th>Residuo disponibile</th><th>Stato</th><th>Azione</th></tr></thead><tbody>
        {data.invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.number}</strong><small>{invoice.issueDate}</small></td><td>{customerById(invoice.customerId)?.name ?? '—'}</td><td>{invoice.dueDate}</td><td>{money(invoice.total)}</td><td>{money(invoice.ribaAllocatedAmount)}</td><td>{money(invoiceResidual(invoice))}</td><td><span className="tag">{invoice.status}</span></td><td>{invoiceResidual(invoice) > 0 && invoice.paymentMethod === 'R.I.B.A.' ? <button onClick={() => createBatch(invoice.id)}>Inserisci in R.I.B.A.</button> : '—'}</td></tr>)}
      </tbody></table></div>
      {!data.invoices.length && <div className="empty"><div>◇</div><p>Nessuna fattura emessa.</p></div>}
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">DISTINTE BANCARIE</span><h3>R.I.B.A. e anticipi</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>Distinta</th><th>Banca</th><th>Totale</th><th>Anticipato</th><th>Scadenza</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>
        {data.ribaBatches.map((batch) => <tr key={batch.id}><td><strong>{batch.number}</strong><small>{batch.presentationDate}</small></td><td>{data.bankAccounts.find((bank) => bank.id === batch.bankAccountId)?.name ?? '—'}</td><td>{money(batch.total)}</td><td>{money(batch.advancedAmount)}</td><td>{batch.dueDate}</td><td><span className="tag">{batch.status}</span></td><td><div className="row-actions">
          {batch.status === 'Presentata' && <button onClick={() => { const amount = Number(window.prompt('Importo anticipato', String(batch.total))); if (Number.isFinite(amount)) run(() => registerRibaAdvance(data, batch.id, amount, today()), 'Anticipo registrato. Il credito cliente resta aperto.') }}>Registra anticipo</button>}
          {!['Chiusa', 'Insoluta', 'Stornata'].includes(batch.status) && <button onClick={() => run(() => settleRibaBatch(data, batch.id, today()), 'Incasso definitivo registrato.')}>Incassata</button>}
          {!['Chiusa', 'Insoluta', 'Stornata'].includes(batch.status) && <button className="danger" onClick={() => run(() => markRibaInsolvent(data, batch.id, today()), 'Insoluto registrato e credito riaperto.')}>Insoluta</button>}
        </div></td></tr>)}
      </tbody></table></div>
      {!data.ribaBatches.length && <div className="empty"><div>◇</div><p>Nessuna distinta R.I.B.A. registrata.</p></div>}
    </section>
  </>
}
