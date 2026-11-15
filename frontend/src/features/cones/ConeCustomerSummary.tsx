import { useState, type ReactNode } from 'react'
import type { ErpData, EstimateDocument, OperatorProgramTask, RepairJob, Vehicle } from '../../types'
import { normalizePlate } from '../../services/erp'
import { isVehicleStatusSemantic, isVehicleWaitingForParts, resolveVehicleStatusLabel } from '../../services/vehicleStatuses'
import { estimateFinancialStage } from '../../services/workflow'
import { indexVehicleJobs, isArchivedVehicle } from '../../services/vehicleArchive'

const dateLabel = (value?: string) => value?.slice(0, 10).split('-').reverse().join('/') || '—'
const isClosed = (job: RepairJob) => job.status === 'Consegnata' || job.status === 'Annullata'
const isInactiveEstimate = (estimate: EstimateDocument) => estimate.status === 'Rifiutato' || estimate.status === 'Scaduto'
const money = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })

export function ConeCustomerSummary({ data, query = '', onAdd, renderActions, renderStatus }: {
  data: ErpData
  query?: string
  onAdd?: () => void
  renderActions?: (vehicle: Vehicle, estimate?: EstimateDocument, job?: RepairJob) => ReactNode
  renderStatus?: (vehicle: Vehicle) => ReactNode
}) {
  const [scope, setScope] = useState<'shop' | 'all'>('shop')
  const settings = data.plannerSettings
  const customers = new Map(data.customers.map(customer => [customer.id, customer.name]))
  const search = query.trim().toLocaleLowerCase('it')
  const searchPlate = normalizePlate(search)
  const accepted = new Set(data.acceptances?.filter(item => item.status === 'confirmed').map(item => item.vehicleId))
  const jobsFor = indexVehicleJobs(data.jobs ?? [])
  const groups = new Map<string, Array<{ vehicle: Vehicle; job?: RepairJob }>>()
  for (const vehicle of data.vehicles) {
    const jobs = jobsFor(vehicle)
    if (isArchivedVehicle(settings, vehicle, jobs)) continue
    const job = jobs.find(item => !isClosed(item)) ?? jobs[0]
    if (search && !(searchPlate && normalizePlate(vehicle.plate).includes(searchPlate))
      && !`${customers.get(vehicle.customerId) ?? ''} ${vehicle.make} ${vehicle.model}`.toLocaleLowerCase('it').includes(search)) continue
    const delivered = isVehicleStatusSemantic(settings, vehicle.status, 'delivered') || job?.status === 'Consegnata'
    const cancelled = isVehicleStatusSemantic(settings, vehicle.status, 'cancelled') || job?.status === 'Annullata'
    if (scope === 'shop' && (delivered || cancelled || (!search && vehicle.coneNumber == null && !job && !vehicle.entryDate && !accepted.has(vehicle.id)))) continue
    const group = groups.get(vehicle.customerId) ?? []
    group.push({ vehicle, job })
    groups.set(vehicle.customerId, group)
  }
  const estimates = data.estimates ?? []
  const estimatesById = new Map(estimates.map(estimate => [estimate.id, estimate]))
  const estimatesByJob = new Map(estimates.filter(estimate => estimate.convertedJobId).map(estimate => [estimate.convertedJobId, estimate]))
  const unconvertedEstimates = estimates.filter(estimate => !estimate.convertedJobId).sort((a, b) =>
    Number(isInactiveEstimate(a)) - Number(isInactiveEstimate(b))
    || b.date.localeCompare(a.date)
    || b.createdAt.localeCompare(a.createdAt))
  const tasks = new Map<string, OperatorProgramTask[]>()
  for (const program of data.operatorPrograms ?? []) for (const task of program.tasks) {
    const list = tasks.get(task.jobId) ?? []
    list.push(task)
    tasks.set(task.jobId, list)
  }
  const rows = [...groups].sort(([a], [b]) => (customers.get(a) ?? '').localeCompare(customers.get(b) ?? '', 'it'))

  return <section className="panel cone-customer-summary" aria-labelledby="cone-customer-title">
    <div className="panel-head"><div><span className="eyebrow">RIEPILOGO OFFICINA</span><h3 id="cone-customer-title">Vetture per cliente</h3></div>
      <div className="planner-actions">
        {onAdd && <button type="button" className="primary" disabled={!data.customers.length}
          title={!data.customers.length ? 'Crea prima un cliente' : undefined}
          onClick={() => { setScope('all'); onAdd() }}>Nuova vettura</button>}
        <select aria-label="Vetture da mostrare" value={scope} onChange={event => setScope(event.target.value as typeof scope)}>
          <option value="shop">In carrozzeria</option><option value="all">Tutte le vetture non consegnate</option>
        </select>
        <small>{rows.length} clienti · {[...groups.values()].reduce((count, group) => count + group.length, 0)} vetture</small>
      </div>
    </div>
    {!rows.length ? <p>Nessuna vettura trovata.</p> : <div className="cone-customer-scroll"><table>
      <thead><tr><th scope="col">Cliente</th><th scope="col">Vetture</th><th scope="col">Dettaglio vetture</th></tr></thead>
      <tbody>{rows.map(([customerId, group]) => <tr key={customerId}>
        <th scope="row">{customers.get(customerId) || 'Cliente non indicato'}</th>
        <td>{group.length}</td>
        <td><ul className="cone-customer-vehicles">{group.sort((a, b) => (a.vehicle.coneNumber ?? Infinity) - (b.vehicle.coneNumber ?? Infinity)
          || a.vehicle.plate.localeCompare(b.vehicle.plate)).map(({ vehicle, job }) => {
          const closedVehicle = isVehicleStatusSemantic(settings, vehicle.status, 'delivered') || isVehicleStatusSemantic(settings, vehicle.status, 'cancelled')
          const waiting = !closedVehicle && isVehicleWaitingForParts(settings, vehicle)
          const phases = (job?.phases ?? []).filter(phase => !phase.notRequired && phase.name !== 'Consegna')
          const phaseTimers = phases.flatMap(phase => phase.operatorAssignments
            .filter(assignment => assignment.activityStatus === 'Attivo' && !assignment.endedAt && phase.status !== 'Completata')
            .map(assignment => `${assignment.operatorName} · ${phase.name}`))
          const logs = (data.production?.workLogs ?? []).filter(log => log.vehicleId === vehicle.id)
          const timers = [...new Set([...phaseTimers, ...logs.filter(log => log.status === 'running').map(log => `${log.operatorName} · ${log.phase}`)])]
          const actualStart = [...phases.flatMap(phase => [phase.startedAt, ...phase.operatorAssignments.map(assignment => assignment.startedAt)]),
            ...logs.map(log => log.startedAt)].filter(Boolean).sort()[0]
          const completed = phases.length > 0 && phases.every(phase => phase.status === 'Completata')
          const actualEnd = completed ? phases.map(phase => phase.completedAt || phase.endedAt).filter(Boolean).sort().at(-1) : undefined
          const planned = waiting || !job ? [] : (tasks.get(job.id) ?? []).filter(task => task.phaseName !== 'Consegna')
          const plannedStart = planned.map(task => task.startAt).sort()[0]
          const plannedEnd = !completed && phases.every(phase => phase.status === 'Completata' || planned.some(task => task.phaseId === phase.id))
            ? planned.map(task => task.endAt).sort().at(-1) : undefined
          const currentPhase = phases.find(phase => phase.status === 'In lavorazione')
          const vehicleLabel = resolveVehicleStatusLabel(settings, vehicle.status)
          const ready = isVehicleStatusSemantic(settings, vehicle.status, 'ready')
          const status = waiting ? 'In attesa ricambi' : ready || closedVehicle ? vehicleLabel : job?.status || vehicleLabel
          const estimate = job
            ? estimatesById.get(job.estimateId ?? '') ?? estimatesByJob.get(job.id)
            : unconvertedEstimates.find(item => item.vehicleId === vehicle.id
              || (!item.vehicleId && item.customerId === vehicle.customerId && normalizePlate(item.plate) === normalizePlate(vehicle.plate)))
          const model = [vehicle.make, vehicle.model].filter(Boolean).join(' ')
          return <li key={vehicle.id} className={waiting ? 'waiting-parts' : undefined}>
            <div><strong>{vehicle.plate}</strong><small>{vehicle.coneNumber == null ? 'Senza cono' : `Cono ${vehicle.coneNumber}`}</small></div>
            <div><strong>{status}</strong>
              {!waiting && currentPhase && <small>{currentPhase.name}</small>}</div>
            <div><small>{actualStart ? 'Inizio effettivo' : 'Inizio previsto'}</small>{dateLabel(actualStart || plannedStart)}</div>
            <div><small>{actualEnd ? 'Fine effettiva' : 'Fine prevista'}</small>{dateLabel(actualEnd || plannedEnd)}</div>
            <div className={timers.length ? 'cone-timer-active' : undefined}>{timers.length ? <><strong>Timer attivo</strong><small>{timers.join(', ')}</small></> : <small>Timer fermo</small>}</div>
            <div className="cone-customer-details">
              <div>
                <small>Dati vettura</small>
                {model && <strong>{model}</strong>}
                <div>{vehicle.year ? `Anno ${vehicle.year}` : 'Anno n/d'} · {vehicle.mileage ? `${vehicle.mileage} km` : 'Km n/d'}</div>
                {vehicle.color && <small>{vehicle.color}</small>}
              </div>
              <div>
                <small>Stato vettura</small>
                {renderStatus ? renderStatus(vehicle) : vehicleLabel !== status && <strong>{vehicleLabel}</strong>}
                <small>{vehicle.statusMode === 'manual' ? 'Override manuale'
                  : vehicle.suggestedStatus ? `Suggerito: ${resolveVehicleStatusLabel(settings, vehicle.suggestedStatus)}` : 'Suggerimento automatico'}</small>
              </div>
              <div>
                <small>Preventivo / Commessa</small>
                <strong>{[estimate?.number, job?.number].filter(Boolean).join(' · ') || '—'}</strong>
                {estimate && <small>{dateLabel(estimate.date)} · {estimate.status}</small>}
              </div>
              <div>
                <small>Totale preventivo</small>
                <strong>{estimate ? money.format(estimate.total) : '—'}</strong>
              </div>
              <div>
                <small>Stadio economico</small>
                <strong>{estimate ? estimateFinancialStage(data, estimate) : '—'}</strong>
              </div>
              {renderActions && <div className="cone-customer-actions">{renderActions(vehicle, estimate, job)}</div>}
            </div>
          </li>
        })}</ul></td>
      </tr>)}</tbody>
    </table></div>}
  </section>
}
