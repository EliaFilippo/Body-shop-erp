import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '../../components/Modal'
import { CapacityBar } from '../../components/CapacityBar'
import { TrafficLight } from '../../components/TrafficLight'
import { isVehicleWaitingForCone } from '../../services/erp'
import { addDays, buildPlannerQueue, calculatePlanner, capacityWithAssignments, parseDate, todayKey } from '../../services/planner'
import { workflowOperationalSnapshot } from '../../services/workflow'
import type { Customer, ErpData, JobPhase, RepairJob, Vehicle } from '../../types'
import type { PlannerQueueItem } from '../../services/planner'

const mondayOf = (value: string) => {
  const date = parseDate(value)
  const day = date.getUTCDay() || 7
  return addDays(value, 1 - day)
}

const shortDate = (value: string) => new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
}).format(parseDate(value))

const shortDateTime = (value: string) => new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
}).format(new Date(value))

const formatHours = (value: number) => `${Math.max(0, Math.round(value * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} h`

const formatMinutes = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString('it-IT')} min`

const coneLabel = (vehicle: Vehicle) => {
  if (vehicle.coneNumber !== null) return `Cono ${vehicle.coneNumber}`
  return isVehicleWaitingForCone(vehicle) ? 'In attesa cono (Nessun cono disponibile)' : '—'
}

const unique = (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))

type PlannerVehicleDetailRow = {
  phase: JobPhase
  taskStartAt: string
  taskEndAt: string
  nextPhaseAvailableAt: string
  plannedMinutes: number
  technicalWaitMinutes: number
  panelNames: string[]
  operatorNames: string[]
  panelNotes: string[]
  taskCount: number
  reason: string
  isCurrent: boolean
}

type PlannerVehicleDetail = {
  vehicle: Vehicle
  customer?: Customer
  job?: RepairJob
  plan?: ReturnType<typeof calculatePlanner>['vehicles'][number]
  queueEntry?: PlannerQueueItem
  workflow?: ReturnType<typeof workflowOperationalSnapshot>
  phaseRows: PlannerVehicleDetailRow[]
  requestedDeliveryDate: string
  calculatedDeliveryDate: string
  estimatedHours: number
  workedHours: number
  residualHours: number
  progressPercent: number
  deliveryReason: string
  firstRealisticDate: string
}

function sortByPhaseOrder(a: JobPhase, b: JobPhase, indexA: number, indexB: number) {
  return (Number(a.cycleOrder ?? 999) - Number(b.cycleOrder ?? 999)) || indexA - indexB
}

function PlannerVehicleDetailModal({
  detail,
  onClose,
  onOpenJob,
  onOpenOperatorProgram,
  onRecalculatePlanning,
  onUpdateVehicleStatus,
  statusOptions,
  statusLabel,
}: {
  detail: PlannerVehicleDetail
  onClose: () => void
  onOpenJob: (query: string) => void
  onOpenOperatorProgram: () => void
  onRecalculatePlanning: () => void
  onUpdateVehicleStatus: (vehicleId: string, status: string) => void
  statusOptions: Array<{ id: string; label: string }>
  statusLabel: (status: string) => string
}) {
  const { vehicle, customer, job, plan, queueEntry, workflow, phaseRows } = detail
  const warningReason = detail.deliveryReason || queueEntry?.reason || 'Da verificare'
  const hasWarning = plan?.status === 'red'

  return <Modal title="Dettaglio pianificazione vettura" onClose={onClose} className="planner-detail-modal">
    <div className="planner-detail-body">
      <section className="planner-detail-summary-grid">
        <article className="planner-detail-card">
          <span>Cliente</span>
          <strong>{customer?.name || '—'}</strong>
        </article>
        <article className="planner-detail-card">
          <span>Targa</span>
          <strong className="plate">{vehicle.plate}</strong>
        </article>
        <article className="planner-detail-card">
          <span>Commessa</span>
          <strong>{job?.number || '—'}</strong>
        </article>
        <article className="planner-detail-card">
          <span>Stato</span>
          <strong>{job?.status || vehicle.status}</strong>
        </article>
        <article className="planner-detail-card">
          <span>Cono</span>
          <strong>{coneLabel(vehicle)}</strong>
        </article>
        <article className="planner-detail-card">
          <span>Consegna richiesta</span>
          <strong>{detail.requestedDeliveryDate || 'Non indicata'}</strong>
        </article>
        <article className="planner-detail-card">
          <span>Consegna calcolata</span>
          <strong>{detail.calculatedDeliveryDate || 'Non calcolabile'}</strong>
        </article>
        <article className="planner-detail-card">
          <span>Ore preventivate</span>
          <strong>{formatHours(detail.estimatedHours)}</strong>
        </article>
        <article className="planner-detail-card">
          <span>Ore completate</span>
          <strong>{formatHours(detail.workedHours)}</strong>
        </article>
        <article className="planner-detail-card">
          <span>Ore residue</span>
          <strong>{formatHours(detail.residualHours)}</strong>
        </article>
        <article className="planner-detail-card">
          <span>Avanzamento</span>
          <strong>{Math.round(detail.progressPercent)}%</strong>
        </article>
      </section>

      {hasWarning && <section className="planner-detail-warning">
        <span>Data non rispettabile</span>
        <strong>Perché? {warningReason}</strong>
        <small>Prima data realistica: {detail.firstRealisticDate || plan?.suggestedDate || 'Non disponibile'}</small>
      </section>}

      <section className="planner-detail-actions">
        <select value={vehicle.status} onChange={(event) => onUpdateVehicleStatus(vehicle.id, event.target.value)}>
          {(statusOptions.some((status) => status.id === vehicle.status) ? statusOptions : [...statusOptions, { id: vehicle.status, label: statusLabel(vehicle.status) }]).map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
        </select>
        <button className="primary" onClick={() => { onClose(); onOpenJob(job?.number || vehicle.plate) }}>Apri commessa</button>
        <button className="secondary" onClick={() => { onClose(); onOpenOperatorProgram() }}>Apri programma operatori</button>
        <button className="secondary" onClick={() => { onClose(); onRecalculatePlanning() }}>Ricalcola pianificazione</button>
      </section>

      <section className="planner-detail-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">SEQUENZA CRONOLOGICA</span>
            <h3>Lavorazioni, tempi e disponibilita</h3>
          </div>
          <div className="planner-detail-mini-meta">
            <span>Fase corrente</span>
            <strong>{workflow?.currentPhase || '—'}</strong>
          </div>
        </div>
        <div className="planner-detail-phase-list">
          {phaseRows.map((phaseRow, index) => <article className={`planner-detail-phase ${phaseRow.isCurrent ? 'current' : ''}`} key={phaseRow.phase.id}>
            <div className="planner-detail-phase-head">
              <div>
                <strong>{index + 1}. {phaseRow.phase.name}</strong>
                <small>{phaseRow.taskCount > 0 ? `${phaseRow.taskCount} task schedulati` : 'Nessun task schedulato'}</small>
              </div>
              <span className={`tag phase-tag phase-tag-${phaseRow.phase.status.toLowerCase().replace(/\s+/g, '-')}`}>{phaseRow.phase.status}</span>
            </div>
            <div className="planner-detail-time-grid">
              <div className="planner-detail-time-box work">
                <span>TEMPO LAVORAZIONE</span>
                <strong>{formatMinutes(phaseRow.plannedMinutes)}</strong>
              </div>
              <div className="planner-detail-time-box wait">
                <span>TEMPO TECNICO / ATTESA</span>
                <strong>{phaseRow.technicalWaitMinutes > 0 ? formatMinutes(phaseRow.technicalWaitMinutes) : '0 min'}</strong>
              </div>
            </div>
            <div className="planner-detail-meta-grid">
              <div>
                <span>Pannello interessato</span>
                <strong>{phaseRow.panelNames.length ? phaseRow.panelNames.join(', ') : '—'}</strong>
              </div>
              <div>
                <span>Operatori assegnati</span>
                <strong>{phaseRow.operatorNames.length ? phaseRow.operatorNames.join(', ') : '—'}</strong>
              </div>
              <div>
                <span>Inizio previsto</span>
                <strong>{phaseRow.taskStartAt ? shortDateTime(phaseRow.taskStartAt) : '—'}</strong>
              </div>
              <div>
                <span>Fine prevista</span>
                <strong>{phaseRow.taskEndAt ? shortDateTime(phaseRow.taskEndAt) : '—'}</strong>
              </div>
              <div>
                <span>Prima disponibilità fase successiva</span>
                <strong>{phaseRow.nextPhaseAvailableAt ? shortDateTime(phaseRow.nextPhaseAvailableAt) : '—'}</strong>
              </div>
              <div>
                <span>Motivo</span>
                <strong>{phaseRow.reason}</strong>
              </div>
              {!!phaseRow.panelNotes.length && <div className="full">
                <span>Note pannello</span>
                <strong>{phaseRow.panelNotes.join(' | ')}</strong>
              </div>}
            </div>
          </article>)}
          {!phaseRows.length && <div className="empty">Nessuna fase disponibile per questa commessa.</div>}
        </div>
      </section>
    </div>
  </Modal>
}

export function PlannerPage({ data, customerById, onMove, onOpenSettings, onOpenJob, onOpenOperatorProgram, onRecalculatePlanning, onUpdateVehicleStatus, statusOptions, statusLabel }: {
  data: ErpData
  customerById: (id: string) => Customer | undefined
  onMove: (vehicleId: string, date: string) => void
  onOpenSettings: () => void
  onOpenJob?: (query: string) => void
  onOpenOperatorProgram?: () => void
  onRecalculatePlanning?: () => void
  onUpdateVehicleStatus: (vehicleId: string, status: string) => void
  statusOptions: Array<{ id: string; label: string }>
  statusLabel: (status: string) => string
}) {
  const [week, setWeek] = useState(mondayOf(todayKey()))
  const [draggedVehicleId, setDraggedVehicleId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)

  const result = useMemo(() => calculatePlanner(data.vehicles, data.plannerSettings), [data.vehicles, data.plannerSettings])
  const queue = useMemo(() => buildPlannerQueue(data, todayKey()), [data])
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index))

  useEffect(() => {
    if (!selectedVehicleId) return
    if (data.vehicles.some((vehicle) => vehicle.id === selectedVehicleId)) return
    setSelectedVehicleId(null)
  }, [data.vehicles, selectedVehicleId])

  const programAssignments = useMemo(() => {
    const daySet = new Set(days)
    const aggregate = new Map<string, {
      vehicleId: string
      date: string
      plannedMinutes: number
      operatorNames: string[]
      timeSlots: string[]
    }>()

    for (const program of data.operatorPrograms ?? []) {
      if (!daySet.has(program.date)) continue
      for (const task of program.tasks ?? []) {
        const vehicleId = String(task.vehicleId ?? '').trim()
        if (!vehicleId) continue
        const key = `${program.date}|${vehicleId}`
        const current = aggregate.get(key) ?? {
          vehicleId,
          date: program.date,
          plannedMinutes: 0,
          operatorNames: [],
          timeSlots: [],
        }
        current.plannedMinutes += Math.max(0, Number(task.plannedMinutes ?? 0))
        current.operatorNames.push(task.operatorName)
        current.timeSlots.push(`${task.startAt.slice(11, 16)}-${task.endAt.slice(11, 16)}`)
        aggregate.set(key, current)
      }
    }

    return Array.from(aggregate.values()).map((item) => ({
      ...item,
      plannedHours: Math.round((item.plannedMinutes / 60) * 100) / 100,
      operatorNames: Array.from(new Set(item.operatorNames.filter(Boolean))),
      timeSlots: Array.from(new Set(item.timeSlots.filter(Boolean))),
    }))
  }, [data.operatorPrograms, days])

  const vehicleResult = useCallback((id: string) => result.vehicles.find((item) => item.vehicleId === id), [result.vehicles])
  const linkedJobByVehicle = useCallback((vehicleId: string) => (data.jobs ?? []).find((job) => job.vehicleId === vehicleId && job.status !== 'Annullata' && job.status !== 'Consegnata'), [data.jobs])

  const plannedVehicles = data.vehicles.filter((vehicle) => {
    if (vehicle.status === 'Consegnata') return false
    const linked = linkedJobByVehicle(vehicle.id)
    return linked ? true : vehicle.estimatedHours > vehicle.workedHours
  })

  const nonSchedulable = queue.filter((item) => !item.schedulable)
  const schedulable = queue.filter((item) => item.schedulable)

  const selectedVehicleDetail = useMemo<PlannerVehicleDetail | null>(() => {
    if (!selectedVehicleId) return null
    const vehicle = data.vehicles.find((item) => item.id === selectedVehicleId)
    if (!vehicle) return null
    const job = linkedJobByVehicle(vehicle.id)
    const customer = customerById(vehicle.customerId)
    const plan = vehicleResult(vehicle.id)
    const queueEntry = job ? queue.find((item) => item.jobId === job.id) : queue.find((item) => item.vehicleId === vehicle.id)
    const workflow = job ? workflowOperationalSnapshot(job) : undefined
    const operatorTasks = (data.operatorPrograms ?? []).flatMap((program) => program.tasks ?? []).filter((task) => task.vehicleId === vehicle.id || task.jobId === job?.id)
    const orderedPhases = [...(job?.phases ?? [])].sort((a, b) => sortByPhaseOrder(a, b, (job?.phases ?? []).indexOf(a), (job?.phases ?? []).indexOf(b)))
    const phaseRows = orderedPhases.map((phase, index) => {
      const taskRows = operatorTasks.filter((task) => task.phaseId === phase.id).sort((a, b) => a.startAt.localeCompare(b.startAt) || a.operatorName.localeCompare(b.operatorName, 'it-IT'))
      const nextPhase = orderedPhases[index + 1]
      const nextPhaseTasks = nextPhase ? operatorTasks.filter((task) => task.phaseId === nextPhase.id).sort((a, b) => a.startAt.localeCompare(b.startAt)) : []
      const linePanels = unique((job?.lines ?? [])
        .filter((line) => String(line.categoryOrPhase ?? '').trim().toLowerCase() === phase.name.trim().toLowerCase())
        .flatMap((line) => [String(line.panelName ?? '').trim(), String(line.description ?? '').trim()]))
      const taskPanelNames = unique(taskRows.flatMap((task) => task.panelNames ?? []))
      const panelNotes = unique(taskRows.flatMap((task) => task.panelNotes ?? []))
      const plannedMinutes = taskRows.reduce((sum, task) => sum + Math.max(0, Number(task.plannedMinutes ?? 0)), 0) || Math.max(0, Number(phase.estimatedMinutes ?? 0))
      const technicalWaitMinutes = Math.max(0, Number(phase.technicalWaitMinutes ?? 0))
      const taskStartAt = taskRows[0]?.startAt || phase.startedAt || ''
      const taskEndAt = taskRows.at(-1)?.endAt || phase.endedAt || ''
      const nextPhaseAvailableAt = nextPhaseTasks[0]?.startAt || (taskEndAt && technicalWaitMinutes > 0 ? new Date(new Date(taskEndAt).getTime() + technicalWaitMinutes * 60_000).toISOString() : '')
      const operatorNames = unique(taskRows.map((task) => task.operatorName))
      const reason = taskRows[0]?.reason || phase.blockedReason || (phase.status === 'Completata' ? 'Fase completata' : phase.status === 'In lavorazione' ? 'Fase in corso' : 'Da pianificare')
      return {
        phase,
        taskStartAt,
        taskEndAt,
        nextPhaseAvailableAt,
        plannedMinutes,
        technicalWaitMinutes,
        panelNames: unique([...taskPanelNames, ...linePanels]),
        operatorNames,
        panelNotes,
        taskCount: taskRows.length,
        reason,
        isCurrent: workflow?.currentPhase === phase.name,
      }
    })
    const estimatedHours = Math.max(0, Number(vehicle.estimatedHours ?? 0))
    const workedHours = Math.max(0, Number(vehicle.workedHours ?? 0))
    const residualHours = Math.max(0, estimatedHours - workedHours)
    const requestedDeliveryDate = vehicle.requestedDeliveryDate || job?.expectedDeliveryDate || ''
    const calculatedDeliveryDate = plan?.calculatedDeliveryDate || vehicle.calculatedDeliveryDate || ''
    const progressPercent = workflow?.progressPercent ?? job?.progressPercent ?? 0
    const deliveryReason = plan?.status === 'red'
      ? queueEntry?.reason && queueEntry.reason !== 'Schedulabile'
        ? queueEntry.reason
        : `Mancano ${formatHours(plan.missingHours || residualHours)} rispetto alla consegna richiesta`
      : queueEntry?.schedulable === false
        ? queueEntry.reason
        : ''
    const firstRealisticDate = plan?.suggestedDate || queueEntry?.availableFrom || calculatedDeliveryDate || requestedDeliveryDate
    return {
      vehicle,
      customer,
      job,
      plan,
      queueEntry,
      workflow,
      phaseRows,
      requestedDeliveryDate,
      calculatedDeliveryDate,
      estimatedHours,
      workedHours,
      residualHours,
      progressPercent,
      deliveryReason,
      firstRealisticDate,
    }
  }, [customerById, data.operatorPrograms, data.vehicles, linkedJobByVehicle, queue, selectedVehicleId, vehicleResult])

  const handleDrop = (date: string) => {
    if (!draggedVehicleId) return
    onMove(draggedVehicleId, date)
    setDraggedVehicleId(null)
    setDropTarget(null)
  }

  const openVehicleDetail = (vehicleId: string) => setSelectedVehicleId(vehicleId)

  return <>
    <section className="welcome">
      <div>
        <span className="eyebrow">PIANIFICAZIONE REALE</span>
        <h2>Planner intelligente</h2>
        <p>Capacita protetta, saturazione e consegne vengono ricalcolate dopo ogni modifica.</p>
      </div>
      <div className="planner-actions">
        <button className="secondary" onClick={() => setWeek(addDays(week, -7))}>← Settimana</button>
        <button className="secondary" onClick={() => setWeek(mondayOf(todayKey()))}>Oggi</button>
        <button className="secondary" onClick={() => setWeek(addDays(week, 7))}>Settimana →</button>
        <button className="primary" onClick={onOpenSettings}>Impostazioni</button>
      </div>
    </section>

    {!data.plannerSettings.operators.length && <div className="toast warning">Configura almeno un operatore: senza ore lavorabili non e possibile calcolare una consegna.</div>}

    <section className="week-grid">
      {days.map((date) => {
        const capacity = capacityWithAssignments(date, data.plannerSettings, result.assignments)
        const plannerAssignments = result.assignments.filter((item) => item.date === date)
        const fallbackAssignments = programAssignments
          .filter((item) => item.date === date)
          .filter((item) => !plannerAssignments.some((assignment) => assignment.vehicleId === item.vehicleId))

        const dailyAssignments = [
          ...plannerAssignments.map((assignment) => ({
            vehicleId: assignment.vehicleId,
            hours: assignment.protectedHours,
            fromProgram: false,
            operatorNames: [] as string[],
            timeSlots: [] as string[],
          })),
          ...fallbackAssignments.map((assignment) => ({
            vehicleId: assignment.vehicleId,
            hours: assignment.plannedHours,
            fromProgram: true,
            operatorNames: assignment.operatorNames,
            timeSlots: assignment.timeSlots,
          })),
        ]

        return <article
          className={`day-card ${capacity.protected === 0 ? 'closed' : ''} ${dropTarget === date ? 'drop-target' : ''}`}
          key={date}
          onDragOver={(event) => {
            event.preventDefault()
            setDropTarget(date)
          }}
          onDrop={() => handleDrop(date)}
        >
          <div className="day-head">
            <strong>{shortDate(date)}</strong>
            <span>{capacity.protected === 0 ? 'Chiuso' : `${capacity.committed}/${capacity.protected} h`}</span>
          </div>
          <CapacityBar percent={capacity.saturation} overload={capacity.overload} />
          <small>{capacity.remaining} h disponibili · capacita normale {capacity.normal} h</small>
          <div className="day-jobs">
            {dailyAssignments.map((assignment) => {
              const vehicle = data.vehicles.find((item) => item.id === assignment.vehicleId)
              if (!vehicle) return null
              const plan = vehicleResult(vehicle.id)
              const linkedJob = linkedJobByVehicle(vehicle.id)
              const workflow = linkedJob ? workflowOperationalSnapshot(linkedJob) : null
              return <button
                aria-label={`Dettaglio pianificazione ${vehicle.plate}`}
                className="day-job planner-job-button"
                type="button"
                onClick={() => openVehicleDetail(vehicle.id)}
                draggable
                onDragStart={() => setDraggedVehicleId(vehicle.id)}
                onDragEnd={() => {
                  setDraggedVehicleId(null)
                  setDropTarget(null)
                }}
                key={`${assignment.vehicleId}-${date}`}
              >
                <strong className="plate">{vehicle.plate}</strong>
                <span>{assignment.hours} h · {vehicle.priority ?? 'Normale'}</span>
                <small>{customerById(vehicle.customerId)?.name}</small>
                {linkedJob && <small>{linkedJob.number} · fase {workflow?.currentPhase}</small>}
                <small>{coneLabel(vehicle)}</small>
                {assignment.fromProgram && <small>Da Programma operatori</small>}
                {assignment.timeSlots.length ? <small>Orari: {assignment.timeSlots.join(', ')}</small> : null}
                {assignment.operatorNames.length ? <small>Operatori: {assignment.operatorNames.join(', ')}</small> : null}
                {workflow?.activeOperators?.length ? <small>Operatori attivi: {workflow.activeOperators.join(', ')}</small> : null}
                <TrafficLight status={plan?.status ?? 'neutral'} />
              </button>
            })}
          </div>
        </article>
      })}
    </section>

    <section className="panel table-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">CONSEGNE E BLOCCHI</span>
          <h3>Vetture pianificate</h3>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Vettura</th>
              <th>Ore</th>
              <th>Cono</th>
                <th>Stato vettura</th>
                <th>Consegna richiesta</th>
              <th>Consegna calcolata</th>
              <th>Responso</th>
              <th>Pianificabilita</th>
              <th>Sposta lavorazione</th>
            </tr>
          </thead>
          <tbody>
            {plannedVehicles.map((vehicle) => {
              const plan = vehicleResult(vehicle.id)
              const linkedJob = linkedJobByVehicle(vehicle.id)
              const queueEntry = queue.find((item) => item.vehicleId === vehicle.id)
              const workflow = linkedJob ? workflowOperationalSnapshot(linkedJob) : null
              const remaining = Math.max(0, vehicle.estimatedHours - vehicle.workedHours)
              return <tr className={plan?.blocked ? 'blocked-row' : ''} key={vehicle.id}>
                <td>
                  <button className="planner-link-button plate" onClick={() => openVehicleDetail(vehicle.id)}>{vehicle.plate}</button>
                  <small>{plan?.blocked ? `Bloccata: ${vehicle.blockReason || 'ricambi mancanti'}` : `${vehicle.make} ${vehicle.model}`}</small>
                  {linkedJob && <small>{linkedJob.number} · fase {workflow?.currentPhase}</small>}
                </td>
                <td>{remaining} h</td>
                <td>{coneLabel(vehicle)}</td>
                <td><select value={vehicle.status} onChange={(event) => onUpdateVehicleStatus(vehicle.id, event.target.value)}>{(statusOptions.some((status) => status.id === vehicle.status) ? statusOptions : [...statusOptions, { id: vehicle.status, label: statusLabel(vehicle.status) }]).map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></td>
                <td>{vehicle.requestedDeliveryDate || 'Non indicata'}</td>
                <td>{plan?.calculatedDeliveryDate || 'Non calcolabile'}</td>
                <td>
                  <TrafficLight status={plan?.status ?? 'neutral'} />
                  {plan?.status === 'red' && <small>Mancano {plan.missingHours} h · ritardo {plan.delayWorkingDays} giorni · consigliata {plan.suggestedDate}</small>}
                </td>
                <td>
                  <strong>{queueEntry?.schedulable ? 'Schedulabile' : 'Da pianificare'}</strong>
                  {!queueEntry?.schedulable && <small>{queueEntry?.reason || 'Da verificare'}</small>}
                </td>
                <td>
                  <input
                    aria-label={`Sposta ${vehicle.plate}`}
                    type="date"
                    value={vehicle.manualPlanningDate}
                    onChange={(event) => onMove(vehicle.id, event.target.value)}
                    disabled={plan?.blocked}
                  />
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    </section>

    <section className="panel table-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">DA PIANIFICARE</span>
          <h3>Da pianificare / Non pianificabile</h3>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Commessa</th>
              <th>Vettura</th>
              <th>Fase</th>
              <th>Stato</th>
              <th>Esito</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {[...schedulable, ...nonSchedulable].map((item) => <tr key={item.jobId}>
              <td><strong>{item.jobNumber}</strong></td>
              <td><strong className="plate">{item.plate || '—'}</strong></td>
              <td>{item.phaseName}</td>
              <td>{item.status}</td>
              <td>{item.schedulable ? 'Schedulabile' : 'Non pianificabile'}</td>
              <td>{item.reason}{item.availableFrom ? ` · disponibile dal ${item.availableFrom}` : ''}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {!queue.length && <div className="empty">Nessuna commessa aperta.</div>}
    </section>

      {selectedVehicleDetail && <PlannerVehicleDetailModal
        detail={selectedVehicleDetail}
        onClose={() => setSelectedVehicleId(null)}
        onOpenJob={(query) => {
          onOpenJob?.(query)
          setSelectedVehicleId(null)
        }}
        onOpenOperatorProgram={() => {
          onOpenOperatorProgram?.()
          setSelectedVehicleId(null)
        }}
        onRecalculatePlanning={() => {
          onRecalculatePlanning?.()
          setSelectedVehicleId(null)
        }}
        onUpdateVehicleStatus={onUpdateVehicleStatus}
        statusOptions={statusOptions}
        statusLabel={statusLabel}
      />}
  </>
}
