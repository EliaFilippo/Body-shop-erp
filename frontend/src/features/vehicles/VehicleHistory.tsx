import { useState, type ReactNode } from 'react'
import type { ErpData, RepairJob, Vehicle, VehicleStatus } from '../../types'
import { normalizePlate } from '../../services/erp'
import { isVehicleDeliveredStatus, isVehicleStatusSemantic } from '../../services/vehicleStatuses'

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
  const customers = new Map(data.customers.map(customer => [customer.id, customer.name]))
  const jobsByVehicle = new Map<string, RepairJob>()
  for (const job of data.jobs ?? []) {
    if (job.status === 'Annullata') continue
    const key = job.vehicleId ? `id:${job.vehicleId}` : `plate:${job.customerId}:${normalizePlate(job.plate)}`
    const previous = jobsByVehicle.get(key)
    if (!previous || (job.createdAt ?? '') > (previous.createdAt ?? '')) jobsByVehicle.set(key, job)
  }

  const search = query.trim().toLocaleLowerCase('it')
  const searchPlate = normalizePlate(search)
  const rows = data.vehicles.flatMap(vehicle => {
    if (isVehicleStatusSemantic(data.plannerSettings, vehicle.status, 'cancelled')) return []
    const job = jobsByVehicle.get(`id:${vehicle.id}`) ?? jobsByVehicle.get(`plate:${vehicle.customerId}:${normalizePlate(vehicle.plate)}`)
    const markedDelivered = isVehicleDeliveredStatus(data.plannerSettings, vehicle.status)
    const jobDelivered = job?.status === 'Consegnata'
    if (!markedDelivered && (!jobDelivered || vehicle.coneNumber != null || vehicle.statusMode === 'manual')) return []
    const customer = customers.get(vehicle.customerId) ?? ''
    if (search && !(searchPlate && normalizePlate(vehicle.plate).includes(searchPlate))
      && !`${customer} ${vehicle.make} ${vehicle.model} ${job?.number ?? ''}`.toLocaleLowerCase('it').includes(search)) return []
    const statusDay = (vehicle.statusHistory ?? [])
      .filter(change => isVehicleDeliveredStatus(data.plannerSettings, change.to))
      .map(change => dateInRome(change.at)).sort().at(-1)
    const day = dateInRome(vehicle.deliveredAt)
      || (jobDelivered ? dateInRome(job.deliveredAt) : '') || statusDay || ''
    return [{ vehicle, customer, day, markedDelivered, jobNumber: jobDelivered ? job.number : undefined }]
  }).sort((a, b) => b.day.localeCompare(a.day) || a.vehicle.plate.localeCompare(b.vehicle.plate, 'it'))

  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = row.day.slice(0, 7) || 'undated'
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
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
                <td>{renderActions(vehicle)}</td>
              </tr>
            )}</tbody>
          </table>
        </div>
      </section>,
    )}
  </section>
}
