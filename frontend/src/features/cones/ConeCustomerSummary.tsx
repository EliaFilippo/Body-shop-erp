import type { ErpData, OperatorProgramTask, RepairJob, Vehicle } from '../../types'
import { normalizePlate } from '../../services/erp'
import { isVehicleStatusSemantic, isVehicleWaitingForParts, resolveVehicleStatusLabel } from '../../services/vehicleStatuses'

const dateLabel = (value?: string) => value?.slice(0, 10).split('-').reverse().join('/') || '—'
const isClosed = (job: RepairJob) => job.status === 'Consegnata' || job.status === 'Annullata'

export function ConeCustomerSummary({ data }: { data: ErpData }) {
  const settings = data.plannerSettings
  const accepted = new Set(data.acceptances?.filter(item => item.status === 'confirmed').map(item => item.vehicleId))
  const jobs = new Map<string, RepairJob>()
  for (const job of data.jobs ?? []) {
    const key = job.vehicleId || normalizePlate(job.plate)
    const previous = jobs.get(key)
    if (!previous || (isClosed(previous) && !isClosed(job))
      || (isClosed(previous) === isClosed(job) && job.createdAt > previous.createdAt)) jobs.set(key, job)
  }
  const groups = new Map<string, Array<{ vehicle: Vehicle; job?: RepairJob }>>()
  for (const vehicle of data.vehicles) {
    if (isVehicleStatusSemantic(settings, vehicle.status, 'delivered') || isVehicleStatusSemantic(settings, vehicle.status, 'cancelled')) continue
    const job = jobs.get(vehicle.id) ?? jobs.get(normalizePlate(vehicle.plate))
    if (job && isClosed(job)) continue
    if (vehicle.coneNumber == null && !job && !vehicle.entryDate && !accepted.has(vehicle.id)) continue
    const group = groups.get(vehicle.customerId) ?? []
    group.push({ vehicle, job })
    groups.set(vehicle.customerId, group)
  }
  const customers = new Map(data.customers.map(customer => [customer.id, customer.name]))
  const tasks = new Map<string, OperatorProgramTask[]>()
  for (const program of data.operatorPrograms ?? []) for (const task of program.tasks) {
    const list = tasks.get(task.jobId) ?? []
    list.push(task)
    tasks.set(task.jobId, list)
  }
  const rows = [...groups].sort(([a], [b]) => (customers.get(a) ?? '').localeCompare(customers.get(b) ?? '', 'it'))

  return <section className="panel cone-customer-summary" aria-labelledby="cone-customer-title">
    <div className="panel-head"><div><span className="eyebrow">RIEPILOGO OFFICINA</span><h3 id="cone-customer-title">Vetture in carrozzeria per cliente</h3></div>
      <small>{rows.length} clienti · {[...groups.values()].reduce((count, group) => count + group.length, 0)} vetture</small>
    </div>
    {!rows.length ? <p>Nessuna vettura presente.</p> : <div className="cone-customer-scroll"><table>
      <thead><tr><th scope="col">Cliente</th><th scope="col">Vetture</th><th scope="col">Dettaglio vetture</th></tr></thead>
      <tbody>{rows.map(([customerId, group]) => <tr key={customerId}>
        <th scope="row">{customers.get(customerId) || 'Cliente non indicato'}</th>
        <td>{group.length}</td>
        <td><ul className="cone-customer-vehicles">{group.sort((a, b) => (a.vehicle.coneNumber ?? Infinity) - (b.vehicle.coneNumber ?? Infinity)
          || a.vehicle.plate.localeCompare(b.vehicle.plate)).map(({ vehicle, job }) => {
          const waiting = isVehicleWaitingForParts(settings, vehicle)
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
          const status = waiting ? 'In attesa ricambi' : ready ? vehicleLabel : job?.status || vehicleLabel
          return <li key={vehicle.id} className={waiting ? 'waiting-parts' : undefined}>
            <div><strong>{vehicle.plate}</strong><small>{vehicle.coneNumber == null ? 'Senza cono' : `Cono ${vehicle.coneNumber}`}</small></div>
            <div><strong>{status}</strong>
              {!waiting && currentPhase && <small>{currentPhase.name}</small>}</div>
            <div><small>{actualStart ? 'Inizio effettivo' : 'Inizio previsto'}</small>{dateLabel(actualStart || plannedStart)}</div>
            <div><small>{actualEnd ? 'Fine effettiva' : 'Fine prevista'}</small>{dateLabel(actualEnd || plannedEnd)}</div>
            <div className={timers.length ? 'cone-timer-active' : undefined}>{timers.length ? <><strong>Timer attivo</strong><small>{timers.join(', ')}</small></> : <small>Timer fermo</small>}</div>
          </li>
        })}</ul></td>
      </tr>)}</tbody>
    </table></div>}
  </section>
}
