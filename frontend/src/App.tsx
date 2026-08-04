import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { Icon } from './components/Icon'
import { Modal } from './components/Modal'
import { addVehicle, createCustomer, deleteCustomer, deleteVehicle, moveVehicleCone, changeVehicleStatus, TOTAL_CONES, emptyData, updateCustomer, updateVehicle } from './services/erp'
import { loadDatabase, saveDatabase } from './services/database'
import { EconomicGoalPanel } from './features/dashboard/EconomicGoalPanel'
import { PlannerPage } from './features/planner/PlannerPage'
import { PlannerSettingsPage } from './features/planner/PlannerSettingsPage'
import { calculateDayCapacity, calculatePlanner, remainingHours } from './services/planner'
import { calculateEconomicSummary, vehicleEconomicImpact } from './services/economic'
import { buildAcceptanceQuoteSummary, createAcceptanceDraft, exportAcceptancePdf, updateConsumptionLine } from './services/acceptance'
import type { AcceptanceCase, AcceptanceLine, Customer, CustomerType, ErpData, Vehicle, VehicleStatus, View } from './types'

const nav: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' }, { id: 'customers', label: 'Clienti' },
  { id: 'vehicles', label: 'Veicoli' }, { id: 'cones', label: 'Gestione coni' },
  { id: 'planner', label: 'Planner intelligente' }, { id: 'planner-settings', label: 'Impostazioni Planner' },
  { id: 'acceptance', label: 'Accettazione' },
]
const statuses: VehicleStatus[] = ['Accettata', 'Confermata', 'In lavorazione', 'Pronta', 'Consegnata']
const formatDate = (value: string) => new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

function App() {
  const [data, setData] = useState<ErpData>(emptyData)
  const [databaseReady, setDatabaseReady] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<{ type: 'customer'; item?: Customer } | { type: 'vehicle'; item?: Vehicle } | null>(null)
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
        {view === 'dashboard' && <Dashboard data={data} setView={setView} customerById={customerById} onNewVehicle={() => {
          if (data.customers.length) setModal({ type: 'vehicle' })
          else {
            setView('customers')
            setModal({ type: 'customer' })
          }
        }} />}
        {view === 'customers' && <Customers customers={filteredCustomers} data={data} onAdd={() => setModal({ type: 'customer' })} onEdit={(item) => setModal({ type: 'customer', item })} onDelete={(id) => { try { setData(deleteCustomer(data, id)); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } }} />}
        {view === 'vehicles' && <Vehicles vehicles={filteredVehicles} customers={data.customers} onAdd={() => setModal({ type: 'vehicle' })} onEdit={(item) => setModal({ type: 'vehicle', item })} onDelete={(id) => { if (window.confirm('Eliminare definitivamente questa vettura?')) { try { setData(deleteVehicle(data, id)); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } } }} updateStatus={updateStatus} customerById={customerById} />}
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
  </div>
}

function Dashboard({ data, setView, customerById, onNewVehicle }: { data: ErpData; setView: (view: View) => void; customerById: (id: string) => Customer | undefined; onNewVehicle: () => void }) {
  const occupied = data.vehicles.filter((vehicle) => vehicle.coneNumber !== null)
  const active = data.vehicles.filter((vehicle) => vehicle.status !== 'Consegnata')
  const ready = data.vehicles.filter((vehicle) => vehicle.status === 'Pronta')
  const overdue = data.invoices.filter((invoice) => invoice.status !== 'Incassata' && invoice.status !== 'Stornata' && invoice.dueDate < new Date().toISOString().slice(0, 10)).length
  const economic = calculateEconomicSummary(data.vehicles, data.plannerSettings)
  const acceptanceItems = data.acceptances ?? []
  const today = new Date().toISOString().slice(0, 10)
  const dueVehicles = data.vehicles.filter((vehicle) => vehicle.requestedDeliveryDate && vehicle.requestedDeliveryDate >= today).slice(0, 5)
  const alerts = [
    overdue ? `${overdue} fatture scadute da controllare` : '',
    economic.missingRevenue > 0 ? `Obiettivo mensile ancora da raggiungere: € ${economic.missingRevenue.toLocaleString('it-IT')}` : '',
    occupied.length >= TOTAL_CONES * 0.8 ? 'Piazzale quasi saturato, valuta la consegna in ritardo' : '',
  ].filter(Boolean)

  const progressPercent = Math.min(100, Math.round((ready.length / Math.max(1, active.length)) * 100))
  const kpiCards = [
    { label: 'Vetture presenti', value: active.length, target: 'vehicles', hint: 'Catalogo operativo' },
    { label: 'Clienti registrati', value: data.customers.length, target: 'customers', hint: 'Anagrafica cliente' },
    { label: 'Coni occupati', value: occupied.length, target: 'cones', hint: `${TOTAL_CONES - occupied.length} liberi` },
    { label: 'Pratiche accettazione', value: acceptanceItems.length, target: 'acceptance', hint: 'Workflow OCR' },
  ] as const

  return <>
    <section className="welcome premium-welcome"><div><span className="eyebrow">OGGI IN CARROZZERIA</span><h2>Buon lavoro, Filippo.</h2><p>Dashboard premium basata sui dati live dell’ERP: KPI, pratiche, agenda e notifiche.</p></div><button className="primary" onClick={onNewVehicle}><Icon name="plus" /> {data.customers.length ? 'Nuova vettura' : 'Crea il primo cliente'}</button></section>

    <section className="premium-kpi-grid">{kpiCards.map((card) => <button className="premium-kpi-card" key={card.label} onClick={() => setView(card.target)}><span>{card.label}</span><strong>{card.value}</strong><small>{card.hint}</small></button>)}</section>

    <section className="premium-overview-grid">
      <div className="panel premium-panel">
        <div className="panel-head"><div><span className="eyebrow">AVANZAMENTO</span><h3>Obiettivo mese</h3></div><button className="link" onClick={() => setView('planner')}>Apri planner →</button></div>
        <div className="premium-progress"><div className="premium-progress-track"><i style={{ width: `${economic.reachedPercent}%` }} /></div><div className="premium-progress-meta"><strong>{economic.reachedPercent}%</strong><span>{economic.plannedRevenue.toLocaleString('it-IT')} € / {economic.goal.toLocaleString('it-IT')} €</span></div></div>
      </div>
      <div className="panel premium-panel">
        <div className="panel-head"><div><span className="eyebrow">AGENDA GIORNALIERA</span><h3>Consegne e inizio jobs</h3></div></div>
        <div className="agenda-list">{dueVehicles.map((vehicle) => <div key={vehicle.id}><strong>{vehicle.plate}</strong><span>{customerById(vehicle.customerId)?.name ?? 'Cliente'} · {vehicle.requestedDeliveryDate}</span></div>)}{!dueVehicles.length && <div className="empty-small">Nessuna consegna pianificata per oggi.</div>}</div>
      </div>
    </section>

    <EconomicGoalPanel data={data} />

    <section className="dashboard-grid">
      <div className="panel premium-panel"><div className="panel-head"><div><span className="eyebrow">TIMELINE PRACTICA</span><h3>Ultime accettazioni</h3></div><button className="link" onClick={() => setView('acceptance')}>Apri accettazione →</button></div><div className="timeline-list">{acceptanceItems.slice(0, 5).map((item) => <div className="timeline-item" key={item.id}><b>{item.status}</b><span><strong>{customerById(item.customerId)?.name ?? 'Cliente'} · {data.vehicles.find((vehicle) => vehicle.id === item.vehicleId)?.plate ?? 'Vettura'}</strong><small>{formatDate(item.updatedAt)}</small></span></div>)}{!acceptanceItems.length && <Empty text="Nessuna pratica di accettazione da mostrare." />}</div></div>
      <div className="panel premium-panel"><div className="panel-head"><div><span className="eyebrow">CENTRO NOTIFICHE</span><h3>Azioni da completare</h3></div></div><div className="notices-list">{alerts.length ? alerts.map((alert) => <div className="notice-item" key={alert}><span>•</span><strong>{alert}</strong></div>) : <div className="empty-small">Nessuna notifica attiva.</div>}</div></div>
    </section>

    <section className="dashboard-grid">
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">PIAZZALE</span><h3>Stato dei 30 coni</h3></div><button className="link" onClick={() => setView('cones')}>Gestisci coni →</button></div><div className="mini-cones">{Array.from({ length: TOTAL_CONES }, (_, i) => i + 1).map((number) => { const vehicle = occupied.find((item) => item.coneNumber === number); return <div title={vehicle?.plate ?? 'Libero'} className={vehicle ? 'busy' : ''} key={number}>{number}</div> })}</div><div className="legend"><span><i /> Liberi ({TOTAL_CONES - occupied.length})</span><span><i className="busy" /> Occupati ({occupied.length})</span></div></div>
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">ASSISTENTE AI</span><h3>Consigli live</h3></div></div><div className="activity">{alerts.length ? alerts.map((alert) => <div key={alert}><b>AI</b><span><strong>Analisi continua</strong><small>{alert}</small></span></div>) : <div className="empty-small">L’Assistente AI non rileva azioni urgenti.</div>}{!ready.length && <div className="empty-small">Nessuna vettura pronta per il rilascio oggi.</div>}</div></div>
    </section>

    <section className="dashboard-grid">
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">ATTIVITÀ RECENTI</span><h3>Ultime assegnazioni</h3></div></div><div className="activity">{data.coneHistory.slice(0, 5).map((item) => { const vehicle = data.vehicles.find((v) => v.id === item.vehicleId); return <div key={item.id}><b>{item.coneNumber}</b><span><strong>{item.vehiclePlate}</strong><small>{item.action}{vehicle ? ` · ${customerById(vehicle.customerId)?.name ?? ''}` : ''}</small></span><time>{formatDate(item.timestamp)}</time></div> })}{!data.coneHistory.length && <Empty text="Le assegnazioni dei coni compariranno qui." />}</div></div>
      <div className="panel premium-panel"><div className="panel-head"><div><span className="eyebrow">PROGRESSO OPERATIVO</span><h3>Preparazione pronta per rilascio</h3></div></div><div className="premium-progress"><div className="premium-progress-track"><i style={{ width: `${progressPercent}%` }} /></div><div className="premium-progress-meta"><strong>{progressPercent}%</strong><span>{ready.length} vetture pronte · {active.length} in corso</span></div></div></div>
    </section>
  </>
}

function Customers({ customers, data, onAdd, onEdit, onDelete }: { customers: Customer[]; data: ErpData; onAdd: () => void; onEdit: (customer: Customer) => void; onDelete: (id: string) => void }) {
  return <div className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">ANAGRAFICA</span><h3>{customers.length} clienti</h3></div><button className="primary" onClick={onAdd}><Icon name="plus" /> Nuovo cliente</button></div>
    <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Tipo</th><th>Contatti</th><th>Codice fiscale / P.IVA</th><th>Veicoli</th><th>Azioni</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id}><td><strong>{customer.name}</strong><small>{customer.address || 'Indirizzo non indicato'}</small></td><td><span className="tag">{customer.type}</span></td><td>{customer.phone}<small>{customer.email || 'Email non indicata'}</small></td><td>{customer.taxId || '—'}</td><td><b className="count">{data.vehicles.filter((vehicle) => vehicle.customerId === customer.id).length}</b></td><td><div className="row-actions"><button onClick={() => onEdit(customer)}>Modifica</button><button className="danger" onClick={() => { if (window.confirm(`Eliminare il cliente ${customer.name}?`)) onDelete(customer.id) }}>Elimina</button></div></td></tr>)}</tbody></table></div>{!customers.length && <Empty text="Nessun cliente trovato. Crea la prima anagrafica." />}</div>
}

function Vehicles({ vehicles, customers, onAdd, onEdit, onDelete, updateStatus, customerById }: { vehicles: Vehicle[]; customers: Customer[]; onAdd: () => void; onEdit: (vehicle: Vehicle) => void; onDelete: (id: string) => void; updateStatus: (id: string, status: VehicleStatus) => void; customerById: (id: string) => Customer | undefined }) {
  return <div className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">PARCO VEICOLI</span><h3>{vehicles.length} vetture</h3></div><button className="primary" onClick={onAdd} disabled={!customers.length} title={!customers.length ? 'Crea prima un cliente' : ''}><Icon name="plus" /> Nuova vettura</button></div>
    <div className="table-wrap"><table><thead><tr><th>Vettura</th><th>Cliente</th><th>Stato operativo</th><th>Cono</th><th>Dati</th><th>Azioni</th></tr></thead><tbody>{vehicles.map((vehicle) => <tr key={vehicle.id}><td><strong className="plate">{vehicle.plate}</strong><small>{vehicle.make} {vehicle.model} · {vehicle.color || 'Colore n/d'}</small></td><td>{customerById(vehicle.customerId)?.name}</td><td><select className={`status status-${vehicle.status.toLowerCase().replaceAll(' ', '-')}`} value={vehicle.status} onChange={(event) => updateStatus(vehicle.id, event.target.value as VehicleStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></td><td>{vehicle.coneNumber ? <b className="cone-badge">{vehicle.coneNumber}</b> : '—'}</td><td>{vehicle.year || 'Anno n/d'}<small>{vehicle.mileage ? `${vehicle.mileage} km` : 'Km n/d'}</small></td><td><div className="row-actions"><button onClick={() => onEdit(vehicle)}>Modifica</button><button className="danger" onClick={() => onDelete(vehicle.id)}>Elimina</button></div></td></tr>)}</tbody></table></div>{!vehicles.length && <Empty text={customers.length ? 'Nessuna vettura trovata. Registrane una nuova.' : 'Crea prima un cliente, poi potrai registrare la sua vettura.'} />}</div>
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
  const [manualCustomer, setManualCustomer] = useState(customer?.name ?? '')
  const [manualPlate, setManualPlate] = useState(vehicle?.plate ?? '')
  const [manualLaborHours, setManualLaborHours] = useState(8)
  const documentFields = Object.entries(acceptance.customerDraft[0]?.fields ?? {}) as Array<[string, { value: string; confidence: string; source: 'ocr' | 'manual' }]>
  const bookletFields = Object.entries(acceptance.vehicleBooklet[0]?.fields ?? {}) as Array<[string, { value: string; confidence: string; source: 'ocr' | 'manual' }]>

  const updateLine = (lineId: string, field: keyof AcceptanceLine, value: string | number) => {
    const nextLines = quote.lines.map((line) => line.id === lineId ? { ...line, [field]: value } : line)
    onSave({ ...acceptance, quote: { ...quote, lines: nextLines }, updatedAt: new Date().toISOString() })
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
        onSave({
          ...acceptance,
          damagePhotos: [...acceptance.damagePhotos, dataUrl],
          updatedAt: new Date().toISOString(),
        })
      }
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

  return <div className="acceptance-editor"><div className="panel"><div className="panel-head"><div><span className="eyebrow">CONTENUTO PRATICA</span><h3>{customer?.name ?? 'Cliente'} · {vehicle?.plate ?? 'Vettura'}</h3></div><button className="secondary" onClick={downloadPdf}>Genera PDF</button></div>
    <div className="form-grid">
      <label>Documento identità<input type="file" accept="image/*" onChange={(event) => handleFile(event, 'document')} /></label>
      <label>Libretto<input type="file" accept="image/*" onChange={(event) => handleFile(event, 'booklet')} /></label>
      <label>Danni foto<input type="file" accept="image/*" onChange={(event) => handleFile(event, 'damage')} /></label>
      <label>Cliente confermato<input value={manualCustomer} onChange={(event) => setManualCustomer(event.target.value)} /></label>
      <label>Targa confermata<input value={manualPlate} onChange={(event) => setManualPlate(event.target.value)} /></label>
      <label>Ore manodopera<input type="number" min="0" step="0.25" value={manualLaborHours} onChange={(event) => setManualLaborHours(Number(event.target.value))} /></label>
      <button className="primary" onClick={persistQuote}>Aggiorna preventivo</button>
    </div>
    <div className="preview-grid">
      <div className="preview-card"><h4>Documento ID</h4>{acceptance.customerDraft[0]?.dataUrl ? <img src={acceptance.customerDraft[0].dataUrl} alt="Documento ID" /> : <p>Carica documento fronte/retro per il flusso OCR.</p>}</div>
      <div className="preview-card"><h4>Libretto</h4>{acceptance.vehicleBooklet[0]?.dataUrl ? <img src={acceptance.vehicleBooklet[0].dataUrl} alt="Libretto" /> : <p>Carica il libretto per l’inserimento dati veicolo.</p>}</div>
      <div className="preview-card"><h4>Danni</h4>{acceptance.damagePhotos.length ? acceptance.damagePhotos.map((photo, index) => <img src={photo} alt={`Danno ${index + 1}`} key={`${photo}-${index}`} />) : <p>Nessuna foto danno allegata.</p>}</div>
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
