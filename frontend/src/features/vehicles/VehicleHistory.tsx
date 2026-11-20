import { useState, type ReactNode } from 'react'
import type { ErpData, Vehicle, VehicleStatus } from '../../types'
import { normalizePlate } from '../../services/erp'
import { isVehicleDeliveredStatus } from '../../services/vehicleStatuses'
import { indexVehicleJobs, isArchivedVehicle } from '../../services/vehicleArchive'
import { ArchivedVehicleDetails } from './ArchivedVehicleDetails'

const deliveryDay = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
})
const monthName = new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', month: 'long', year: 'numeric' })

function dateInRome(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  return deliveryDay.format(new Date(value))
}

export function VehicleHistory({ data, query, renderActions, renderStatus }: {
  data: ErpData
  query: string
  renderActions: (vehicle: Vehicle) => ReactNode
  renderStatus: (vehicle: Vehicle, fallback?: VehicleStatus) => ReactNode
}) {
  const [month, setMonth] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const customers = new Map(data.customers.map(customer => [customer.id, customer.name]))
  const jobsFor = indexVehicleJobs(data.jobs ?? [])

  const search = query.trim().toLocaleLowerCase('it')
  const searchPlate = normalizePlate(search)
  const rows = data.vehicles.flatMap(vehicle => {
    const jobs = jobsFor(vehicle)
    if (!isArchivedVehicle(data.plannerSettings, vehicle, jobs)) return []
    const markedDelivered = isVehicleDeliveredStatus(data.plannerSettings, vehicle.status)
    const deliveredJobs = jobs.filter(job => job.status === 'Consegnata')
    const job = deliveredJobs[0] ?? jobs.find(job => job.status !== 'Annullata')
    const customer = customers.get(vehicle.customerId) ?? ''
    if (search && !(searchPlate && normalizePlate(vehicle.plate).includes(searchPlate))
      && !`${customer} ${vehicle.make} ${vehicle.model} ${jobs.map(job => job.number).join(' ')}`.toLocaleLowerCase('it').includes(search)) return []
    const statusDay = (vehicle.statusHistory ?? [])
      .filter(change => isVehicleDeliveredStatus(data.plannerSettings, change.to))
      .map(change => dateInRome(change.at)).sort().at(-1)
    const day = dateInRome(vehicle.deliveredAt)
      || dateInRome(deliveredJobs[0]?.deliveredAt) || statusDay || ''
    return [{ vehicle, customer, day, markedDelivered, jobNumber: job?.number, jobs: deliveredJobs.length ? deliveredJobs : job ? [job] : [] }]
  }).sort((a, b) => b.day.localeCompare(a.day) || a.vehicle.plate.localeCompare(b.vehicle.plate, 'it'))

  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = row.day.slice(0, 7) || 'undated'
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const selected = rows.find(row => row.vehicle.id === selectedId)
  const selectedMonth = groups.has(month) ? month : ''
  const labelForMonth = (key: string) => key === 'undated' ? 'Data di consegna non registrata' : monthName.format(new Date(`${key}-01T12:00:00Z`))

  return <section className="panel table-panel">
    <div className="panel-head">
      <h3>Vetture consegnate</h3>
      <select aria-label="Mese di consegna" value={selectedMonth} onChange={event => setMonth(event.target.value)}>
        <option value="">Tutti i mesi</option>
        {[...groups.keys()].map(key => <option key={key} value={key}>{labelForMonth(key)}</option>)}
      </select>
    </div>
    {!groups.size && <p>Nessuna vettura consegnata trovata.</p>}
    {[...groups].filter(([key]) => !selectedMonth || key === selectedMonth).map(([key, group]) =>
      <section className="vehicle-history-month" key={key} aria-labelledby={`vehicle-history-${key}`}>
        <div className="panel-head">
          <h4 id={`vehicle-history-${key}`}>{labelForMonth(key)}</h4>
          <small>{group.length} {group.length === 1 ? 'vettura' : 'vetture'}</small>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Vettura</th><th>Cliente</th><th>Consegnata il</th><th>Stato operativo</th><th>Dati</th><th>Azioni</th></tr></thead>
            <tbody>{group.map(({ vehicle, customer, day, markedDelivered, jobNumber }) =>
              <tr key={vehicle.id}>
                <td><strong className="plate">{vehicle.plate}</strong><small>{vehicle.make} {vehicle.model} · {vehicle.color || 'Colore n/d'}</small></td>
                <td>{customer || '—'}{jobNumber && <small>{jobNumber}</small>}</td>
                <td>{day ? <time dateTime={day}>{day.split('-').reverse().join('/')}</time> : '—'}</td>
                <td>{renderStatus(vehicle, markedDelivered ? undefined : 'Consegnata')}</td>
                <td>{vehicle.year || 'Anno n/d'}<small>{vehicle.mileage ? `${vehicle.mileage} km` : 'Km n/d'}</small></td>
                <td><div className="row-actions"><button type="button" onClick={() => setSelectedId(vehicle.id)}>Lavorazioni e materiali</button></div>
                  {renderActions(vehicle)}</td>
              </tr>
            )}</tbody>
          </table>
        </div>
      </section>,
    )}
    {selected && <ArchivedVehicleDetails vehicle={selected.vehicle} customer={selected.customer} jobs={selected.jobs} allJobs={data.jobs??[]} operators={data.plannerSettings.operators} settings={data.plannerSettings}
      logs={(data.production?.workLogs ?? []).filter(log => log.vehicleId === selected.vehicle.id)}
      onClose={() => setSelectedId(undefined)} />}
  </section>
}
