import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { Icon } from './components/Icon'
import { Modal } from './components/Modal'
import { addVehicle, createCustomer, deleteCustomer, deleteVehicle, moveVehicleCone, changeVehicleStatus, TOTAL_CONES, emptyData, updateCustomer, updateVehicle } from './services/erp'
import { loadDatabase, saveDatabase } from './services/database'
import type { Customer, CustomerType, ErpData, Vehicle, VehicleStatus, View } from './types'

const nav: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' }, { id: 'customers', label: 'Clienti' },
  { id: 'vehicles', label: 'Veicoli' }, { id: 'cones', label: 'Gestione coni' },
  { id: 'planner', label: 'Planner intelligente' },
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
      <div className="sidebar-foot"><span className="online-dot" /> Sistema operativo</div>
    </aside>
    {menu && <button className="menu-overlay" onClick={() => setMenu(false)} aria-label="Chiudi menu" />}

    <main>
      <header><button className="menu-button" onClick={() => setMenu(true)}><Icon name="menu" /></button><div><span className="eyebrow">PANORAMICA OPERATIVA</span><h1>{title}</h1></div><div className="header-actions"><div className="search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca targa, cliente..." /></div><div className="avatar">FE</div></div></header>
      {error && <div className="toast error">{error}<button onClick={() => setError('')}>×</button></div>}
      <div className="content">
        {view === 'dashboard' && <Dashboard data={data} setView={setView} customerById={customerById} />}
        {view === 'customers' && <Customers customers={filteredCustomers} data={data} onAdd={() => setModal({ type: 'customer' })} onEdit={(item) => setModal({ type: 'customer', item })} onDelete={(id) => { try { setData(deleteCustomer(data, id)); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } }} />}
        {view === 'vehicles' && <Vehicles vehicles={filteredVehicles} customers={data.customers} onAdd={() => setModal({ type: 'vehicle' })} onEdit={(item) => setModal({ type: 'vehicle', item })} onDelete={(id) => { if (window.confirm('Eliminare definitivamente questa vettura?')) { try { setData(deleteVehicle(data, id)); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } } }} updateStatus={updateStatus} customerById={customerById} />}
        {view === 'cones' && <Cones data={data} customerById={customerById} onMove={(vehicleId, cone) => { try { setData(moveVehicleCone(data, vehicleId, cone)); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } }} />}
        {view === 'planner' && <Planner data={data} customerById={customerById} updateStatus={updateStatus} />}
      </div>
    </main>

    {modal?.type === 'customer' && <CustomerForm customer={modal.item} onClose={() => setModal(null)} onSave={(input) => { setData(modal.item ? { ...data, customers: updateCustomer(data.customers, modal.item.id, input) } : { ...data, customers: [createCustomer(input), ...data.customers] }); setModal(null) }} setError={setError} />}
    {modal?.type === 'vehicle' && <VehicleForm vehicle={modal.item} customers={data.customers} onClose={() => setModal(null)} onSave={(input) => { setData(modal.item ? updateVehicle(data, modal.item.id, input) : addVehicle(data, input)); setModal(null) }} setError={setError} />}
  </div>
}

function Dashboard({ data, setView, customerById }: { data: ErpData; setView: (view: View) => void; customerById: (id: string) => Customer | undefined }) {
  const occupied = data.vehicles.filter((vehicle) => vehicle.coneNumber !== null)
  const active = data.vehicles.filter((vehicle) => vehicle.status !== 'Consegnata')
  const ready = data.vehicles.filter((vehicle) => vehicle.status === 'Pronta')
  const cards = [
    ['Vetture presenti', active.length, 'vehicles'], ['Clienti registrati', data.customers.length, 'customers'],
    ['Coni occupati', occupied.length, 'cones'], ['Vetture pronte', ready.length, 'vehicles'],
  ] as const
  return <>
    <section className="welcome"><div><span className="eyebrow">OGGI IN CARROZZERIA</span><h2>Buon lavoro, Filippo.</h2><p>Tutto ciò che serve per tenere sotto controllo accettazione, vetture e piazzale.</p></div><button className="primary" onClick={() => setView('vehicles')}><Icon name="plus" /> Nuova vettura</button></section>
    <section className="stat-grid">{cards.map(([label, value, target]) => <button className="stat-card" key={label} onClick={() => setView(target)}><span>{label}</span><strong>{value}</strong><small>{label === 'Coni occupati' ? `${TOTAL_CONES - occupied.length} coni liberi` : 'Vedi dettaglio →'}</small></button>)}</section>
    <section className="dashboard-grid">
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">PIAZZALE</span><h3>Stato dei 30 coni</h3></div><button className="link" onClick={() => setView('cones')}>Gestisci coni →</button></div><div className="mini-cones">{Array.from({ length: TOTAL_CONES }, (_, i) => i + 1).map((number) => { const vehicle = occupied.find((item) => item.coneNumber === number); return <div title={vehicle?.plate ?? 'Libero'} className={vehicle ? 'busy' : ''} key={number}>{number}</div> })}</div><div className="legend"><span><i /> Liberi ({TOTAL_CONES - occupied.length})</span><span><i className="busy" /> Occupati ({occupied.length})</span></div></div>
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">ATTIVITÀ RECENTI</span><h3>Ultime assegnazioni</h3></div></div><div className="activity">{data.coneHistory.slice(0, 5).map((item) => { const vehicle = data.vehicles.find((v) => v.id === item.vehicleId); return <div key={item.id}><b>{item.coneNumber}</b><span><strong>{item.vehiclePlate}</strong><small>{item.action}{vehicle ? ` · ${customerById(vehicle.customerId)?.name ?? ''}` : ''}</small></span><time>{formatDate(item.timestamp)}</time></div> })}{!data.coneHistory.length && <Empty text="Le assegnazioni dei coni compariranno qui." />}</div></div>
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

function Planner({ data, customerById, updateStatus }: { data: ErpData; customerById: (id: string) => Customer | undefined; updateStatus: (id: string, status: VehicleStatus) => void }) {
  const active = data.vehicles
    .filter((vehicle) => vehicle.status !== 'Consegnata')
    .sort((a, b) => {
      const priority = { Urgente: 0, Alta: 1, Normale: 2 }
      const score = (vehicle: ErpData['vehicles'][number]) => priority[vehicle.priority ?? 'Normale']
      return score(a) - score(b) || (a.deliveryDate || '9999').localeCompare(b.deliveryDate || '9999')
    })
  const columns: VehicleStatus[] = ['Accettata', 'Confermata', 'In lavorazione', 'Pronta']
  return <>
    <section className="welcome"><div><span className="eyebrow">PIANIFICAZIONE DINAMICA</span><h2>Priorità operative</h2><p>Le vetture urgenti e con consegna più vicina vengono proposte per prime.</p></div><div className="planner-total"><strong>{active.length}</strong><span>vetture attive</span></div></section>
    <section className="planner-board">{columns.map((status) => <div className="planner-column" key={status}><div className="planner-title"><span>{status}</span><b>{active.filter((vehicle) => vehicle.status === status).length}</b></div>{active.filter((vehicle) => vehicle.status === status).map((vehicle, index) => <article className="planner-card" key={vehicle.id}><div><span className={`priority priority-${(vehicle.priority ?? 'Normale').toLowerCase()}`}>{vehicle.priority ?? 'Normale'}</span>{index === 0 && status !== 'Pronta' && <span className="suggested">PROSSIMA</span>}</div><strong className="plate">{vehicle.plate}</strong><p>{vehicle.make} {vehicle.model}</p><small>{customerById(vehicle.customerId)?.name}</small><div className="planner-meta"><span>Cono {vehicle.coneNumber ?? '—'}</span><span>{vehicle.deliveryDate ? new Intl.DateTimeFormat('it-IT').format(new Date(vehicle.deliveryDate)) : 'Consegna n/d'}</span></div>{status !== 'Pronta' && <button className="advance" onClick={() => updateStatus(vehicle.id, columns[columns.indexOf(status) + 1])}>Avanza fase →</button>}</article>)}</div>)}</section>
  </>
}

function CustomerForm({ customer, onClose, onSave, setError }: { customer?: Customer; onClose: () => void; onSave: (customer: Omit<Customer, 'id' | 'createdAt'>) => void; setError: (error: string) => void }) {
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { onSave({ type: form.get('type') as CustomerType, name: String(form.get('name')), phone: String(form.get('phone')), email: String(form.get('email')), taxId: String(form.get('taxId')), address: String(form.get('address')) }); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Dati non validi.') } }
  return <Modal title={customer ? 'Modifica cliente' : 'Nuovo cliente'} onClose={onClose}><form onSubmit={submit} className="form-grid"><label>Tipo cliente<select name="type" defaultValue={customer?.type ?? 'Privato'}><option>Privato</option><option>Azienda</option></select></label><label>Nome / ragione sociale<input name="name" required autoFocus defaultValue={customer?.name} /></label><label>Telefono<input name="phone" required inputMode="tel" defaultValue={customer?.phone} /></label><label>Email<input name="email" type="email" defaultValue={customer?.email} /></label><label>Codice fiscale / P.IVA<input name="taxId" defaultValue={customer?.taxId} /></label><label>Indirizzo<input name="address" defaultValue={customer?.address} /></label><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Annulla</button><button className="primary">Salva cliente</button></div></form></Modal>
}

function VehicleForm({ vehicle, customers, onClose, onSave, setError }: { vehicle?: Vehicle; customers: Customer[]; onClose: () => void; onSave: (vehicle: Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'>) => void; setError: (error: string) => void }) {
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { onSave({ customerId: String(form.get('customerId')), plate: String(form.get('plate')), make: String(form.get('make')), model: String(form.get('model')), color: String(form.get('color')), year: String(form.get('year')), vin: String(form.get('vin')), mileage: String(form.get('mileage')), status: vehicle?.status ?? form.get('status') as VehicleStatus, priority: form.get('priority') as 'Normale' | 'Alta' | 'Urgente', deliveryDate: String(form.get('deliveryDate')) }); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Dati non validi.') } }
  return <Modal title={vehicle ? 'Modifica vettura' : 'Nuova vettura'} onClose={onClose}><form onSubmit={submit} className="form-grid"><label>Cliente<select name="customerId" required defaultValue={vehicle?.customerId ?? ''}><option value="">Seleziona cliente</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label><label>Targa<input name="plate" required autoFocus className="uppercase" placeholder="AB123CD" defaultValue={vehicle?.plate} /></label><label>Marca<input name="make" required placeholder="es. BMW" defaultValue={vehicle?.make} /></label><label>Modello<input name="model" required placeholder="es. Serie 3" defaultValue={vehicle?.model} /></label><label>Colore<input name="color" defaultValue={vehicle?.color} /></label><label>Anno<input name="year" inputMode="numeric" defaultValue={vehicle?.year} /></label><label>VIN<input name="vin" defaultValue={vehicle?.vin} /></label><label>Chilometraggio<input name="mileage" inputMode="numeric" defaultValue={vehicle?.mileage} /></label>{!vehicle && <label>Stato iniziale<select name="status">{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>}<label>Priorità<select name="priority" defaultValue={vehicle?.priority ?? 'Normale'}><option>Normale</option><option>Alta</option><option>Urgente</option></select></label><label>Consegna prevista<input name="deliveryDate" type="date" defaultValue={vehicle?.deliveryDate} /></label><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Annulla</button><button className="primary">Salva vettura</button></div></form></Modal>
}

function Empty({ text }: { text: string }) { return <div className="empty"><div>◇</div><p>{text}</p></div> }
export default App
