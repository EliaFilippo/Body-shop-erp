import { useMemo, useState } from 'react'
import type { Customer, ErpData, PaymentMethod } from '../../types'
import { createInvoice, createRibaBatch, invoiceResidual, markRibaInsolvent, registerRibaAdvance, settleRibaBatch } from '../../services/finance'

const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const today = () => new Date().toISOString().slice(0, 10)
const dayDiff = (from: string, to: string) => Math.ceil((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400000)

export function FinancePage({ data, onChange, customerById, setError, setNotice }: {
  data: ErpData
  onChange: (data: ErpData) => void
  customerById: (id: string) => Customer | undefined
  setError: (value: string) => void
  setNotice: (value: string) => void
}) {
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
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

  const customerRows = useMemo(() => data.customers.map((customer) => {
    const vehicles = data.vehicles.filter((vehicle) => vehicle.customerId === customer.id)
    const invoices = data.invoices.filter((invoice) => invoice.customerId === customer.id && invoice.status !== 'Stornata')
    const open = invoices.filter((invoice) => invoice.status !== 'Incassata')
    const invoiced = invoices.reduce((sum, invoice) => sum + invoice.total, 0)
    const collected = invoices.reduce((sum, invoice) => sum + invoice.collectedAmount, 0)
    const inRiba = invoices.reduce((sum, invoice) => sum + invoice.ribaAllocatedAmount, 0)
    const outstanding = Math.max(0, invoiced - collected)
    const expired = open.filter((invoice) => invoice.dueDate < today()).reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0)
    const insolvents = invoices.filter((invoice) => invoice.status === 'Insoluta').length
    const lateDays = invoices.filter((invoice) => invoice.status === 'Incassata' && invoice.dueDate < invoice.updatedAt.slice(0, 10)).map((invoice) => dayDiff(invoice.dueDate, invoice.updatedAt.slice(0, 10)))
    const averageDelay = lateDays.length ? Math.round(lateDays.reduce((sum, value) => sum + value, 0) / lateDays.length) : 0
    const rating = insolvents > 0 || expired > 20000 ? 'D' : expired > 5000 || averageDelay > 30 ? 'C' : expired > 0 || averageDelay > 10 ? 'B' : 'A'
    return { customer, vehicles, invoices, open, invoiced, collected, inRiba, outstanding, expired, insolvents, averageDelay, rating }
  }).sort((a, b) => b.outstanding - a.outstanding), [data.customers, data.vehicles, data.invoices])

  const selected = customerRows.find((row) => row.customer.id === selectedCustomerId) ?? customerRows[0]
  const projected = (days: number) => openInvoices.filter((invoice) => dayDiff(today(), invoice.dueDate) >= 0 && dayDiff(today(), invoice.dueDate) <= days).reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0)
  const bankExposure = data.ribaBatches.filter((batch) => batch.status === 'Anticipata').reduce((sum, batch) => sum + batch.advancedAmount, 0)
  const bankLimit = data.bankAccounts.reduce((sum, bank) => sum + bank.creditLimit, 0)
  const availableLimit = Math.max(0, bankLimit - bankExposure)

  const run = (action: () => ErpData, message: string) => {
    try { onChange(action()); setError(''); setNotice(message) }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') }
  }

  const updateCustomerTerms = (customerId: string) => {
    const customer = customerById(customerId)
    if (!customer) return
    const method = window.prompt('Metodo di pagamento: Bonifico, R.I.B.A., Contanti, POS o Personalizzato', customer.usualPaymentMethod ?? 'Bonifico')?.trim() as PaymentMethod | undefined
    if (!method) return
    const days = Number(window.prompt('Giorni di pagamento', String(customer.paymentDays ?? data.financeSettings.defaultPaymentDays)))
    if (!Number.isFinite(days) || days < 0) { setError('Giorni di pagamento non validi.'); return }
    const endOfMonth = window.confirm('La scadenza deve essere calcolata a fine mese?')
    onChange({ ...data, customers: data.customers.map((item) => item.id === customerId ? { ...item, usualPaymentMethod: method, paymentDays: days, endOfMonth } : item) })
    setNotice(`Condizioni di pagamento aggiornate per ${customer.name}.`)
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
    run(() => createRibaBatch(data, { number, bankAccountId: bank.id, presentationDate: today(), dueDate: invoice.dueDate, allocations: [{ invoiceId, amount }] }), `Distinta ${number} creata senza duplicazioni.`)
  }

  const alerts = [
    overdue > 0 ? `Hai ${money(overdue)} di fatture scadute da controllare.` : '',
    availableLimit < data.financeSettings.minimumProjectedBalance ? `Plafond bancario disponibile basso: ${money(availableLimit)}.` : '',
    customerRows.some((row) => row.rating === 'D') ? `${customerRows.filter((row) => row.rating === 'D').length} clienti risultano ad alto rischio finanziario.` : '',
    projected(30) < data.financeSettings.minimumProjectedBalance ? `Gli incassi previsti nei prossimi 30 giorni sono sotto la soglia impostata.` : '',
  ].filter(Boolean)

  return <>
    <section className="stat-grid finance-stats">
      <div className="stat-card"><span>Crediti clienti</span><strong>{money(totalCredits)}</strong><small>{openInvoices.length} fatture aperte</small></div>
      <div className="stat-card"><span>R.I.B.A. in corso</span><strong>{money(totalRiba)}</strong><small>{data.ribaBatches.filter((item) => !['Chiusa', 'Stornata'].includes(item.status)).length} distinte</small></div>
      <div className="stat-card"><span>Anticipi bancari</span><strong>{money(totalAdvanced)}</strong><small>Non chiudono il credito</small></div>
      <div className="stat-card"><span>Scaduto</span><strong>{money(overdue)}</strong><small>Da controllare</small></div>
    </section>

    <section className="panel"><div className="panel-head"><div><span className="eyebrow">ASSISTENTE FINANZIARIO</span><h3>Avvisi e liquidità prevista</h3></div></div>
      <div className="stat-grid"><div className="stat-card"><span>Entro 30 giorni</span><strong>{money(projected(30))}</strong><small>Incassi previsti</small></div><div className="stat-card"><span>Entro 60 giorni</span><strong>{money(projected(60))}</strong><small>Incassi previsti</small></div><div className="stat-card"><span>Entro 90 giorni</span><strong>{money(projected(90))}</strong><small>Incassi previsti</small></div><div className="stat-card"><span>Plafond disponibile</span><strong>{money(availableLimit)}</strong><small>Esposizione {money(bankExposure)}</small></div></div>
      <div className="activity">{alerts.map((alert) => <div key={alert}><b>!</b><span><strong>Attenzione</strong><small>{alert}</small></span></div>)}{!alerts.length && <div className="empty"><div>✓</div><p>Nessuna criticità finanziaria rilevata.</p></div>}</div>
    </section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">SITUAZIONE CONCESSIONARI E CLIENTI</span><h3>Esposizione per cliente</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Vetture</th><th>Fatturato</th><th>Incassato</th><th>Credito aperto</th><th>Scaduto</th><th>In R.I.B.A.</th><th>Ritardo medio</th><th>Rating</th><th>Azioni</th></tr></thead><tbody>{customerRows.map((row) => <tr key={row.customer.id}><td><strong>{row.customer.name}</strong><small>{row.customer.usualPaymentMethod ?? 'Bonifico'} · {row.customer.endOfMonth ? 'FM +' : ''} {row.customer.paymentDays ?? data.financeSettings.defaultPaymentDays} gg</small></td><td>{row.vehicles.length}</td><td>{money(row.invoiced)}</td><td>{money(row.collected)}</td><td>{money(row.outstanding)}</td><td>{money(row.expired)}</td><td>{money(row.inRiba)}</td><td>{row.averageDelay} gg</td><td><span className="tag">{row.rating}</span></td><td><div className="row-actions"><button onClick={() => setSelectedCustomerId(row.customer.id)}>Dettaglio</button><button onClick={() => updateCustomerTerms(row.customer.id)}>Condizioni</button></div></td></tr>)}</tbody></table></div>
    </section>

    {selected && <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">DETTAGLIO CLIENTE</span><h3>{selected.customer.name}</h3></div><span className="tag">Rating {selected.rating}</span></div>
      <div className="stat-grid"><div className="stat-card"><span>Vetture lavorate</span><strong>{selected.vehicles.length}</strong></div><div className="stat-card"><span>Fatture aperte</span><strong>{selected.open.length}</strong></div><div className="stat-card"><span>Credito residuo</span><strong>{money(selected.outstanding)}</strong></div><div className="stat-card"><span>Insoluti</span><strong>{selected.insolvents}</strong></div></div>
      <div className="table-wrap"><table><thead><tr><th>Fattura</th><th>Vetture</th><th>Scadenza</th><th>Totale</th><th>Incassato</th><th>In R.I.B.A.</th><th>Residuo</th><th>Stato</th></tr></thead><tbody>{selected.invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.number}</strong><small>{invoice.issueDate}</small></td><td>{invoice.lines.map((line) => data.vehicles.find((vehicle) => vehicle.id === line.vehicleId)?.plate ?? line.description).join(', ')}</td><td>{invoice.dueDate}</td><td>{money(invoice.total)}</td><td>{money(invoice.collectedAmount)}</td><td>{money(invoice.ribaAllocatedAmount)}</td><td>{money(invoiceResidual(invoice))}</td><td><span className="tag">{invoice.status}</span></td></tr>)}</tbody></table></div>
    </section>}

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">LAVORAZIONI CONSEGNATE</span><h3>Vetture da fatturare</h3></div></div><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Vetture</th><th>Imponibile previsto</th><th>Azione</th></tr></thead><tbody>{groups.map(([customerId, vehicles]) => <tr key={customerId}><td><strong>{customerById(customerId)?.name ?? 'Cliente'}</strong></td><td>{vehicles.map((vehicle) => vehicle.plate).join(', ')}</td><td>{money(vehicles.reduce((sum, vehicle) => sum + vehicle.expectedRevenue, 0))}</td><td><button className="primary" onClick={() => invoiceCustomer(customerId, vehicles.map((vehicle) => vehicle.id))}>Crea fattura</button></td></tr>)}</tbody></table></div>{!groups.length && <div className="empty"><div>◇</div><p>Nessuna vettura consegnata da fatturare.</p></div>}</section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">SCADENZIARIO</span><h3>Fatture e residui</h3></div></div><div className="table-wrap"><table><thead><tr><th>Fattura</th><th>Cliente</th><th>Scadenza</th><th>Totale</th><th>In R.I.B.A.</th><th>Residuo disponibile</th><th>Stato</th><th>Azione</th></tr></thead><tbody>{data.invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.number}</strong><small>{invoice.issueDate}</small></td><td>{customerById(invoice.customerId)?.name ?? '—'}</td><td>{invoice.dueDate}</td><td>{money(invoice.total)}</td><td>{money(invoice.ribaAllocatedAmount)}</td><td>{money(invoiceResidual(invoice))}</td><td><span className="tag">{invoice.status}</span></td><td>{invoiceResidual(invoice) > 0 && invoice.paymentMethod === 'R.I.B.A.' ? <button onClick={() => createBatch(invoice.id)}>Inserisci in R.I.B.A.</button> : '—'}</td></tr>)}</tbody></table></div>{!data.invoices.length && <div className="empty"><div>◇</div><p>Nessuna fattura emessa.</p></div>}</section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">DISTINTE BANCARIE</span><h3>R.I.B.A. e anticipi</h3></div></div><div className="table-wrap"><table><thead><tr><th>Distinta</th><th>Banca</th><th>Totale</th><th>Anticipato</th><th>Scadenza</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>{data.ribaBatches.map((batch) => <tr key={batch.id}><td><strong>{batch.number}</strong><small>{batch.presentationDate}</small></td><td>{data.bankAccounts.find((bank) => bank.id === batch.bankAccountId)?.name ?? '—'}</td><td>{money(batch.total)}</td><td>{money(batch.advancedAmount)}</td><td>{batch.dueDate}</td><td><span className="tag">{batch.status}</span></td><td><div className="row-actions">{batch.status === 'Presentata' && <button onClick={() => { const amount = Number(window.prompt('Importo anticipato', String(batch.total))); const fees = Number(window.prompt('Commissioni bancarie', '0')); const interest = Number(window.prompt('Interessi', '0')); if ([amount, fees, interest].every(Number.isFinite)) run(() => registerRibaAdvance(data, batch.id, amount, today(), fees, interest), 'Anticipo registrato. Il credito cliente resta aperto.') }}>Registra anticipo</button>}{!['Chiusa', 'Insoluta', 'Stornata'].includes(batch.status) && <button onClick={() => run(() => settleRibaBatch(data, batch.id, today()), 'Incasso definitivo registrato.')}>Incassata</button>}{!['Chiusa', 'Insoluta', 'Stornata'].includes(batch.status) && <button className="danger" onClick={() => run(() => markRibaInsolvent(data, batch.id, today()), 'Insoluto registrato e credito riaperto.')}>Insoluta</button>}</div></td></tr>)}</tbody></table></div>{!data.ribaBatches.length && <div className="empty"><div>◇</div><p>Nessuna distinta R.I.B.A. registrata.</p></div>}</section>
  </>
}
