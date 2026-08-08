import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Modal } from '../../components/Modal'
import type { Customer, ErpData, PaymentMethod, QuoteStatus, RibaBatch, Vehicle } from '../../types'
import { calculateOwnerWithdrawalSnapshot, createInvoice, createRibaBatch, invoiceResidual, markOwnerWithdrawalSettled, markRibaInsolvent, registerRibaAdvance, settleRibaBatch, updateOwnerWithdrawal } from '../../services/finance'
import { CustomerFinanceDetail } from './CustomerFinanceDetail'
import {
  buildDocumentPrintHtml,
  calculateDocumentLines,
  calculateDocumentTotals,
  convertAcceptedQuoteToInvoice,
  createDocumentMessage,
  createQuoteDocument,
  registerCommunication,
  syncInvoiceDocumentStatuses,
  updateQuoteStatus,
} from '../../services/documents'
import { buildCalendarEvents, calculateCashFlowSnapshot, calculateCreditControl } from '../../services/cashflow'
import { calculateEconomicGoalSnapshot } from '../../services/economic'

const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const today = () => new Date().toISOString().slice(0, 10)
const dayDiff = (from: string, to: string) => Math.ceil((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400000)

const paymentMethods: PaymentMethod[] = ['Bonifico', 'R.I.B.A.', 'Contanti', 'POS', 'Personalizzato']

type CommunicationDraft = {
  documentType: 'preventivo' | 'fattura'
  documentId: string
  customerId: string
  vehicleId?: string
  number: string
  total: number
  dueDate: string
}

type FinanceModalState =
  | { type: 'company-profile' }
  | { type: 'owner-withdrawal' }
  | { type: 'quote-create'; vehicleId: string }
  | { type: 'quote-convert'; quoteId: string }
  | { type: 'customer-terms'; customerId: string }
  | { type: 'invoice-create'; customerId: string; vehicleIds: string[] }
  | { type: 'riba-create'; invoiceId: string }
  | { type: 'riba-advance'; batchId: string }
  | { type: 'communication'; draft: CommunicationDraft }

export function FinancePage({ data, onChange, customerById, setError, setNotice }: {
  data: ErpData
  onChange: (data: ErpData) => void
  customerById: (id: string) => Customer | undefined
  setError: (value: string) => void
  setNotice: (value: string) => void
}) {
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [calendarView, setCalendarView] = useState<'giorno' | 'settimana' | 'mese'>('mese')
  const [creditState, setCreditState] = useState<'all' | 'critical' | 'regular'>('all')
  const [modal, setModal] = useState<FinanceModalState | null>(null)

  const toInvoice = data.vehicles.filter((vehicle) => vehicle.billingStatus === 'Da fatturare' && !vehicle.invoiceId)
  const openInvoices = data.invoices.filter((invoice) => invoice.status !== 'Incassata' && invoice.status !== 'Stornata')
  const quotes = data.quotes ?? []
  const communications = data.communications ?? []
  const totalCredits = openInvoices.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0)
  const totalRiba = data.ribaBatches.filter((batch) => !['Chiusa', 'Stornata'].includes(batch.status)).reduce((sum, batch) => sum + batch.total, 0)
  const totalAdvanced = data.ribaBatches.filter((batch) => batch.status === 'Anticipata').reduce((sum, batch) => sum + batch.advancedAmount, 0)
  const overdue = openInvoices.filter((invoice) => invoice.dueDate < today()).reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0)
  const quotePending = quotes.filter((quote) => ['bozza', 'inviato'].includes(quote.status)).length
  const quoteAccepted = quotes.filter((quote) => quote.status === 'accettato').length
  const cashflow = useMemo(() => calculateCashFlowSnapshot(data), [data])
  const economicGoal = useMemo(() => calculateEconomicGoalSnapshot(data), [data])
  const ownerWithdrawal = useMemo(() => calculateOwnerWithdrawalSnapshot(data), [data])
  const creditRows = useMemo(() => calculateCreditControl(data, { state: creditState }), [data, creditState])
  const calendarEvents = useMemo(() => buildCalendarEvents(data, today(), calendarView), [data, calendarView])

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
    try {
      onChange(action())
      setError('')
      setNotice(message)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.')
    }
  }

  const printDocument = (documentType: 'preventivo' | 'fattura', documentId: string) => {
    try {
      const html = buildDocumentPrintHtml(data, documentType, documentId)
      const popup = window.open('', '_blank', 'noopener,noreferrer,width=980,height=900')
      if (!popup) throw new Error('Popup bloccato dal browser.')
      popup.document.open()
      popup.document.write(html)
      popup.document.close()
      popup.focus()
      popup.print()
      setNotice(`${documentType === 'preventivo' ? 'Preventivo' : 'Fattura'} pronto per stampa/PDF.`)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Impossibile aprire la stampa documento.')
    }
  }

  const alerts = [
    overdue > 0 ? `Hai ${money(overdue)} di fatture scadute da controllare.` : '',
    availableLimit < data.financeSettings.minimumProjectedBalance ? `Plafond bancario disponibile basso: ${money(availableLimit)}.` : '',
    customerRows.some((row) => row.rating === 'D') ? `${customerRows.filter((row) => row.rating === 'D').length} clienti risultano ad alto rischio finanziario.` : '',
    projected(30) < data.financeSettings.minimumProjectedBalance ? 'Gli incassi previsti nei prossimi 30 giorni sono sotto la soglia impostata.' : '',
  ].filter(Boolean)

  return <>
    <section className="stat-grid finance-stats">
      <div className="stat-card"><span>Crediti clienti</span><strong>{money(totalCredits)}</strong><small>{openInvoices.length} fatture aperte</small></div>
      <div className="stat-card"><span>R.I.B.A. in corso</span><strong>{money(totalRiba)}</strong><small>{data.ribaBatches.filter((item) => !['Chiusa', 'Stornata'].includes(item.status)).length} distinte</small></div>
      <div className="stat-card"><span>Anticipi bancari</span><strong>{money(totalAdvanced)}</strong><small>Non chiudono il credito</small></div>
      <div className="stat-card"><span>Scaduto</span><strong>{money(overdue)}</strong><small>Da controllare</small></div>
      <div className="stat-card"><span>Preventivi pendenti</span><strong>{quotePending}</strong><small>Bozza o inviati</small></div>
      <div className="stat-card"><span>Preventivi accettati</span><strong>{quoteAccepted}</strong><small>Pronti conversione fattura</small></div>
      <div className="stat-card"><span>Cashflow rischio</span><strong>{money(cashflow.atRisk)}</strong><small>Esposizione prossimi 90 giorni</small></div>
      <div className="stat-card"><span>Comunicazioni</span><strong>{communications.length}</strong><small>Email/WhatsApp/copia</small></div>
    </section>

    <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">CONFIGURAZIONE DOCUMENTI</span><h3>Profilo azienda e progressivi</h3></div></div>
      <div className="stat-grid">
        <div className="stat-card"><span>Ragione sociale</span><strong>{data.companyProfile?.name || 'ELIAS BODY SHOP'}</strong><small>P.IVA {data.companyProfile?.vatId || 'non impostata'}</small></div>
        <div className="stat-card"><span>Progressivo preventivi</span><strong>{data.documentCounters?.quote ?? 0}</strong><small>Formato PREV-AAAA-00001</small></div>
        <div className="stat-card"><span>Progressivo fatture</span><strong>{data.documentCounters?.invoice ?? 0}</strong><small>Formato FAT-AAAA-00001</small></div>
        <div className="stat-card"><span>Azioni</span><strong>Profilo</strong><small><button onClick={() => setModal({ type: 'company-profile' })}>Aggiorna dati azienda</button></small></div>
      </div>
    </section>

    <section className="panel"><div className="panel-head"><div><span className="eyebrow">ASSISTENTE FINANZIARIO</span><h3>Avvisi e liquidità prevista</h3></div></div>
      <div className="stat-grid"><div className="stat-card"><span>Entro 30 giorni</span><strong>{money(projected(30))}</strong><small>Incassi previsti</small></div><div className="stat-card"><span>Entro 60 giorni</span><strong>{money(projected(60))}</strong><small>Incassi previsti</small></div><div className="stat-card"><span>Entro 90 giorni</span><strong>{money(projected(90))}</strong><small>Incassi previsti</small></div><div className="stat-card"><span>Plafond disponibile</span><strong>{money(availableLimit)}</strong><small>Esposizione {money(bankExposure)}</small></div></div>
      <div className="stat-grid"><div className="stat-card"><span>Obiettivo dinamico</span><strong>{money(economicGoal.appliedRevenueGoal)}</strong><small>{economicGoal.status === 'ok' ? 'In linea' : economicGoal.status === 'warning' ? 'Attenzione' : 'In ritardo'} · residuo {money(economicGoal.residualNeed)}</small></div><div className="stat-card"><span>Fabbisogno giornaliero</span><strong>{money(economicGoal.dailyRevenueNeed)}</strong><small>{economicGoal.remainingWorkingDays} giorni lavorativi residui</small></div><div className="stat-card"><span>Prelievo titolare</span><strong>{money(ownerWithdrawal.amount)}</strong><small>Voce separata dai costi operativi</small></div><div className="stat-card"><span>Cuscinetto 10%</span><strong>{money(economicGoal.safetyBuffer)}</strong><small>Su base fabbisogno mensile</small></div></div>
      <div className="activity">{alerts.map((alert) => <div key={alert}><b>!</b><span><strong>Attenzione</strong><small>{alert}</small></span></div>)}{!alerts.length && <div className="empty"><div>✓</div><p>Nessuna criticità finanziaria rilevata.</p></div>}</div>
    </section>

    <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">PRELIEVO TITOLARE</span><h3>Voce finanziaria separata</h3></div><div className="row-actions"><button onClick={() => setModal({ type: 'owner-withdrawal' })}>Modifica</button><button className="primary" onClick={() => run(() => markOwnerWithdrawalSettled(data), 'Prelievo titolare segnato come effettuato.')}>{ownerWithdrawal.settled ? 'Effettuato' : 'Marca effettuato'}</button></div></div>
      <div className="stat-grid"><div className="stat-card"><span>Importo mensile</span><strong>{money(ownerWithdrawal.amount)}</strong><small>Separa cassa personale e costi aziendali</small></div><div className="stat-card"><span>Data prevista</span><strong>{ownerWithdrawal.plannedDate}</strong><small>{ownerWithdrawal.settled ? 'Già effettuato questo mese' : 'In attesa di prelievo'}</small></div><div className="stat-card"><span>Stato</span><strong>{ownerWithdrawal.settled ? 'Effettuato' : 'Da effettuare'}</strong><small>{ownerWithdrawal.settledAt ? new Date(ownerWithdrawal.settledAt).toLocaleString('it-IT') : 'Non ancora registrato'}</small></div><div className="stat-card"><span>Impatto cash flow</span><strong>{money(ownerWithdrawal.amount)}</strong><small>Considerato nella previsione di liquidità</small></div></div>
    </section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">PREVENTIVI PROFESSIONALI</span><h3>Creazione, invio, conversione e PDF</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>Numero</th><th>Cliente / Vettura</th><th>Emissione</th><th>Scadenza</th><th>Imponibile</th><th>IVA</th><th>Totale</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>
        {quotes.map((quote) => {
          const customer = customerById(quote.customerId)
          const vehicle = data.vehicles.find((item) => item.id === quote.vehicleId)
          return <tr key={quote.id}><td><strong>{quote.number}</strong><small>{quote.lines.length} righe</small></td><td><strong>{customer?.name ?? '—'}</strong><small>{vehicle?.plate ?? '—'} · {vehicle ? `${vehicle.make} ${vehicle.model}` : ''}</small></td><td>{quote.issueDate}</td><td>{quote.dueDate}</td><td>{money(quote.taxableAmount)}</td><td>{money(quote.vatAmount)}</td><td>{money(quote.total)}</td><td><span className="tag">{quote.status}</span></td><td><div className="row-actions"><button onClick={() => run(() => updateQuoteStatus(data, quote.id, quote.status === 'inviato' ? 'bozza' : 'inviato'), quote.status === 'inviato' ? 'Preventivo riportato in bozza.' : 'Preventivo marcato come inviato.')}>{quote.status === 'inviato' ? 'Bozza' : 'Inviato'}</button><button onClick={() => run(() => updateQuoteStatus(data, quote.id, 'accettato'), 'Preventivo accettato registrato.')}>Accetta</button><button className="danger" onClick={() => run(() => updateQuoteStatus(data, quote.id, 'rifiutato'), 'Preventivo rifiutato registrato.')}>Rifiuta</button><button onClick={() => setModal({ type: 'quote-convert', quoteId: quote.id })} disabled={quote.status !== 'accettato' || !!quote.invoiceId}>In fattura</button><button onClick={() => printDocument('preventivo', quote.id)}>PDF</button><button onClick={() => setModal({ type: 'communication', draft: { documentType: 'preventivo', documentId: quote.id, customerId: quote.customerId, vehicleId: quote.vehicleId, number: quote.number, total: quote.total, dueDate: quote.dueDate } })}>Comunica</button></div></td></tr>
        })}
      </tbody></table></div>
      {!quotes.length && <div className="empty"><div>◇</div><p>Nessun preventivo registrato.</p></div>}
      {!!toInvoice.length && <div className="table-wrap"><table><thead><tr><th>Vettura consegnata</th><th>Cliente</th><th>Ricavo previsto</th><th>Azione preventivo</th></tr></thead><tbody>{toInvoice.map((vehicle) => <tr key={vehicle.id}><td><strong>{vehicle.plate}</strong><small>{vehicle.make} {vehicle.model}</small></td><td>{customerById(vehicle.customerId)?.name ?? '—'}</td><td>{money(vehicle.expectedRevenue)}</td><td><button className="primary" onClick={() => setModal({ type: 'quote-create', vehicleId: vehicle.id })}>Crea preventivo professionale</button></td></tr>)}</tbody></table></div>}
    </section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">SITUAZIONE CONCESSIONARI E CLIENTI</span><h3>Esposizione per cliente</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Vetture</th><th>Fatturato</th><th>Incassato</th><th>Credito aperto</th><th>Scaduto</th><th>In R.I.B.A.</th><th>Ritardo medio</th><th>Rating</th><th>Azioni</th></tr></thead><tbody>{customerRows.map((row) => <tr key={row.customer.id}><td><strong>{row.customer.name}</strong><small>{row.customer.usualPaymentMethod ?? 'Bonifico'} · {row.customer.endOfMonth ? 'FM +' : ''} {row.customer.paymentDays ?? data.financeSettings.defaultPaymentDays} gg</small></td><td>{row.vehicles.length}</td><td>{money(row.invoiced)}</td><td>{money(row.collected)}</td><td>{money(row.outstanding)}</td><td>{money(row.expired)}</td><td>{money(row.inRiba)}</td><td>{row.averageDelay} gg</td><td><span className="tag">{row.rating}</span></td><td><div className="row-actions"><button onClick={() => setSelectedCustomerId(row.customer.id)}>Dettaglio</button><button onClick={() => setModal({ type: 'customer-terms', customerId: row.customer.id })}>Condizioni</button></div></td></tr>)}</tbody></table></div>
    </section>

    {selected && <CustomerFinanceDetail row={selected} data={data} onEditTerms={() => setModal({ type: 'customer-terms', customerId: selected.customer.id })} />}

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">LAVORAZIONI CONSEGNATE</span><h3>Vetture da fatturare</h3></div></div><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Vetture</th><th>Imponibile previsto</th><th>Azione</th></tr></thead><tbody>{groups.map(([customerId, vehicles]) => <tr key={customerId}><td><strong>{customerById(customerId)?.name ?? 'Cliente'}</strong></td><td>{vehicles.map((vehicle) => vehicle.plate).join(', ')}</td><td>{money(vehicles.reduce((sum, vehicle) => sum + vehicle.expectedRevenue, 0))}</td><td><button className="primary" onClick={() => setModal({ type: 'invoice-create', customerId, vehicleIds: vehicles.map((vehicle) => vehicle.id) })}>Crea fattura</button></td></tr>)}</tbody></table></div>{!groups.length && <div className="empty"><div>◇</div><p>Nessuna vettura consegnata da fatturare.</p></div>}</section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">SCADENZIARIO</span><h3>Fatture e residui</h3></div></div><div className="table-wrap"><table><thead><tr><th>Fattura</th><th>Cliente</th><th>Scadenza</th><th>Totale</th><th>In R.I.B.A.</th><th>Residuo disponibile</th><th>Stato</th><th>Azione</th></tr></thead><tbody>{data.invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.number}</strong><small>{invoice.issueDate}</small></td><td>{customerById(invoice.customerId)?.name ?? '—'}</td><td>{invoice.dueDate}</td><td>{money(invoice.total)}</td><td>{money(invoice.ribaAllocatedAmount)}</td><td>{money(invoiceResidual(invoice))}</td><td><span className="tag">{invoice.status}</span></td><td>{invoiceResidual(invoice) > 0 && invoice.paymentMethod === 'R.I.B.A.' ? <button onClick={() => setModal({ type: 'riba-create', invoiceId: invoice.id })}>Inserisci in R.I.B.A.</button> : '—'}</td></tr>)}</tbody></table></div>{!data.invoices.length && <div className="empty"><div>◇</div><p>Nessuna fattura emessa.</p></div>}</section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">FATTURE PROFESSIONALI</span><h3>Comunicazioni e stampa documento</h3></div><button onClick={() => run(() => syncInvoiceDocumentStatuses(data), 'Stati documento fattura sincronizzati.')}>Sincronizza stati</button></div>
      <div className="table-wrap"><table><thead><tr><th>Numero</th><th>Cliente</th><th>Scadenza</th><th>Totale</th><th>Incassato</th><th>Residuo</th><th>Stato doc.</th><th>Azioni</th></tr></thead><tbody>{data.invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.number}</strong><small>{invoice.issueDate}</small></td><td>{customerById(invoice.customerId)?.name ?? '—'}</td><td>{invoice.dueDate}</td><td>{money(invoice.total)}</td><td>{money(invoice.collectedAmount)}</td><td>{money(Math.max(0, invoice.total - invoice.collectedAmount))}</td><td><span className="tag">{invoice.documentStatus ?? 'emessa'}</span></td><td><div className="row-actions"><button onClick={() => printDocument('fattura', invoice.id)}>PDF</button><button onClick={() => setModal({ type: 'communication', draft: { documentType: 'fattura', documentId: invoice.id, customerId: invoice.customerId, vehicleId: invoice.vehicleId, number: invoice.number, total: invoice.total, dueDate: invoice.dueDate } })}>Comunica</button></div></td></tr>)}</tbody></table></div>
      {!data.invoices.length && <div className="empty"><div>◇</div><p>Nessuna fattura disponibile.</p></div>}
    </section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">CALENDARIO SCADENZE</span><h3>Giorno, settimana e mese</h3></div><div className="row-actions"><button onClick={() => setCalendarView('giorno')}>Giorno</button><button onClick={() => setCalendarView('settimana')}>Settimana</button><button onClick={() => setCalendarView('mese')}>Mese</button></div></div>
      <div className="table-wrap"><table><thead><tr><th>Data</th><th>Evento</th><th>Tipo</th><th>Cliente</th><th>Importo</th><th>Priorità</th></tr></thead><tbody>{calendarEvents.map((event) => <tr key={event.id}><td>{event.date}</td><td>{event.title}</td><td><span className="tag">{event.type}</span></td><td>{event.customerId ? (customerById(event.customerId)?.name ?? '—') : '—'}</td><td>{event.amount ? money(event.amount) : '—'}</td><td><span className="tag">{event.status}</span></td></tr>)}</tbody></table></div>
      {!calendarEvents.length && <div className="empty"><div>◇</div><p>Nessun evento nel periodo selezionato.</p></div>}
    </section>

    <section className="panel"><div className="panel-head"><div><span className="eyebrow">CASHFLOW</span><h3>Proiezione 30/60/90 giorni</h3></div></div>
      <div className="stat-grid">
        {cashflow.windows.map((window) => <div className="stat-card" key={window.days}><span>Orizzonte {window.days} giorni</span><strong>{money(window.balance)}</strong><small>Entrate {money(window.inflow)} · Uscite {money(window.outflow)}</small></div>)}
        <div className="stat-card"><span>Incassato</span><strong>{money(cashflow.collected)}</strong><small>Eventi registrati</small></div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Punto</th><th>Data</th><th>Liquidità</th><th>Entrate</th><th>Uscite</th><th>Scaduto</th><th>A rischio</th></tr></thead><tbody>{cashflow.points.map((point) => <tr key={point.label}><td>{point.label}</td><td>{point.date}</td><td>{money(point.liquidBalance)}</td><td>{money(point.inflow)}</td><td>{money(point.outflow)}</td><td>{money(point.overdue)}</td><td>{money(point.atRisk)}</td></tr>)}</tbody></table></div>
      {cashflow.baseLiquidity === null && <div className="empty"><div>!</div><p>Nessuna banca configurata: la liquidità parte da 0. Aggiungi almeno un conto per una previsione completa.</p></div>}
    </section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">CREDIT CONTROL</span><h3>Scaduti e rischio cliente</h3></div><div className="row-actions"><button onClick={() => setCreditState('all')}>Tutti</button><button onClick={() => setCreditState('critical')}>Critici</button><button onClick={() => setCreditState('regular')}>Regolari</button></div></div>
      <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Credito aperto</th><th>Scaduto</th><th>Ritardo medio</th><th>Fatture aperte</th><th>Classe rischio</th></tr></thead><tbody>{creditRows.map((row) => <tr key={row.customerId}><td>{row.customerName}</td><td>{money(row.openCredit)}</td><td>{money(row.overdueCredit)}</td><td>{row.averageCollectionDays} gg</td><td>{row.openInvoices}</td><td><span className="tag">{row.critical ? 'Critico' : 'Regolare'}</span></td></tr>)}</tbody></table></div>
      {!creditRows.length && <div className="empty"><div>✓</div><p>Nessuna esposizione aperta per il filtro selezionato.</p></div>}
    </section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">STORICO COMUNICAZIONI</span><h3>Messaggi inviati o preparati</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>Data</th><th>Canale</th><th>Documento</th><th>Cliente</th><th>Destinazione</th><th>Messaggio</th></tr></thead><tbody>{communications.map((entry) => <tr key={entry.id}><td>{entry.createdAt.slice(0, 10)}</td><td><span className="tag">{entry.channel}</span></td><td>{entry.documentType} {entry.documentId}</td><td>{customerById(entry.customerId)?.name ?? '—'}</td><td>{entry.target}</td><td><small>{entry.message}</small></td></tr>)}</tbody></table></div>
      {!communications.length && <div className="empty"><div>◇</div><p>Nessuna comunicazione registrata.</p></div>}
    </section>

    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">DISTINTE BANCARIE</span><h3>R.I.B.A. e anticipi</h3></div></div><div className="table-wrap"><table><thead><tr><th>Distinta</th><th>Banca</th><th>Totale</th><th>Anticipato</th><th>Scadenza</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>{data.ribaBatches.map((batch) => <tr key={batch.id}><td><strong>{batch.number}</strong><small>{batch.presentationDate}</small></td><td>{data.bankAccounts.find((bank) => bank.id === batch.bankAccountId)?.name ?? '—'}</td><td>{money(batch.total)}</td><td>{money(batch.advancedAmount)}</td><td>{batch.dueDate}</td><td><span className="tag">{batch.status}</span></td><td><div className="row-actions">{batch.status === 'Presentata' && <button onClick={() => setModal({ type: 'riba-advance', batchId: batch.id })}>Registra anticipo</button>}{!['Chiusa', 'Insoluta', 'Stornata'].includes(batch.status) && <button onClick={() => run(() => settleRibaBatch(data, batch.id, today()), 'Incasso definitivo registrato.')}>Incassata</button>}{!['Chiusa', 'Insoluta', 'Stornata'].includes(batch.status) && <button className="danger" onClick={() => run(() => markRibaInsolvent(data, batch.id, today()), 'Insoluto registrato e credito riaperto.')}>Insoluta</button>}</div></td></tr>)}</tbody></table></div>{!data.ribaBatches.length && <div className="empty"><div>◇</div><p>Nessuna distinta R.I.B.A. registrata.</p></div>}</section>

    {modal?.type === 'company-profile' && <CompanyProfileModal
      profile={data.companyProfile}
      onClose={() => setModal(null)}
      onSave={(profile) => {
        onChange({ ...data, companyProfile: profile })
        setModal(null)
        setNotice('Profilo azienda aggiornato per stampa preventivi/fatture.')
      }}
    />}

    {modal?.type === 'owner-withdrawal' && <OwnerWithdrawalModal
      amount={ownerWithdrawal.amount}
      plannedDate={ownerWithdrawal.plannedDate}
      onClose={() => setModal(null)}
      onSave={(input) => {
        onChange(updateOwnerWithdrawal(data, input))
        setModal(null)
        setNotice('Prelievo titolare aggiornato.')
      }}
    />}

    {modal?.type === 'quote-create' && (() => {
      const vehicle = data.vehicles.find((item) => item.id === modal.vehicleId)
      if (!vehicle) return null
      const customer = customerById(vehicle.customerId)
      if (!customer) return null
      return <QuoteCreateModal
        vehicle={vehicle}
        customer={customer}
        defaultVatRate={data.financeSettings.defaultVatRate}
        onClose={() => setModal(null)}
        onSave={(input) => {
          run(() => createQuoteDocument(data, input), `Preventivo creato per ${customer.name} (${vehicle.plate}).`)
          setModal(null)
        }}
      />
    })()}

    {modal?.type === 'quote-convert' && (() => {
      const quote = quotes.find((item) => item.id === modal.quoteId)
      if (!quote) return null
      return <QuoteConvertModal
        quoteNumber={quote.number}
        onClose={() => setModal(null)}
        onSave={(input) => {
          run(() => syncInvoiceDocumentStatuses(convertAcceptedQuoteToInvoice(data, input)), `Preventivo ${quote.number} convertito in fattura.`)
          setModal(null)
        }}
        quoteId={quote.id}
      />
    })()}

    {modal?.type === 'customer-terms' && (() => {
      const customer = customerById(modal.customerId)
      if (!customer) return null
      return <CustomerTermsModal
        customer={customer}
        defaultPaymentDays={data.financeSettings.defaultPaymentDays}
        onClose={() => setModal(null)}
        onSave={(input) => {
          onChange({ ...data, customers: data.customers.map((item) => item.id === customer.id ? { ...item, ...input } : item) })
          setModal(null)
          setNotice(`Condizioni di pagamento aggiornate per ${customer.name}.`)
        }}
      />
    })()}

    {modal?.type === 'invoice-create' && (() => {
      const customer = customerById(modal.customerId)
      if (!customer) return null
      const vehicles = data.vehicles.filter((item) => modal.vehicleIds.includes(item.id))
      return <InvoiceCreateModal
        customer={customer}
        vehicles={vehicles}
        defaultVatRate={data.financeSettings.defaultVatRate}
        onClose={() => setModal(null)}
        onSave={(input) => {
          run(() => createInvoice(data, input), `Fattura ${input.number} creata correttamente.`)
          setModal(null)
        }}
      />
    })()}

    {modal?.type === 'riba-create' && (() => {
      const invoice = data.invoices.find((item) => item.id === modal.invoiceId)
      if (!invoice) return null
      return <RibaCreateModal
        invoice={invoice}
        banks={data.bankAccounts}
        residual={invoiceResidual(invoice)}
        onClose={() => setModal(null)}
        onSave={(input) => {
          run(() => createRibaBatch(data, input), `Distinta ${input.number} creata senza duplicazioni.`)
          setModal(null)
        }}
      />
    })()}

    {modal?.type === 'riba-advance' && (() => {
      const batch = data.ribaBatches.find((item) => item.id === modal.batchId)
      if (!batch) return null
      return <RibaAdvanceModal
        batch={batch}
        onClose={() => setModal(null)}
        onSave={(input) => {
          run(() => registerRibaAdvance(data, batch.id, input.amount, input.date, input.fees, input.interest), 'Anticipo registrato. Il credito cliente resta aperto.')
          setModal(null)
        }}
      />
    })()}

    {modal?.type === 'communication' && (() => {
      const customer = customerById(modal.draft.customerId)
      if (!customer) return null
      const vehicle = modal.draft.vehicleId ? data.vehicles.find((item) => item.id === modal.draft.vehicleId) : undefined
      return <CommunicationModal
        draft={modal.draft}
        customer={customer}
        vehicle={vehicle}
        onClose={() => setModal(null)}
        onSave={({ channel, target, message }) => {
          if (channel === 'copy') {
            navigator.clipboard?.writeText(message).catch(() => undefined)
            setNotice('Testo comunicazione copiato negli appunti.')
          } else if (channel === 'email') {
            const subject = `${modal.draft.documentType === 'preventivo' ? 'PREVENTIVO' : 'FATTURA'} ${modal.draft.number}`
            const link = `mailto:${encodeURIComponent(target)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
            window.open(link, '_blank', 'noopener,noreferrer')
            setNotice('Bozza email aperta.')
          } else {
            const link = `https://wa.me/${encodeURIComponent(target.replace(/\s+/g, ''))}?text=${encodeURIComponent(message)}`
            window.open(link, '_blank', 'noopener,noreferrer')
            setNotice('Bozza WhatsApp aperta.')
          }

          onChange(registerCommunication(data, {
            channel,
            documentType: modal.draft.documentType,
            documentId: modal.draft.documentId,
            customerId: modal.draft.customerId,
            vehicleId: modal.draft.vehicleId,
            message,
            target,
          }))

          setModal(null)
        }}
      />
    })()}
  </>
}

function CompanyProfileModal({ profile, onClose, onSave }: {
  profile: ErpData['companyProfile']
  onClose: () => void
  onSave: (value: NonNullable<ErpData['companyProfile']>) => void
}) {
  const [form, setForm] = useState({
    name: profile?.name ?? 'ELIAS BODY SHOP',
    vatId: profile?.vatId ?? '',
    taxCode: profile?.taxCode ?? '',
    address: profile?.address ?? '',
    phone: profile?.phone ?? '',
    email: profile?.email ?? '',
    logoText: profile?.logoText ?? 'ELIAS',
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) return
    onSave({
      name: form.name.trim(),
      vatId: form.vatId.trim(),
      taxCode: form.taxCode.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      logoText: form.logoText.trim() || 'ELIAS',
    })
  }

  return <Modal title="Profilo azienda" onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label>Ragione sociale<input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required /></label>
      <label>Partita IVA<input value={form.vatId} onChange={(event) => setForm((prev) => ({ ...prev, vatId: event.target.value }))} /></label>
      <label>Codice fiscale<input value={form.taxCode} onChange={(event) => setForm((prev) => ({ ...prev, taxCode: event.target.value }))} /></label>
      <label>Indirizzo<input value={form.address} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} /></label>
      <label>Telefono<input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} /></label>
      <label>Email<input type="email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} /></label>
      <label>Logo testo<input value={form.logoText} onChange={(event) => setForm((prev) => ({ ...prev, logoText: event.target.value }))} /></label>
      <div className="form-actions"><button type="button" onClick={onClose}>Annulla</button><button className="primary" type="submit">Salva</button></div>
    </form>
  </Modal>
}

function OwnerWithdrawalModal({ amount, plannedDate, onClose, onSave }: {
  amount: number
  plannedDate: string
  onClose: () => void
  onSave: (value: { amount: number; plannedDate: string }) => void
}) {
  const [draftAmount, setDraftAmount] = useState(amount)
  const [draftPlannedDate, setDraftPlannedDate] = useState(plannedDate)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave({ amount: Math.max(0, draftAmount), plannedDate: draftPlannedDate })
  }

  return <Modal title="Prelievo titolare" onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label>Importo mensile<input type="number" min="0" step="0.01" value={draftAmount} onChange={(event) => setDraftAmount(Number(event.target.value) || 0)} required /></label>
      <label>Data prevista<input type="date" value={draftPlannedDate} onChange={(event) => setDraftPlannedDate(event.target.value)} required /></label>
      <div className="form-actions"><button type="button" onClick={onClose}>Annulla</button><button className="primary" type="submit">Salva</button></div>
    </form>
  </Modal>
}

function QuoteCreateModal({ vehicle, customer, defaultVatRate, onClose, onSave }: {
  vehicle: Vehicle
  customer: Customer
  defaultVatRate: number
  onClose: () => void
  onSave: (value: {
    customerId: string
    vehicleId: string
    issueDate: string
    validityDays: number
    number?: string
    status?: QuoteStatus
    notes?: string
    lines: { description: string; quantity: number; unitPrice: number; vatRate: number; discountRate?: number }[]
  }) => void
}) {
  const [number, setNumber] = useState('')
  const [issueDate, setIssueDate] = useState(today())
  const [validityDays, setValidityDays] = useState(30)
  const [status, setStatus] = useState<QuoteStatus>('bozza')
  const [notes, setNotes] = useState(`Preventivo relativo alla vettura ${vehicle.plate}`)
  const [lines, setLines] = useState([{ description: `Lavorazione ${vehicle.plate}`, quantity: 1, unitPrice: vehicle.expectedRevenue || 0, vatRate: defaultVatRate, discountRate: 0 }])

  const calculatedLines = useMemo(() => calculateDocumentLines(lines), [lines])
  const totals = useMemo(() => calculateDocumentTotals(calculatedLines), [calculatedLines])

  const updateLine = (index: number, field: keyof (typeof lines)[number], value: string) => {
    setLines((prev) => prev.map((line, rowIndex) => rowIndex === index
      ? {
          ...line,
          [field]: field === 'description' ? value : Number(value),
        }
      : line))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave({
      customerId: customer.id,
      vehicleId: vehicle.id,
      issueDate,
      validityDays,
      number: number.trim() || undefined,
      status,
      notes,
      lines,
    })
  }

  return <Modal title={`Nuovo preventivo · ${vehicle.plate}`} onClose={onClose}>
    <form className="form-grid finance-form-grid" onSubmit={submit}>
      <div className="form-section-title">Cliente {customer.name}</div>
      <label>Numero (opzionale)<input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="PREV-2026-00001" /></label>
      <label>Data emissione<input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required /></label>
      <label>Validità giorni<input type="number" min="0" value={validityDays} onChange={(event) => setValidityDays(Number(event.target.value) || 0)} required /></label>
      <label>Stato<select value={status} onChange={(event) => setStatus(event.target.value as QuoteStatus)}><option value="bozza">bozza</option><option value="inviato">inviato</option><option value="accettato">accettato</option><option value="rifiutato">rifiutato</option></select></label>
      <label className="full">Note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></label>

      <div className="form-section-title">Righe documento</div>
      {lines.map((line, index) => <div key={index} className="finance-line-grid">
        <label>Descrizione<input value={line.description} onChange={(event) => updateLine(index, 'description', event.target.value)} required /></label>
        <label>Q.tà<input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} required /></label>
        <label>Prezzo<input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(index, 'unitPrice', event.target.value)} required /></label>
        <label>IVA %<input type="number" min="0" step="0.01" value={line.vatRate} onChange={(event) => updateLine(index, 'vatRate', event.target.value)} required /></label>
        <label>Sconto %<input type="number" min="0" step="0.01" value={line.discountRate} onChange={(event) => updateLine(index, 'discountRate', event.target.value)} /></label>
        <button type="button" className="danger" onClick={() => setLines((prev) => prev.length > 1 ? prev.filter((_, rowIndex) => rowIndex !== index) : prev)} disabled={lines.length === 1}>Rimuovi</button>
      </div>)}
      <div className="row-actions"><button type="button" onClick={() => setLines((prev) => [...prev, { description: '', quantity: 1, unitPrice: 0, vatRate: defaultVatRate, discountRate: 0 }])}>Aggiungi riga</button></div>

      <div className="stat-grid finance-mini-totals"><div className="stat-card"><span>Imponibile</span><strong>{money(totals.taxableAmount)}</strong></div><div className="stat-card"><span>IVA</span><strong>{money(totals.vatAmount)}</strong></div><div className="stat-card"><span>Totale</span><strong>{money(totals.total)}</strong></div></div>
      <div className="form-actions"><button type="button" onClick={onClose}>Annulla</button><button className="primary" type="submit">Crea preventivo</button></div>
    </form>
  </Modal>
}

function QuoteConvertModal({ quoteId, quoteNumber, onClose, onSave }: {
  quoteId: string
  quoteNumber: string
  onClose: () => void
  onSave: (value: { quoteId: string; issueDate: string; dueDate?: string; paymentMethod?: PaymentMethod }) => void
}) {
  const [issueDate, setIssueDate] = useState(today())
  const [dueDate, setDueDate] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Bonifico')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave({ quoteId, issueDate, dueDate: dueDate || undefined, paymentMethod })
  }

  return <Modal title={`Converti in fattura · ${quoteNumber}`} onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label>Data fattura<input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required /></label>
      <label>Scadenza (opzionale)<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      <label>Metodo pagamento<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>{paymentMethods.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <div className="form-actions"><button type="button" onClick={onClose}>Annulla</button><button className="primary" type="submit">Converti</button></div>
    </form>
  </Modal>
}

function CustomerTermsModal({ customer, defaultPaymentDays, onClose, onSave }: {
  customer: Customer
  defaultPaymentDays: number
  onClose: () => void
  onSave: (value: { usualPaymentMethod: PaymentMethod; paymentDays: number; endOfMonth: boolean }) => void
}) {
  const [method, setMethod] = useState<PaymentMethod>(customer.usualPaymentMethod ?? 'Bonifico')
  const [days, setDays] = useState(customer.paymentDays ?? defaultPaymentDays)
  const [endOfMonth, setEndOfMonth] = useState(Boolean(customer.endOfMonth))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave({ usualPaymentMethod: method, paymentDays: Math.max(0, days), endOfMonth })
  }

  return <Modal title={`Condizioni pagamento · ${customer.name}`} onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label>Metodo pagamento<select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{paymentMethods.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Giorni pagamento<input type="number" min="0" value={days} onChange={(event) => setDays(Number(event.target.value) || 0)} /></label>
      <label className="finance-checkbox"><input type="checkbox" checked={endOfMonth} onChange={(event) => setEndOfMonth(event.target.checked)} />Calcolo scadenza a fine mese</label>
      <div className="form-actions"><button type="button" onClick={onClose}>Annulla</button><button className="primary" type="submit">Salva</button></div>
    </form>
  </Modal>
}

function InvoiceCreateModal({ customer, vehicles, defaultVatRate, onClose, onSave }: {
  customer: Customer
  vehicles: Vehicle[]
  defaultVatRate: number
  onClose: () => void
  onSave: (value: { customerId: string; vehicleIds: string[]; number: string; issueDate: string; paymentMethod?: PaymentMethod; vatRate?: number }) => void
}) {
  const [number, setNumber] = useState('')
  const [issueDate, setIssueDate] = useState(today())
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(customer.usualPaymentMethod ?? 'Bonifico')
  const [vatRate, setVatRate] = useState(defaultVatRate)
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>(vehicles.map((vehicle) => vehicle.id))

  const toggleVehicle = (vehicleId: string) => {
    setSelectedVehicleIds((prev) => prev.includes(vehicleId) ? prev.filter((id) => id !== vehicleId) : [...prev, vehicleId])
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!number.trim() || !selectedVehicleIds.length) return
    onSave({ customerId: customer.id, vehicleIds: selectedVehicleIds, number: number.trim(), issueDate, paymentMethod, vatRate })
  }

  return <Modal title={`Nuova fattura · ${customer.name}`} onClose={onClose}>
    <form className="form-grid finance-form-grid" onSubmit={submit}>
      <label>Numero fattura<input value={number} onChange={(event) => setNumber(event.target.value)} required /></label>
      <label>Data fattura<input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required /></label>
      <label>Metodo pagamento<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>{paymentMethods.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Aliquota IVA %<input type="number" min="0" step="0.01" value={vatRate} onChange={(event) => setVatRate(Number(event.target.value) || 0)} /></label>

      <div className="form-section-title">Vetture da fatturare</div>
      <div className="finance-selection-list">
        {vehicles.map((vehicle) => <label key={vehicle.id} className="finance-checkbox"><input type="checkbox" checked={selectedVehicleIds.includes(vehicle.id)} onChange={() => toggleVehicle(vehicle.id)} />{vehicle.plate} · {vehicle.make} {vehicle.model} · {money(vehicle.expectedRevenue)}</label>)}
      </div>

      <div className="form-actions"><button type="button" onClick={onClose}>Annulla</button><button className="primary" type="submit" disabled={!selectedVehicleIds.length}>Crea fattura</button></div>
    </form>
  </Modal>
}

function RibaCreateModal({ invoice, banks, residual, onClose, onSave }: {
  invoice: ErpData['invoices'][number]
  banks: ErpData['bankAccounts']
  residual: number
  onClose: () => void
  onSave: (value: { number: string; bankAccountId: string; presentationDate: string; dueDate: string; allocations: { invoiceId: string; amount: number }[] }) => void
}) {
  const [number, setNumber] = useState('')
  const [bankAccountId, setBankAccountId] = useState(banks[0]?.id ?? '')
  const [presentationDate, setPresentationDate] = useState(today())
  const [dueDate, setDueDate] = useState(invoice.dueDate)
  const [amount, setAmount] = useState(residual)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!number.trim() || !bankAccountId) return
    onSave({
      number: number.trim(),
      bankAccountId,
      presentationDate,
      dueDate,
      allocations: [{ invoiceId: invoice.id, amount }],
    })
  }

  return <Modal title={`Nuova distinta R.I.B.A. · ${invoice.number}`} onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label>Numero distinta<input value={number} onChange={(event) => setNumber(event.target.value)} required /></label>
      <label>Banca<select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} required>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
      <label>Data presentazione<input type="date" value={presentationDate} onChange={(event) => setPresentationDate(event.target.value)} required /></label>
      <label>Data scadenza<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></label>
      <label>Importo da presentare<input type="number" min="0.01" max={residual} step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value) || 0)} required /></label>
      <small>Residuo disponibile: {money(residual)}</small>
      <div className="form-actions"><button type="button" onClick={onClose}>Annulla</button><button className="primary" type="submit">Crea distinta</button></div>
    </form>
  </Modal>
}

function RibaAdvanceModal({ batch, onClose, onSave }: {
  batch: RibaBatch
  onClose: () => void
  onSave: (value: { amount: number; date: string; fees: number; interest: number }) => void
}) {
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState(batch.total)
  const [fees, setFees] = useState(0)
  const [interest, setInterest] = useState(0)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave({ amount, date, fees, interest })
  }

  return <Modal title={`Registra anticipo · ${batch.number}`} onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label>Data anticipo<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
      <label>Importo anticipato<input type="number" min="0.01" max={batch.total} step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value) || 0)} required /></label>
      <label>Commissioni<input type="number" min="0" step="0.01" value={fees} onChange={(event) => setFees(Number(event.target.value) || 0)} /></label>
      <label>Interessi<input type="number" min="0" step="0.01" value={interest} onChange={(event) => setInterest(Number(event.target.value) || 0)} /></label>
      <div className="form-actions"><button type="button" onClick={onClose}>Annulla</button><button className="primary" type="submit">Registra</button></div>
    </form>
  </Modal>
}

function CommunicationModal({ draft, customer, vehicle, onClose, onSave }: {
  draft: CommunicationDraft
  customer: Customer
  vehicle?: Vehicle
  onClose: () => void
  onSave: (value: { channel: 'email' | 'whatsapp' | 'copy'; target: string; message: string }) => void
}) {
  const [channel, setChannel] = useState<'email' | 'whatsapp' | 'copy'>(customer.email ? 'email' : customer.phone ? 'whatsapp' : 'copy')
  const [target, setTarget] = useState(customer.email || customer.phone || 'appunti')
  const defaultMessage = useMemo(() => createDocumentMessage({
    channel,
    documentType: draft.documentType,
    customerName: customer.name,
    plate: vehicle?.plate ?? '-',
    number: draft.number,
    total: draft.total,
    dueDate: draft.dueDate,
  }).text, [channel, customer.name, vehicle?.plate, draft.documentType, draft.number, draft.total, draft.dueDate])
  const [message, setMessage] = useState(defaultMessage)

  useEffect(() => {
    setMessage(defaultMessage)
    if (channel === 'email') setTarget(customer.email || '')
    if (channel === 'whatsapp') setTarget(customer.phone || '')
    if (channel === 'copy') setTarget('appunti')
  }, [channel, customer.email, customer.phone, defaultMessage])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave({ channel, target: target.trim() || 'appunti', message })
  }

  return <Modal title={`${draft.documentType === 'preventivo' ? 'Comunicazione preventivo' : 'Comunicazione fattura'} · ${draft.number}`} onClose={onClose}>
    <form className="form-grid finance-form-grid" onSubmit={submit}>
      <label>Canale<select value={channel} onChange={(event) => setChannel(event.target.value as 'email' | 'whatsapp' | 'copy')}><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="copy">Copia testo</option></select></label>
      <label>Destinazione<input value={target} onChange={(event) => setTarget(event.target.value)} disabled={channel === 'copy'} /></label>
      <label className="full">Messaggio<textarea rows={8} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
      <div className="form-actions"><button type="button" onClick={onClose}>Annulla</button><button className="primary" type="submit">Registra e apri</button></div>
    </form>
  </Modal>
}
