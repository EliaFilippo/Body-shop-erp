import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { Icon } from './components/Icon'
import { Modal } from './components/Modal'
import { addVehicle, addVehicleCostEntry, createCustomer, deleteCustomer, deleteVehicle, moveVehicleCone, changeVehicleStatus, TOTAL_CONES, emptyData, updateCustomer, updateVehicle } from './services/erp'
import { loadDatabase, saveDatabase } from './services/database'
import { PlannerPage } from './features/planner/PlannerPage'
import { PlannerSettingsPage } from './features/planner/PlannerSettingsPage'
import { MonthlyGoalsSettingsPage } from './features/planner/MonthlyGoalsSettingsPage'
import { calculateDayCapacity, calculatePlanner, remainingHours } from './services/planner'
import { calculateExecutiveDashboardSnapshot, calculateVehicleEconomicSnapshot, vehicleEconomicImpact } from './services/economic'
import { calculateBusinessOverviewSnapshot, type BusinessOverviewPeriod } from './services/businessOverview'
import { appendAcceptancePhotoEntry, buildAcceptanceQuoteSummary, createAcceptanceDraft, createPhotoArchiveEntry, exportAcceptancePdf, toggleAcceptanceChecklistItem, updateConsumptionLine } from './services/acceptance'
import { FinancePage } from './features/finance/FinancePage'
import type { AcceptanceCase, AcceptanceLine, Customer, CustomerType, ErpData, Vehicle, VehicleCostCategory, VehicleStatus, View } from './types'

const nav: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' }, { id: 'customers', label: 'Clienti' },
  { id: 'vehicles', label: 'Veicoli' }, { id: 'cones', label: 'Gestione coni' },
  { id: 'planner', label: 'Planner intelligente' }, { id: 'planner-settings', label: 'Impostazioni Planner' },
  { id: 'monthly-goals', label: 'Obiettivi mensili' }, { id: 'acceptance', label: 'Accettazione' },
  { id: 'finance', label: 'Finance' },
]
const statuses: VehicleStatus[] = ['accettata', 'in lavorazione', 'pronta', 'consegnata', 'sospesa', 'annullata']
const formatDate = (value: string) => new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

function App() {
  const [data, setData] = useState<ErpData>(emptyData)
  const [databaseReady, setDatabaseReady] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<{ type: 'customer'; item?: Customer } | { type: 'vehicle'; item?: Vehicle } | null>(null)
  const [costModal, setCostModal] = useState<{ vehicleId: string } | null>(null)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    loadDatabase()
      .then((stored) => setData(stored))
      .catch((problem) => setError(problem instanceof Error ? problem.message : 'Impossibile caricare il database.'))
      .finally(() => setDatabaseReady(true))
  }, [])
  useEffect(() => {
    if (databaseReady) void saveDatabase(data).catch((problem) =>
      setError(problem instanceof Error ? problem.message : 'Impossibile salvare i dati.'),
    )
  }, [data, databaseReady])
  useEffect(() => {
    if (!databaseReady) return
    const result = calculatePlanner(data.vehicles, data.plannerSettings)
    const calculated = new Map(result.vehicles.map((item) => [item.vehicleId, item.calculatedDeliveryDate]))
    const vehicles = data.vehicles.map((vehicle) => ({
      ...vehicle,
      calculatedDeliveryDate: calculated.get(vehicle.id) ?? '',
    }))
    const unchangedVehicles = vehicles.every((vehicle, index) =>
      vehicle.calculatedDeliveryDate === data.vehicles[index].calculatedDeliveryDate,
    )
    const unchangedAssignments = JSON.stringify(result.assignments) === JSON.stringify(data.plannerAssignments)
    if (!unchangedVehicles || !unchangedAssignments) setData((current) => ({
      ...current,
      vehicles,
      plannerAssignments: result.assignments,
    }))
  }, [data.vehicles, data.plannerSettings, data.plannerAssignments, databaseReady])

  const customerById = (customerId: string) => data.customers.find((customer) => customer.id === customerId)
  const occupied = data.vehicles.filter((vehicle) => vehicle.coneNumber !== null)
  const filteredCustomers = data.customers.filter((customer) => `${customer.name} ${customer.phone} ${customer.email}`.toLowerCase().includes(query.toLowerCase()))
  const filteredVehicles = data.vehicles.filter((vehicle) => `${vehicle.plate} ${vehicle.make} ${vehicle.model} ${customerById(vehicle.customerId)?.name}`.toLowerCase().includes(query.toLowerCase()))

  const updateStatus = (vehicleId: string, status: VehicleStatus) => {
    try { setData(changeVehicleStatus(data, vehicleId, status)); setError('') }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') }
  }

  const title = nav.find((item) => item.id === view)?.label
  const selectedCostVehicle = costModal ? data.vehicles.find((vehicle) => vehicle.id === costModal.vehicleId) : undefined
  return <div className="app-shell">
    <aside className={menu ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><div className="brand-mark">E</div><div><strong>ELIAS</strong><span>BODY SHOP ERP</span></div></div>
      <nav>{nav.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); setMenu(false); setQuery('') }}><Icon name={item.id} /><span>{item.label}</span>{item.id === 'cones' && <b>{occupied.length}</b>}</button>)}</nav>
      <div className="sidebar-foot"><span className="online-dot" /> {databaseReady ? 'Archivio pronto' : 'Caricamento archivio'}</div>
    </aside>
    {menu && <button className="menu-overlay" onClick={() => setMenu(false)} aria-label="Chiudi menu" />}

    <main>
      <header><button className="menu-button" onClick={() => setMenu(true)}><Icon name="menu" /></button><div><span className="eyebrow">PANORAMICA OPERATIVA</span><h1>{title}</h1></div><div className="header-actions"><div className="search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca targa, cliente..." /></div><div className="avatar">FE</div></div></header>
      {error && <div className="toast error">{error}<button onClick={() => setError('')}>×</button></div>}
      {notice && <div className="toast success">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      <div className="content">
        {view === 'dashboard' && <Dashboard data={data} setView={setView} onNewVehicle={() => {
          if (data.customers.length) setModal({ type: 'vehicle' })
          else {
            setView('customers')
            setModal({ type: 'customer' })
          }
        }} onNewCustomer={() => setModal({ type: 'customer' })} />}
        {view === 'customers' && <Customers customers={filteredCustomers} data={data} onAdd={() => setModal({ type: 'customer' })} onEdit={(item) => setModal({ type: 'customer', item })} onDelete={(id) => { try { setData(deleteCustomer(data, id)); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } }} />}
        {view === 'vehicles' && <Vehicles vehicles={filteredVehicles} customers={data.customers} onAdd={() => setModal({ type: 'vehicle' })} onEdit={(item) => setModal({ type: 'vehicle', item })} onDelete={(id) => { if (window.confirm('Eliminare definitivamente questa vettura?')) { try { setData(deleteVehicle(data, id)); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } } }} onOpenCosts={(vehicleId) => setCostModal({ vehicleId })} updateStatus={updateStatus} customerById={customerById} />}
        {view === 'cones' && <Cones data={data} customerById={customerById} onMove={(vehicleId, cone) => { try { setData(moveVehicleCone(data, vehicleId, cone)); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } }} />}
        {view === 'planner' && <PlannerPage data={data} customerById={customerById} onOpenSettings={() => setView('planner-settings')} onMove={(vehicleId, date) => {
          const vehicle = data.vehicles.find((item) => item.id === vehicleId)
          if (!vehicle) return
          const capacity = calculateDayCapacity(date, data.plannerSettings)
          const hours = remainingHours(vehicle)
          if (hours > capacity.protected && !window.confirm(`La lavorazione richiede ${hours} ore, mentre il ${date} dispone di ${capacity.protected} ore protette. Eccedenza: ${Math.round((hours - capacity.protected) * 100) / 100} ore. Vuoi comunque fissare questa data di inizio?`)) return
          setData({ ...data, vehicles: data.vehicles.map((item) => item.id === vehicleId ? { ...item, manualPlanningDate: date } : item) })
        }} />}
        {view === 'planner-settings' && <PlannerSettingsPage settings={data.plannerSettings} onSave={(plannerSettings) => {
          setData({ ...data, plannerSettings })
          setNotice('Impostazioni Planner salvate e consegne ricalcolate.')
        }} />}
        {view === 'monthly-goals' && <MonthlyGoalsSettingsPage data={data} onSave={(plannerSettings) => {
          setData({ ...data, plannerSettings })
          setNotice('Obiettivi mensili salvati e storicizzati.')
        }} />}
        {view === 'finance' && <FinancePage data={data} onChange={setData} customerById={customerById} setError={setError} setNotice={setNotice} />}
        {view === 'acceptance' && <AcceptancePage data={data} customerById={customerById} onCreate={(customerId, vehicleId) => {
          const draft = createAcceptanceDraft(customerId, vehicleId, data.plannerSettings, new Date().toISOString().slice(0, 7))
          const existing = data.acceptances ?? []
          setData({ ...data, acceptances: [draft, ...existing] })
          setNotice('Nuova pratica di accettazione creata e salvata localmente.')
        }} onSave={(acceptance) => {
          const existing = data.acceptances ?? []
          setData({ ...data, acceptances: existing.map((item) => item.id === acceptance.id ? acceptance : item) })
          setNotice('Pratica di accettazione aggiornata.')
        }} />}
      </div>
    </main>

    {modal?.type === 'customer' && <CustomerForm customer={modal.item} onClose={() => setModal(null)} onSave={(input) => { setData(modal.item ? { ...data, customers: updateCustomer(data.customers, modal.item.id, input) } : { ...data, customers: [createCustomer(input), ...data.customers] }); setModal(null) }} setError={setError} />}
    {modal?.type === 'vehicle' && <VehicleForm vehicle={modal.item} customers={data.customers} onClose={() => setModal(null)} onSave={(input) => {
      const next = modal.item ? updateVehicle(data, modal.item.id, input) : addVehicle(data, input)
      const impact = vehicleEconomicImpact(data.vehicles, next.vehicles, data.plannerSettings)
      setData(next)
      setNotice(`Fatturato aggiunto € ${impact.addedRevenue.toLocaleString('it-IT')} · margine aggiunto € ${impact.addedMargin.toLocaleString('it-IT')} · obiettivo ${impact.newReachedPercent}% · carico ${impact.sufficient ? 'sufficiente' : 'insufficiente'}.`)
      setModal(null)
    }} setError={setError} />}
    {selectedCostVehicle && <VehicleCostModal vehicle={selectedCostVehicle} data={data} onClose={() => setCostModal(null)} onSave={(entry) => {
      setData(addVehicleCostEntry(data, selectedCostVehicle.id, entry))
      setNotice(`Costo commessa registrato per ${selectedCostVehicle.plate}.`)
      setCostModal(null)
    }} />}
  </div>
}

function Dashboard({ data, setView, onNewVehicle, onNewCustomer }: { data: ErpData; setView: (view: View) => void; onNewVehicle: () => void; onNewCustomer: () => void }) {
  const normalizeStatus = (value: string) => value.trim().toLowerCase()
  const today = new Date().toISOString().slice(0, 10)
  const plusDays = (days: number) => {
    const date = new Date(`${today}T12:00:00`)
    date.setDate(date.getDate() + days)
    return date.toISOString().slice(0, 10)
  }

  const snapshot = calculateExecutiveDashboardSnapshot(data)
  const [overviewPeriod, setOverviewPeriod] = useState<BusinessOverviewPeriod>('mese')
  const overview = calculateBusinessOverviewSnapshot(data, overviewPeriod)
  const monthOverview = calculateBusinessOverviewSnapshot(data, 'mese')
  const rate = (value: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)

  const topKpis = [
    { id: 'monthly-revenue', label: 'Fatturato del mese', value: rate(snapshot.monthlyRevenue), note: 'Totale fatture emesse nel mese in corso.' },
    { id: 'monthly-margin', label: 'Margine del mese', value: rate(monthOverview.current.margin), note: 'Differenza reale tra fatturato e costi del mese.' },
    { id: 'liquidity-collections', label: 'Incassi previsti / Liquidità', value: `${rate(snapshot.projectedCollections.days30)} / ${rate(snapshot.availableLiquidity)}`, note: 'Incassi attesi a 30 giorni rispetto alla liquidità disponibile.' },
    { id: 'late-vehicles', label: 'Auto in ritardo', value: String(snapshot.vehiclesLate), note: 'Vetture oltre la data richiesta e non ancora consegnate.' },
  ]

  const economicChartMax = Math.max(
    1,
    overview.objective,
    ...overview.points.map((point) => Math.max(point.revenue, point.cost, point.margin)),
  )

  const productionStats = [
    { id: 'presenti', label: 'Auto presenti', value: snapshot.vehiclesPresent },
    { id: 'lavorazione', label: 'In lavorazione', value: snapshot.vehiclesInProgress },
    { id: 'pronte', label: 'Pronte', value: snapshot.vehiclesReady },
    { id: 'ritardo', label: 'In ritardo', value: snapshot.vehiclesLate },
    { id: 'consegne-oggi', label: 'Consegne oggi', value: snapshot.todaysDeliveries },
    { id: 'bloccate', label: 'Vetture bloccate', value: snapshot.blockedVehicles },
  ]
  const productionMax = Math.max(1, ...productionStats.map((item) => item.value))

  const openInvoices = data.invoices.filter((invoice) => !['Incassata', 'Stornata'].includes(invoice.status))
  const overdueCollections = openInvoices
    .filter((invoice) => invoice.dueDate < today)
    .reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0)
  const collectionsStats = [
    { id: '30', label: '30 giorni', value: snapshot.projectedCollections.days30 },
    { id: '60', label: '60 giorni', value: snapshot.projectedCollections.days60 },
    { id: '90', label: '90 giorni', value: snapshot.projectedCollections.days90 },
    { id: 'scaduto', label: 'Scaduto', value: overdueCollections },
  ]
  const collectionsMax = Math.max(1, ...collectionsStats.map((item) => item.value))

  const riskLimit = plusDays(2)
  const imminentLimit = plusDays(7)
  const deliveriesAtRisk = data.vehicles.filter((vehicle) =>
    normalizeStatus(vehicle.status) !== 'consegnata'
    && vehicle.requestedDeliveryDate
    && vehicle.requestedDeliveryDate >= today
    && vehicle.requestedDeliveryDate <= riskLimit
    && remainingHours(vehicle) > 0,
  ).length
  const invoicesToIssue = data.vehicles.filter((vehicle) =>
    normalizeStatus(vehicle.status) === 'consegnata'
    && !vehicle.invoiceId,
  ).length
  const imminentInvoices = openInvoices.filter((invoice) => invoice.dueDate >= today && invoice.dueDate <= imminentLimit).length
  const imminentRiba = data.ribaBatches.filter((batch) => !['Chiusa', 'Stornata'].includes(batch.status) && batch.dueDate >= today && batch.dueDate <= imminentLimit).length
  const attentionItems = [
    { id: 'late-vehicles', label: 'Auto in ritardo', count: snapshot.vehiclesLate, detail: 'Verifica priorità e capacità residua del planner.', action: () => setView('vehicles') },
    { id: 'risk-deliveries', label: 'Consegne a rischio', count: deliveriesAtRisk, detail: 'Consegne nei prossimi 2 giorni con ore residue > 0.', action: () => setView('planner') },
    { id: 'to-invoice', label: 'Fatture da emettere', count: invoicesToIssue, detail: 'Vetture consegnate senza fattura collegata.', action: () => setView('finance') },
    { id: 'riba-deadlines', label: 'RIBA / scadenze imminenti', count: imminentInvoices + imminentRiba, detail: 'Scadenze finanziarie nei prossimi 7 giorni.', action: () => setView('finance') },
    { id: 'blocked', label: 'Pratiche bloccate', count: snapshot.blockedVehicles, detail: 'Pratiche ferme per ricambi mancanti o blocchi operativi.', action: () => setView('vehicles') },
  ].filter((item) => item.count > 0)

  return <>
    <section className="welcome premium-welcome compact-welcome"><div><span className="eyebrow">DASHBOARD TITOLARE</span><h2>Visione sintetica e operativa</h2><p>Vista pulita basata solo su dati reali ERP: economico, produzione, incassi e criticità.</p></div><div className="quick-links"><button className="secondary" onClick={onNewCustomer}><Icon name="plus" /> Nuovo cliente</button><button className="secondary" onClick={onNewVehicle}><Icon name="plus" /> Nuova vettura</button><button className="secondary" onClick={() => setView('finance')}><Icon name="plus" /> Nuova fattura</button><button className="secondary" onClick={() => setView('planner')}><Icon name="planner" /> Planner</button></div></section>

    <section className="owner-kpi-grid">{topKpis.map((kpi) => <article className="owner-kpi-card" key={kpi.id}><span>{kpi.label}</span><strong>{kpi.value}</strong><small>{kpi.note}</small></article>)}</section>

    <section className="panel owner-economy-panel">
      <div className="panel-head"><div><span className="eyebrow">GRAFICO ECONOMICO PRINCIPALE</span><h3>Fatturato, costi, margine e obiettivo</h3></div><div className="segmented"><button className={overviewPeriod === 'oggi' ? 'active' : ''} onClick={() => setOverviewPeriod('oggi')}>Oggi</button><button className={overviewPeriod === 'settimana' ? 'active' : ''} onClick={() => setOverviewPeriod('settimana')}>Settimana</button><button className={overviewPeriod === 'mese' ? 'active' : ''} onClick={() => setOverviewPeriod('mese')}>Mese</button><button className={overviewPeriod === 'anno' ? 'active' : ''} onClick={() => setOverviewPeriod('anno')}>Anno</button></div></div>
      {!overview.hasData ? <div className="empty"><div>◌</div><p>Nessun dato economico disponibile per il periodo selezionato.</p></div> : <><div className="economy-summary-grid"><div className="summary-card"><span>Fatturato</span><strong>{rate(overview.current.revenue)}</strong></div><div className="summary-card"><span>Costi</span><strong>{rate(overview.current.cost)}</strong></div><div className="summary-card"><span>Margine</span><strong>{rate(overview.current.margin)}</strong></div><div className="summary-card"><span>Obiettivo</span><strong>{rate(overview.objective)}</strong></div></div><div className="economy-chart"><div className="economy-objective-row"><span>Obiettivo economico</span><strong>{rate(overview.objective)}</strong></div><div className="economy-bars">{overview.points.map((point) => <div className="economy-bar-col" key={point.label}><div className="economy-bar-track"><i className="objective" style={{ bottom: `${Math.min(100, (overview.objective / economicChartMax) * 100)}%` }} /><i className="revenue" style={{ height: `${Math.max(4, (point.revenue / economicChartMax) * 100)}%` }} /><i className="cost" style={{ height: `${Math.max(4, (point.cost / economicChartMax) * 100)}%` }} /><i className="margin" style={{ height: `${Math.max(4, (point.margin / economicChartMax) * 100)}%` }} /></div><small>{point.label}</small></div>)}</div><div className="economy-legend"><span><i className="revenue" /> Fatturato</span><span><i className="cost" /> Costi</span><span><i className="margin" /> Margine</span><span><i className="objective" /> Obiettivo</span></div></div></>}
    </section>

    <section className="owner-secondary-grid">
      <section className="panel owner-production-panel"><div className="panel-head"><div><span className="eyebrow">GRAFICO STATO PRODUZIONE</span><h3>Carico operativo corrente</h3></div></div><div className="metric-bars">{productionStats.map((item) => <div className="metric-bar-row" key={item.id}><span>{item.label}</span><div className="metric-bar-track"><i style={{ width: `${Math.max(6, (item.value / productionMax) * 100)}%` }} /></div><strong>{item.value}</strong></div>)}</div></section>
      <section className="panel owner-collections-panel"><div className="panel-head"><div><span className="eyebrow">GRAFICO INCASSI</span><h3>Scadenze e previsione</h3></div></div><div className="collections-chart">{collectionsStats.map((item) => <div className="collections-col" key={item.id}><div className="collections-track"><i style={{ height: `${Math.max(8, (item.value / collectionsMax) * 100)}%` }} /></div><strong>{rate(item.value)}</strong><small>{item.label}</small></div>)}</div></section>
    </section>

    <section className="panel owner-attention-panel">
      <div className="panel-head"><div><span className="eyebrow">RICHIEDE ATTENZIONE</span><h3>Solo elementi con intervento reale</h3></div></div>
      {attentionItems.length ? <div className="attention-list">{attentionItems.map((item) => <button className="attention-item" key={item.id} onClick={item.action}><div><strong>{item.label}</strong><small>{item.detail}</small></div><b>{item.count}</b></button>)}</div> : <div className="empty-small">Nessuna criticità attiva al momento.</div>}
    </section>
  </>
}

function Customers({ customers, data, onAdd, onEdit, onDelete }: { customers: Customer[]; data: ErpData; onAdd: () => void; onEdit: (customer: Customer) => void; onDelete: (id: string) => void }) {
  return <div className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">ANAGRAFICA</span><h3>{customers.length} clienti</h3></div><button className="primary" onClick={onAdd}><Icon name="plus" /> Nuovo cliente</button></div>
    <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Tipo</th><th>Contatti</th><th>Codice fiscale / P.IVA</th><th>Veicoli</th><th>Azioni</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id}><td><strong>{customer.name}</strong><small>{customer.address || 'Indirizzo non indicato'}</small></td><td><span className="tag">{customer.type}</span></td><td>{customer.phone}<small>{customer.email || 'Email non indicata'}</small></td><td>{customer.taxId || '—'}</td><td><b className="count">{data.vehicles.filter((vehicle) => vehicle.customerId === customer.id).length}</b></td><td><div className="row-actions"><button onClick={() => onEdit(customer)}>Modifica</button><button className="danger" onClick={() => { if (window.confirm(`Eliminare il cliente ${customer.name}?`)) onDelete(customer.id) }}>Elimina</button></div></td></tr>)}</tbody></table></div>{!customers.length && <Empty text="Nessun cliente trovato. Crea la prima anagrafica." />}</div>
}

function Vehicles({ vehicles, customers, onAdd, onEdit, onDelete, onOpenCosts, updateStatus, customerById }: { vehicles: Vehicle[]; customers: Customer[]; onAdd: () => void; onEdit: (vehicle: Vehicle) => void; onDelete: (id: string) => void; onOpenCosts: (id: string) => void; updateStatus: (id: string, status: VehicleStatus) => void; customerById: (id: string) => Customer | undefined }) {
  return <div className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">PARCO VEICOLI</span><h3>{vehicles.length} vetture</h3></div><button className="primary" onClick={onAdd} disabled={!customers.length} title={!customers.length ? 'Crea prima un cliente' : ''}><Icon name="plus" /> Nuova vettura</button></div>
    <div className="table-wrap"><table><thead><tr><th>Vettura</th><th>Cliente</th><th>Stato operativo</th><th>Cono</th><th>Dati</th><th>Azioni</th></tr></thead><tbody>{vehicles.map((vehicle) => <tr key={vehicle.id}><td><strong className="plate">{vehicle.plate}</strong><small>{vehicle.make} {vehicle.model} · {vehicle.color || 'Colore n/d'}</small></td><td>{customerById(vehicle.customerId)?.name}</td><td><select className={`status status-${vehicle.status.toLowerCase().replaceAll(' ', '-')}`} value={vehicle.status} onChange={(event) => updateStatus(vehicle.id, event.target.value as VehicleStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></td><td>{vehicle.coneNumber ? <b className="cone-badge">{vehicle.coneNumber}</b> : '—'}</td><td>{vehicle.year || 'Anno n/d'}<small>{vehicle.mileage ? `${vehicle.mileage} km` : 'Km n/d'}</small></td><td><div className="row-actions"><button onClick={() => onEdit(vehicle)}>Modifica</button><button onClick={() => onOpenCosts(vehicle.id)}>Costi</button><button className="danger" onClick={() => onDelete(vehicle.id)}>Elimina</button></div></td></tr>)}</tbody></table></div>{!vehicles.length && <Empty text={customers.length ? 'Nessuna vettura trovata. Registrane una nuova.' : 'Crea prima un cliente, poi potrai registrare la sua vettura.'} />}</div>
}

function VehicleCostModal({ vehicle, data, onClose, onSave }: { vehicle: Vehicle; data: ErpData; onClose: () => void; onSave: (entry: Omit<NonNullable<Vehicle['costEntries']>[number], 'id' | 'createdAt' | 'updatedAt'>) => void }) {
  const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
  const snapshot = calculateVehicleEconomicSnapshot(vehicle, data.financeSettings)
  const [form, setForm] = useState({
    usedAt: new Date().toISOString().slice(0, 10),
    category: 'ricambi' as VehicleCostCategory,
    description: '',
    supplier: '',
    quantity: '1',
    unit: 'pz',
    unitCost: '0',
    discount: '0',
    vatRate: String(data.financeSettings.defaultVatRate ?? 22),
    note: '',
  })
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }))
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const quantity = Math.max(0, Number(form.quantity) || 0)
    const unitCost = Math.max(0, Number(form.unitCost) || 0)
    const discount = Math.max(0, Number(form.discount) || 0)
    const description = form.description.trim()
    if (!description) return
    onSave({
      usedAt: form.usedAt,
      category: form.category as VehicleCostCategory,
      description,
      supplier: form.supplier.trim(),
      quantity,
      unit: form.unit.trim() || 'pz',
      unitCost,
      discount,
      total: Math.round((quantity * unitCost - discount + Number.EPSILON) * 100) / 100,
      vatRate: Number(form.vatRate) || data.financeSettings.defaultVatRate,
      note: form.note.trim(),
    })
  }
  return <Modal title={`Materiali e costi · ${vehicle.plate}`} onClose={onClose}><div className="cost-modal"><div className="summary-grid"><div className="summary-card"><span>Ricavo previsto</span><strong>{money(snapshot.taxableRevenue)}</strong></div><div className="summary-card"><span>Costi diretti</span><strong>{money(snapshot.totalDirectCosts)}</strong></div><div className="summary-card"><span>Margine reale</span><strong>{money(snapshot.realMargin)}</strong></div><div className="summary-card"><span>Margine %</span><strong>{snapshot.grossMarginPercent}%</strong></div></div><form className="cost-form" onSubmit={submit}><label>Data<input type="date" value={form.usedAt} onChange={(event) => update('usedAt', event.target.value)} /></label><label>Categoria<select value={form.category} onChange={(event) => update('category', event.target.value)}><option value="ricambi">Ricambi</option><option value="vernice">Vernice</option><option value="trasparente">Trasparente</option><option value="fondo">Fondo</option><option value="stucco">Stucco</option><option value="carta abrasiva">Carta abrasiva</option><option value="nastro e materiale da mascheratura">Nastro e materiale da mascheratura</option><option value="minuteria">Minuteria</option><option value="materiali di lucidatura">Materiali di lucidatura</option><option value="lavorazioni esterne">Lavorazioni esterne</option><option value="lavaggio">Lavaggio</option><option value="trasporto">Trasporto</option><option value="smaltimento">Smaltimento</option><option value="altro">Altro</option></select></label><label>Descrizione<input required value={form.description} onChange={(event) => update('description', event.target.value)} /></label><label>Fornitore<input value={form.supplier} onChange={(event) => update('supplier', event.target.value)} /></label><label>Quantità<input type="number" min="0" step="0.01" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} /></label><label>Unità<input value={form.unit} onChange={(event) => update('unit', event.target.value)} /></label><label>Prezzo unitario<input type="number" min="0" step="0.01" value={form.unitCost} onChange={(event) => update('unitCost', event.target.value)} /></label><label>Sconto<input type="number" min="0" step="0.01" value={form.discount} onChange={(event) => update('discount', event.target.value)} /></label><label>IVA %<input type="number" min="0" step="1" value={form.vatRate} onChange={(event) => update('vatRate', event.target.value)} /></label><label>Nota<textarea value={form.note} onChange={(event) => update('note', event.target.value)} /></label><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Chiudi</button><button className="primary">Salva costo</button></div></form>{vehicle.costEntries?.length ? <div className="entry-list"><h4>Costi già registrati</h4>{vehicle.costEntries.slice().reverse().map((entry) => <div className="entry-item" key={entry.id}><strong>{entry.description}</strong><span>{entry.category} · {entry.quantity} {entry.unit} · {money(entry.total)}</span></div>)}</div> : <div className="empty"><div>◌</div><p>Nessun costo registrato per questa commessa.</p></div>}</div></Modal>
}

function Cones({ data, customerById, onMove }: { data: ErpData; customerById: (id: string) => Customer | undefined; onMove: (id: string, cone: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [filter, setFilter] = useState<'Tutti' | 'Liberi' | 'Occupati'>('Tutti')
  const occupied = data.vehicles.filter((vehicle) => vehicle.coneNumber !== null)
  const cones = useMemo(() => Array.from({ length: TOTAL_CONES }, (_, i) => i + 1).filter((number) => filter === 'Tutti' || (filter === 'Occupati') === occupied.some((vehicle) => vehicle.coneNumber === number)), [filter, occupied])
  const vehicle = occupied.find((item) => item.coneNumber === selected)
  return <>
    <section className="cone-summary"><div><span>Coni occupati</span><strong>{occupied.length}</strong></div><div><span>Coni liberi</span><strong>{TOTAL_CONES - occupied.length}</strong></div><div className="occupancy"><span>Occupazione piazzale</span><strong>{Math.round(occupied.length / TOTAL_CONES * 100)}%</strong><i><b style={{ width: `${occupied.length / TOTAL_CONES * 100}%` }} /></i></div></section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">MAPPA PIAZZALE</span><h3>Coni da 1 a 30</h3></div><div className="segmented">{(['Tutti', 'Liberi', 'Occupati'] as const).map((item) => <button className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div></div>
      <div className="cone-grid">{cones.map((number) => { const assigned = occupied.find((item) => item.coneNumber === number); return <button onClick={() => setSelected(number)} className={`cone-card ${assigned ? 'busy' : ''}`} key={number}><span>CONO</span><strong>{number}</strong>{assigned ? <><b className="plate">{assigned.plate}</b><small>{assigned.make} {assigned.model}</small></> : <b className="available">LIBERO</b>}</button> })}</div>
    </section>
    <section className="panel history"><div className="panel-head"><div><span className="eyebrow">REGISTRO NON MODIFICABILE</span><h3>Storico assegnazioni</h3></div></div><div className="table-wrap"><table><thead><tr><th>Data e ora</th><th>Evento</th><th>Cono</th><th>Vettura</th><th>Nota</th></tr></thead><tbody>{data.coneHistory.map((item) => { const itemVehicle = data.vehicles.find((entry) => entry.id === item.vehicleId); return <tr key={item.id}><td>{formatDate(item.timestamp)}</td><td><span className="tag">{item.action}</span></td><td><b className="cone-badge">{item.coneNumber}</b></td><td><strong className="plate">{item.vehiclePlate}</strong><small>{itemVehicle ? customerById(itemVehicle.customerId)?.name : 'Vettura rimossa'}</small></td><td>{item.note}</td></tr> })}</tbody></table></div>{!data.coneHistory.length && <Empty text="Nessuna assegnazione registrata." />}</section>
    {selected !== null && <Modal title={`Cono ${selected}`} onClose={() => setSelected(null)}>{vehicle ? <div className="cone-detail"><div className="detail-plate">{vehicle.plate}</div><dl><div><dt>Vettura</dt><dd>{vehicle.make} {vehicle.model}</dd></div><div><dt>Cliente</dt><dd>{customerById(vehicle.customerId)?.name}</dd></div><div><dt>Stato</dt><dd>{vehicle.status}</dd></div></dl><label>Sposta manualmente su un cono libero<select defaultValue="" onChange={(event) => { onMove(vehicle.id, Number(event.target.value)); setSelected(null) }}><option value="" disabled>Seleziona nuovo cono</option>{Array.from({ length: TOTAL_CONES }, (_, i) => i + 1).filter((cone) => !occupied.some((entry) => entry.coneNumber === cone)).map((cone) => <option value={cone} key={cone}>Cono {cone}</option>)}</select></label></div> : <div className="empty modal-empty"><b>Cono libero</b><p>Verrà assegnato automaticamente quando sarà il primo disponibile.</p></div>}</Modal>}
  </>
}

function CustomerForm({ customer, onClose, onSave, setError }: { customer?: Customer; onClose: () => void; onSave: (customer: Omit<Customer, 'id' | 'createdAt'>) => void; setError: (error: string) => void }) {
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { onSave({ type: form.get('type') as CustomerType, name: String(form.get('name')), phone: String(form.get('phone')), email: String(form.get('email')), taxId: String(form.get('taxId')), address: String(form.get('address')) }); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Dati non validi.') } }
  return <Modal title={customer ? 'Modifica cliente' : 'Nuovo cliente'} onClose={onClose}><form onSubmit={submit} className="form-grid"><label>Tipo cliente<select name="type" defaultValue={customer?.type ?? 'Privato'}><option>Privato</option><option>Azienda</option></select></label><label>Nome / ragione sociale<input name="name" required autoFocus defaultValue={customer?.name} /></label><label>Telefono<input name="phone" required inputMode="tel" defaultValue={customer?.phone} /></label><label>Email<input name="email" type="email" defaultValue={customer?.email} /></label><label>Codice fiscale / P.IVA<input name="taxId" defaultValue={customer?.taxId} /></label><label>Indirizzo<input name="address" defaultValue={customer?.address} /></label><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Annulla</button><button className="primary">Salva cliente</button></div></form></Modal>
}

function VehicleForm({ vehicle, customers, onClose, onSave, setError }: { vehicle?: Vehicle; customers: Customer[]; onClose: () => void; onSave: (vehicle: Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'>) => void; setError: (error: string) => void }) {
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try {
    const estimatedHours = Number(form.get('estimatedHours'))
    const workedHours = Number(form.get('workedHours'))
    const expectedRevenue = Number(form.get('expectedRevenue'))
    const expectedMargin = Number(form.get('expectedMargin'))
    if ([estimatedHours, workedHours, expectedRevenue, expectedMargin].some((value) => value < 0)) throw new Error('Ore e importi non possono essere negativi.')
    if (workedHours > estimatedHours) throw new Error('Le ore lavorate non possono superare quelle preventivate.')
    onSave({ customerId: String(form.get('customerId')), plate: String(form.get('plate')), make: String(form.get('make')), model: String(form.get('model')), color: String(form.get('color')), year: String(form.get('year')), vin: String(form.get('vin')), mileage: String(form.get('mileage')), status: vehicle?.status ?? form.get('status') as VehicleStatus, priority: form.get('priority') as 'Normale' | 'Alta' | 'Urgente', deliveryDate: String(form.get('requestedDeliveryDate')), estimatedHours, workedHours, plannedEntryDate: String(form.get('plannedEntryDate')), requestedDeliveryDate: String(form.get('requestedDeliveryDate')), calculatedDeliveryDate: vehicle?.calculatedDeliveryDate ?? '', expectedRevenue, expectedMargin, partsStatus: form.get('partsStatus') as Vehicle['partsStatus'], blockReason: String(form.get('blockReason')), manualPlanningDate: vehicle?.manualPlanningDate ?? '' }); setError('')
  } catch (problem) { setError(problem instanceof Error ? problem.message : 'Dati non validi.') } }
  return <Modal title={vehicle ? 'Modifica vettura' : 'Nuova vettura'} onClose={onClose}><form onSubmit={submit} className="form-grid"><label>Cliente<select name="customerId" required defaultValue={vehicle?.customerId ?? ''}><option value="">Seleziona cliente</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label><label>Targa<input name="plate" required autoFocus className="uppercase" placeholder="AB123CD" defaultValue={vehicle?.plate} /></label><label>Marca<input name="make" required defaultValue={vehicle?.make} /></label><label>Modello<input name="model" required defaultValue={vehicle?.model} /></label><label>Colore<input name="color" defaultValue={vehicle?.color} /></label><label>Anno<input name="year" inputMode="numeric" defaultValue={vehicle?.year} /></label><label>VIN<input name="vin" defaultValue={vehicle?.vin} /></label><label>Chilometraggio<input name="mileage" inputMode="numeric" defaultValue={vehicle?.mileage} /></label>{!vehicle && <label>Stato iniziale<select name="status">{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>}<label>Priorità<select name="priority" defaultValue={vehicle?.priority ?? 'Normale'}><option>Normale</option><option>Alta</option><option>Urgente</option></select></label>
    <div className="form-section-title">Pianificazione produttiva</div><label>Ore totali preventivate<input name="estimatedHours" type="number" min="0" step="0.25" required defaultValue={vehicle?.estimatedHours ?? 0} /></label><label>Ore già lavorate<input name="workedHours" type="number" min="0" step="0.25" required defaultValue={vehicle?.workedHours ?? 0} /></label><label>Ore rimanenti<input readOnly value={Math.max(0, (vehicle?.estimatedHours ?? 0) - (vehicle?.workedHours ?? 0))} title="Calcolate automaticamente al salvataggio" /></label><label>Ingresso previsto<input name="plannedEntryDate" type="date" defaultValue={vehicle?.plannedEntryDate} /></label><label>Data richiesta dal cliente<input name="requestedDeliveryDate" type="date" defaultValue={vehicle?.requestedDeliveryDate || vehicle?.deliveryDate} /></label><label>Consegna calcolata<input readOnly value={vehicle?.calculatedDeliveryDate || 'Ricalcolata nel Planner'} /></label>
    <div className="form-section-title">Valore e disponibilità</div><label>Ricavo previsto (€)<input name="expectedRevenue" type="number" min="0" step="0.01" defaultValue={vehicle?.expectedRevenue ?? 0} /></label><label>Margine previsto (€)<input name="expectedMargin" type="number" min="0" step="0.01" defaultValue={vehicle?.expectedMargin ?? 0} /></label><label>Stato ricambi<select name="partsStatus" defaultValue={vehicle?.partsStatus ?? 'Disponibili'}><option>Disponibili</option><option>Ordinati</option><option>Mancanti</option></select></label><label>Motivo di blocco<input name="blockReason" defaultValue={vehicle?.blockReason} /></label><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Annulla</button><button className="primary">Salva vettura</button></div></form></Modal>
}

function AcceptancePage({ data, customerById, onCreate, onSave }: { data: ErpData; customerById: (id: string) => Customer | undefined; onCreate: (customerId: string, vehicleId: string) => void; onSave: (acceptance: AcceptanceCase) => void }) {
  const acceptances = useMemo(() => data.acceptances ?? [], [data.acceptances])
  const [selectedId, setSelectedId] = useState<string>('')
  const selected = acceptances.find((item) => item.id === selectedId) ?? acceptances[0]

  useEffect(() => {
    if (!selectedId && acceptances[0]) setSelectedId(acceptances[0].id)
  }, [acceptances, selectedId])

  const createFromFirst = () => {
    if (!data.customers.length || !data.vehicles.length) return
    onCreate(data.customers[0].id, data.vehicles[0].id)
    setSelectedId(acceptances[0]?.id ?? '')
  }

  return <section className="panel"><div className="panel-head"><div><span className="eyebrow">ACCETTAZIONE</span><h3>{acceptances.length} pratiche salvate</h3></div><button className="primary" onClick={createFromFirst}>Nuova pratica</button></div>
    <div className="acceptance-layout">
      <div className="selection-stack">{acceptances.map((acceptance) => {
        const customer = customerById(acceptance.customerId)
        const vehicle = data.vehicles.find((item) => item.id === acceptance.vehicleId)
        return <button className={selected?.id === acceptance.id ? 'active acceptance-card' : 'acceptance-card'} key={acceptance.id} onClick={() => setSelectedId(acceptance.id)}>
          <strong>{customer?.name ?? 'Cliente non trovato'}</strong>
          <small>{vehicle?.plate ?? 'Vettura non trovata'}</small>
          <span>{acceptance.status}</span>
        </button>
      })}{!acceptances.length && <Empty text="Nessuna pratica di accettazione ancora salvata." />}</div>
      {selected && <AcceptanceEditor acceptance={selected} data={data} customerById={customerById} onSave={onSave} />}
    </div>
  </section>
}

function AcceptanceEditor({ acceptance, data, customerById, onSave }: { acceptance: AcceptanceCase; data: ErpData; customerById: (id: string) => Customer | undefined; onSave: (acceptance: AcceptanceCase) => void }) {
  const quote = acceptance.quote
  const summary = buildAcceptanceQuoteSummary(quote)
  const customer = customerById(acceptance.customerId)
  const vehicle = data.vehicles.find((item) => item.id === acceptance.vehicleId)
  const intake = acceptance.intake ?? {
    mileage: '',
    fuelLevel: '',
    occurredAt: new Date().toISOString(),
    operator: '',
    damageDescription: '',
    accessories: [],
    customerNotes: '',
    checklist: [],
    signatureDataUrl: '',
  }
  const [manualLaborHours, setManualLaborHours] = useState(8)
  const [accessoryInput, setAccessoryInput] = useState('')
  const [archiveCaption, setArchiveCaption] = useState('')
  const [archiveCategory, setArchiveCategory] = useState<'ingresso' | 'danni' | 'lavorazione' | 'fine lavori' | 'consegna'>('danni')
  const documentFields = Object.entries(acceptance.customerDraft[0]?.fields ?? {}) as Array<[string, { value: string; confidence: string; source: 'ocr' | 'manual' }]>
  const bookletFields = Object.entries(acceptance.vehicleBooklet[0]?.fields ?? {}) as Array<[string, { value: string; confidence: string; source: 'ocr' | 'manual' }]>

  const updateLine = (lineId: string, field: keyof AcceptanceLine, value: string | number) => {
    const nextLines = quote.lines.map((line) => line.id === lineId ? { ...line, [field]: value } : line)
    onSave({ ...acceptance, quote: { ...quote, lines: nextLines }, updatedAt: new Date().toISOString() })
  }

  const updateIntake = (field: 'mileage' | 'fuelLevel' | 'occurredAt' | 'operator' | 'damageDescription' | 'accessories' | 'customerNotes' | 'signatureDataUrl', value: string | string[]) => {
    onSave({ ...acceptance, intake: { ...intake, [field]: value }, updatedAt: new Date().toISOString() })
  }

  const updateDocumentField = (field: string, value: string) => {
    const draft = acceptance.customerDraft[0]
    if (!draft) return
    const nextDraft = {
      ...draft,
      fields: {
        ...draft.fields,
        [field]: {
          ...draft.fields[field as keyof typeof draft.fields],
          value,
          source: 'manual',
        },
      },
    }
    onSave({ ...acceptance, customerDraft: [nextDraft], updatedAt: new Date().toISOString() })
  }

  const updateBookletField = (field: string, value: string) => {
    const draft = acceptance.vehicleBooklet[0]
    if (!draft) return
    const nextDraft = {
      ...draft,
      fields: {
        ...draft.fields,
        [field]: {
          ...draft.fields[field as keyof typeof draft.fields],
          value,
          source: 'manual',
        },
      },
    }
    onSave({ ...acceptance, vehicleBooklet: [nextDraft], updatedAt: new Date().toISOString() })
  }

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>, target: 'document' | 'booklet' | 'damage') => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      if (target === 'document') {
        onSave({
          ...acceptance,
          customerDraft: [{ ...acceptance.customerDraft[0], dataUrl, name: file.name }],
          updatedAt: new Date().toISOString(),
        })
      }
      if (target === 'booklet') {
        onSave({
          ...acceptance,
          vehicleBooklet: [{ ...acceptance.vehicleBooklet[0], dataUrl, name: file.name }],
          updatedAt: new Date().toISOString(),
        })
      }
      if (target === 'damage') {
        const photo = createPhotoArchiveEntry(acceptance.id, acceptance.vehicleId, 'danni', file.name, dataUrl, 'Foto danni')
        onSave(appendAcceptancePhotoEntry(acceptance, photo))
      }
    }
    reader.readAsDataURL(file)
  }

  const handleArchivePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const photo = createPhotoArchiveEntry(acceptance.id, acceptance.vehicleId, archiveCategory, file.name, dataUrl, archiveCaption || 'Foto archivio')
      onSave(appendAcceptancePhotoEntry(acceptance, photo))
      setArchiveCaption('')
      event.target.value = ''
    }
    reader.readAsDataURL(file)
  }

  const persistQuote = () => {
    const laborHours = Math.max(0, Number(manualLaborHours) || 0)
    const defaultQuote = createAcceptanceDraft(acceptance.customerId, acceptance.vehicleId, data.plannerSettings, acceptance.quote.monthKey)
    const baseQuote = { ...defaultQuote.quote, ...quote, hourlyRate: quote.hourlyRate, productiveHours: quote.productiveHours, lines: quote.lines }
    const modified = { ...acceptance, quote: { ...baseQuote, lines: baseQuote.lines.map((line) => line.kind === 'labor' ? { ...line, quantity: laborHours } : line) }, updatedAt: new Date().toISOString() }
    modified.quote = updateConsumptionLine(modified.quote, 0.2)
    onSave(modified)
  }

  const downloadPdf = () => {
    const pdfText = exportAcceptancePdf(acceptance)
    const blob = new Blob([pdfText], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `accettazione-${acceptance.id}.pdf`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const captureSignature = () => {
    const text = intake.operator || customer?.name || 'Cliente'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="220"><rect width="100%" height="100%" fill="#fff"/><line x1="40" y1="160" x2="560" y2="160" stroke="#111" stroke-width="3"/><text x="40" y="120" font-family="Arial" font-size="34">${text}</text></svg>`
    const dataUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
    updateIntake('signatureDataUrl', dataUrl)
  }

  const toggleChecklistItem = (itemId: string) => {
    onSave(toggleAcceptanceChecklistItem(acceptance, itemId))
  }

  const addAccessory = () => {
    const trimmed = accessoryInput.trim()
    if (!trimmed) return
    updateIntake('accessories', [...(intake.accessories ?? []), trimmed])
    setAccessoryInput('')
  }

  const removeAccessory = (accessory: string) => {
    updateIntake('accessories', (intake.accessories ?? []).filter((item) => item !== accessory))
  }

  const removePhotoEntry = (photoId: string) => {
    const nextPhotos = (acceptance.photos ?? []).filter((photo) => photo.id !== photoId)
    onSave({ ...acceptance, photos: nextPhotos, damagePhotos: [...new Set((acceptance.damagePhotos ?? []).filter((dataUrl) => !nextPhotos.some((photo) => photo.dataUrl === dataUrl)))], updatedAt: new Date().toISOString() })
  }

  return <div className="acceptance-editor"><div className="panel"><div className="panel-head"><div><span className="eyebrow">CONTENUTO PRATICA</span><h3>{customer?.name ?? 'Cliente'} · {vehicle?.plate ?? 'Vettura'}</h3></div><button className="secondary" onClick={downloadPdf}>Genera PDF</button></div>
    <div className="form-grid">
      <label>Documento identità<input type="file" accept="image/*" onChange={(event) => handleFile(event, 'document')} /></label>
      <label>Libretto<input type="file" accept="image/*" onChange={(event) => handleFile(event, 'booklet')} /></label>
      <label>Danni foto<input type="file" accept="image/*" onChange={(event) => handleFile(event, 'damage')} /></label>
      <label>Ore manodopera<input type="number" min="0" step="0.25" value={manualLaborHours} onChange={(event) => setManualLaborHours(Number(event.target.value))} /></label>
      <button className="primary" onClick={persistQuote}>Aggiorna preventivo</button>
    </div>
    <div className="intake-grid">
      <label>Chilometraggio<input value={intake.mileage} onChange={(event) => updateIntake('mileage', event.target.value)} /></label>
      <label>Livello carburante<input value={intake.fuelLevel} onChange={(event) => updateIntake('fuelLevel', event.target.value)} /></label>
      <label>Data e ora ingresso<input type="datetime-local" value={intake.occurredAt ? new Date(intake.occurredAt).toISOString().slice(0, 16) : ''} onChange={(event) => updateIntake('occurredAt', new Date(event.target.value).toISOString())} /></label>
      <label>Operatore<input value={intake.operator} onChange={(event) => updateIntake('operator', event.target.value)} /></label>
      <label className="full">Descrizione danni<textarea rows={3} value={intake.damageDescription} onChange={(event) => updateIntake('damageDescription', event.target.value)} /></label>
      <label className="full">Accessori<div className="accessory-row"><input value={accessoryInput} onChange={(event) => setAccessoryInput(event.target.value)} placeholder="Aggiungi accessorio" /><button type="button" className="secondary" onClick={addAccessory}>Aggiungi</button></div>{(intake.accessories ?? []).length ? <div className="accessory-list">{(intake.accessories ?? []).map((accessory) => <span key={accessory}>{accessory}<button type="button" onClick={() => removeAccessory(accessory)}>×</button></span>)}</div> : <small>Nessun accessorio registrato.</small>}</label>
      <label className="full">Note cliente<textarea rows={3} value={intake.customerNotes} onChange={(event) => updateIntake('customerNotes', event.target.value)} /></label>
      <div className="preview-card checklist-card"><h4>Checklist accettazione</h4><div className="checklist-list">{(intake.checklist ?? []).map((item) => <label key={item.id}><input type="checkbox" checked={item.checked} onChange={() => toggleChecklistItem(item.id)} />{item.label}</label>)}</div></div>
      <div className="preview-card signature-card"><h4>Firma digitale</h4><button type="button" className="secondary" onClick={captureSignature}>Crea firma demo</button>{intake.signatureDataUrl ? <img src={intake.signatureDataUrl} alt="Firma digitale" /> : <p>Nessuna firma salvata.</p>}</div>
    </div>
    <div className="preview-grid">
      <div className="preview-card"><h4>Documento ID</h4>{acceptance.customerDraft[0]?.dataUrl ? <img src={acceptance.customerDraft[0].dataUrl} alt="Documento ID" /> : <p>Carica documento fronte/retro per il flusso OCR.</p>}</div>
      <div className="preview-card"><h4>Libretto</h4>{acceptance.vehicleBooklet[0]?.dataUrl ? <img src={acceptance.vehicleBooklet[0].dataUrl} alt="Libretto" /> : <p>Carica il libretto per l’inserimento dati veicolo.</p>}</div>
      <div className="preview-card"><h4>Danni</h4>{acceptance.damagePhotos.length ? acceptance.damagePhotos.map((photo, index) => <img src={photo} alt={`Danno ${index + 1}`} key={`${photo}-${index}`} />) : <p>Nessuna foto danno allegata.</p>}</div>
    </div>
    <div className="preview-grid">
      <div className="preview-card archive-card">
        <h4>Archivio fotografico</h4>
        <div className="archive-form">
          <label>Categoria<select value={archiveCategory} onChange={(event) => setArchiveCategory(event.target.value as 'ingresso' | 'danni' | 'lavorazione' | 'fine lavori' | 'consegna')}><option value="ingresso">Ingresso</option><option value="danni">Danni</option><option value="lavorazione">Lavorazione</option><option value="fine lavori">Fine lavori</option><option value="consegna">Consegna</option></select></label>
          <label>Didascalia<input value={archiveCaption} onChange={(event) => setArchiveCaption(event.target.value)} placeholder="Inserisci didascalia" /></label>
          <label>Carica foto<input type="file" accept="image/*" onChange={handleArchivePhoto} /></label>
        </div>
        <div className="photo-list">{(acceptance.photos ?? []).map((photo) => <div className="photo-item" key={photo.id}><img src={photo.dataUrl} alt={photo.name} /><div><strong>{photo.name}</strong><small>{photo.category} · {photo.caption || 'Nessuna didascalia'}</small></div><button type="button" className="danger" onClick={() => removePhotoEntry(photo.id)}>Elimina</button></div>)}</div>
        {!acceptance.photos?.length && <p>Nessuna foto nell’archivio.</p>}
      </div>
      <div className="preview-card"><h4>Conferma dati documento</h4><div className="ocr-field-grid">{documentFields.map(([field, draft]) => <label key={field}><span>{field}</span><input value={draft.value} onChange={(event) => updateDocumentField(field, event.target.value)} /><small>{draft.confidence} · {draft.source}</small></label>)}</div></div>
      <div className="preview-card"><h4>Conferma dati libretto</h4><div className="ocr-field-grid">{bookletFields.map(([field, draft]) => <label key={field}><span>{field}</span><input value={draft.value} onChange={(event) => updateBookletField(field, event.target.value)} /><small>{draft.confidence} · {draft.source}</small></label>)}</div></div>
    </div>
    <div className="ocr-review-grid">
      <div className="preview-card">
        <h4>Conferma dati documento</h4>
        <div className="ocr-field-grid">{documentFields.map(([field, draft]) => <label key={field}><span>{field}</span><input value={draft.value} onChange={(event) => updateDocumentField(field, event.target.value)} /><small>{draft.confidence} · {draft.source}</small></label>)}</div>
      </div>
      <div className="preview-card">
        <h4>Conferma dati libretto</h4>
        <div className="ocr-field-grid">{bookletFields.map(([field, draft]) => <label key={field}><span>{field}</span><input value={draft.value} onChange={(event) => updateBookletField(field, event.target.value)} /><small>{draft.confidence} · {draft.source}</small></label>)}</div>
      </div>
    </div>
    <div className="quote-grid">
      {quote.lines.map((line) => <div className="quote-row" key={line.id}><input value={line.description} onChange={(event) => updateLine(line.id, 'description', event.target.value)} /><input type="number" value={line.quantity} onChange={(event) => updateLine(line.id, 'quantity', Number(event.target.value))} /><input type="number" value={line.unitPrice} onChange={(event) => updateLine(line.id, 'unitPrice', Number(event.target.value))} /></div>)}
    </div>
    <div className="quote-summary">
      <div><span>Ore preventivate</span><strong>{summary.labor.lines}</strong></div>
      <div><span>Tariffa oraria</span><strong>€ {quote.hourlyRate.toFixed(2)}</strong></div>
      <div><span>Imponibile</span><strong>€ {summary.taxableAmount.toFixed(2)}</strong></div>
      <div><span>IVA</span><strong>€ {summary.vatAmount.toFixed(2)}</strong></div>
      <div><span>Totale</span><strong>€ {summary.total.toFixed(2)}</strong></div>
      <div><span>Costi vivi</span><strong>€ {summary.costLive.toFixed(2)}</strong></div>
      <div><span>Margine previsto</span><strong>€ {summary.marginEuro.toFixed(2)}</strong></div>
      <div><span>Margine %</span><strong>{summary.marginPercent}%</strong></div>
    </div>
  </div></div>
}

function Empty({ text }: { text: string }) { return <div className="empty"><div>◇</div><p>{text}</p></div> }
export default App
