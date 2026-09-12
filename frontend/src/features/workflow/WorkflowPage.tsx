import { useEffect, useMemo, useRef, useState, type FormEvent, type TouchEvent, type WheelEvent } from 'react'
import { Modal } from '../../components/Modal'
import { MoneyInput } from '../../components/MoneyInput'
import type { Customer, ErpData, EstimateDocument, EstimateLine, EstimateStatus, JobPhase, JobPhaseStatus, JobStatus, RepairJob, WorkCategory } from '../../types'
import { loadDatabase, saveDatabase } from '../../services/database'
import {
  WORK_CATEGORIES,
  approveEstimateAndCreateJob,
  calculateJobKpis,
  createDirectJob,
  computeLineInternalEconomics,
  createEstimate,
  estimateLineTotalMinutes,
  estimatePhaseTotals,
  estimateVehicleTotalMinutes,
  estimateFinancialStage,
  confirmEstimateAndCreateJobTransactional,
  findJobCurrentPhase,
  resolvePriceListItem,
  resolvePriceListVariants,
  resolveStandardRuleForLine,
  syncJobsWithVehicles,
  toggleJobChecklistItem,
  updateEstimate,
  updateEstimateStatus,
  updateJobMeta,
  updateJobPhase,
  updateJobPhaseEstimatedMinutes,
  updateJobPhaseOperators,
  updateJobStatus,
  updateQualityChecklistTemplates,
  workTypeTimeComparison,
} from '../../services/workflow'
import { simulateEstimateProductionForecast } from '../../services/planner'

const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })

const coneLabelForJob = (job: RepairJob) => {
  if (job.coneNumber !== null) return String(job.coneNumber)
  const waitingStatuses: JobStatus[] = ['In lavorazione', 'In attesa', 'Controllo qualità', 'Pronta consegna']
  return waitingStatuses.includes(job.status) ? 'In attesa cono (Nessun cono disponibile)' : '—'
}

const marginStatusLabel = (value?: EstimateLine['marginStatus']) => {
  if (value === 'ok') return 'OK'
  if (value === 'low') return 'Margine basso'
  if (value === 'loss') return 'In perdita'
  return 'Prezzo zero'
}

type WorkflowModal =
  | { type: 'estimate-create' }
  | { type: 'estimate-edit'; estimateId: string }
  | { type: 'job-create' }
  | { type: 'job-edit'; jobId: string }
  | { type: 'checklist-templates' }

type VehicleViewId = 'top' | 'left' | 'right'

type ExplodedPanelDefinition = {
  id: string
  name: string
  view: VehicleViewId
  path: string
  badgeX: number
  badgeY: number
}

const PANEL_CATALOG: ExplodedPanelDefinition[] = [
  { id: 'paraurti-posteriore', name: 'Paraurti posteriore', view: 'top', path: 'M36 8 Q50 3 64 8 L60 13 Q50 10 40 13 Z', badgeX: 50, badgeY: 7 },
  { id: 'portellone-posteriore', name: 'Portellone/cofano posteriore', view: 'top', path: 'M31 13 Q50 7 69 13 L64 27 Q50 23 36 27 Z', badgeX: 50, badgeY: 18 },
  { id: 'tetto', name: 'Tetto', view: 'top', path: 'M30 28 Q50 24 70 28 L67 50 Q50 54 33 50 Z', badgeX: 50, badgeY: 40 },
  { id: 'cofano', name: 'Cofano', view: 'top', path: 'M34 50 Q50 55 66 50 L61 66 Q50 70 39 66 Z', badgeX: 50, badgeY: 60 },
  { id: 'paraurti-anteriore', name: 'Paraurti anteriore', view: 'top', path: 'M39 66 Q50 71 61 66 L58 73 Q50 76 42 73 Z', badgeX: 50, badgeY: 71 },
  { id: 'parafango-ant-sx', name: 'Parafango anteriore SX', view: 'left', path: 'M16 46 L24 34 L31 35 L29 49 L22 55 L16 54 Z', badgeX: 22, badgeY: 43 },
  { id: 'porta-ant-sx', name: 'Porta anteriore SX', view: 'left', path: 'M31 35 L46 35 L46 57 L30 57 Z', badgeX: 38, badgeY: 45 },
  { id: 'porta-post-sx', name: 'Porta posteriore SX', view: 'left', path: 'M46 35 L60 35 L61 57 L46 57 Z', badgeX: 53, badgeY: 45 },
  { id: 'montante-sup-sx', name: 'Montante superiore SX', view: 'left', path: 'M34 33 L62 33 L66 35 L40 35 Z', badgeX: 50, badgeY: 31 },
  { id: 'sottoporta-sx', name: 'Sottoporta SX', view: 'left', path: 'M30 57 L63 57 L61 62 L32 62 Z', badgeX: 47, badgeY: 60 },
  { id: 'rear-fender-left', name: 'Parafango posteriore SX', view: 'left', path: 'M72 46 L80 41 L84 50 L80 58 L71 58 L69 51 Z', badgeX: 77, badgeY: 51 },
  { id: 'wheel-front-sx', name: 'Cerchio anteriore SX', view: 'left', path: 'M22 61 A6 6 0 1 0 34 61 A6 6 0 1 0 22 61 Z', badgeX: 28, badgeY: 65 },
  { id: 'wheel-rear-sx', name: 'Cerchio posteriore SX', view: 'left', path: 'M66 61 A6 6 0 1 0 78 61 A6 6 0 1 0 66 61 Z', badgeX: 72, badgeY: 65 },
  { id: 'parafango-ant-dx', name: 'Parafango anteriore DX', view: 'right', path: 'M84 46 L76 34 L69 35 L71 49 L78 55 L84 54 Z', badgeX: 78, badgeY: 43 },
  { id: 'porta-ant-dx', name: 'Porta anteriore DX', view: 'right', path: 'M69 35 L54 35 L54 57 L70 57 Z', badgeX: 62, badgeY: 45 },
  { id: 'porta-post-dx', name: 'Porta posteriore DX', view: 'right', path: 'M54 35 L40 35 L39 57 L54 57 Z', badgeX: 47, badgeY: 45 },
  { id: 'montante-sup-dx', name: 'Montante superiore DX', view: 'right', path: 'M66 33 L38 33 L34 35 L60 35 Z', badgeX: 50, badgeY: 31 },
  { id: 'sottoporta-dx', name: 'Sottoporta DX', view: 'right', path: 'M70 57 L37 57 L39 62 L68 62 Z', badgeX: 53, badgeY: 60 },
  { id: 'rear-fender-right', name: 'Parafango posteriore DX', view: 'right', path: 'M28 46 L20 41 L16 50 L20 58 L29 58 L31 51 Z', badgeX: 23, badgeY: 51 },
  { id: 'wheel-front-dx', name: 'Cerchio anteriore DX', view: 'right', path: 'M66 61 A6 6 0 1 0 78 61 A6 6 0 1 0 66 61 Z', badgeX: 72, badgeY: 65 },
  { id: 'wheel-rear-dx', name: 'Cerchio posteriore DX', view: 'right', path: 'M22 61 A6 6 0 1 0 34 61 A6 6 0 1 0 22 61 Z', badgeX: 28, badgeY: 65 },
]

const SIDE_MAIN_PANEL_IDS = {
  sx: ['parafango-ant-sx', 'porta-ant-sx', 'porta-post-sx', 'rear-fender-left'],
  dx: ['parafango-ant-dx', 'porta-ant-dx', 'porta-post-dx', 'rear-fender-right'],
} as const

const panelSideFromId = (panelId: string): '' | 'sx' | 'dx' | 'center' => {
  if (panelId.endsWith('-sx') || panelId.endsWith('-left')) return 'sx'
  if (panelId.endsWith('-dx') || panelId.endsWith('-right')) return 'dx'
  return 'center'
}

const VIEW_LABELS: Array<{ id: VehicleViewId; label: string; tabLabel: string }> = [
  { id: 'left', label: 'Laterale sinistra', tabLabel: 'Sinistra' },
  { id: 'right', label: 'Laterale destra', tabLabel: 'Destra' },
  { id: 'top', label: 'Vista dall\'alto', tabLabel: 'Alto' },
]

const VIEW_BOX_BY_VIEW: Record<VehicleViewId, string> = {
  top: '22 1 56 78',
  left: '6 20 88 46',
  right: '6 20 88 46',
}

const MIN_ZOOM = 0.8
const MAX_ZOOM = 2.2

function normalizePanelName(value: string) {
  return value.trim().toLowerCase()
}

function emptyLine(): EstimateLine {
  return {
    id: crypto.randomUUID(),
    description: '',
    panelId: '',
    panelName: '',
    panelSide: '',
    repairExtent: 'intero',
    panelWorkNote: '',
    vehicleSizeClass: '',
    colorFamily: '',
    paintCycle: '',
    standardWorkId: '',
    category: 'carrozzeria',
    standardWorkName: '',
    categoryOrPhase: '',
    calculationType: 'per-vehicle',
    standardMinutes: 0,
    estimatedMinutes: 60,
    lineTotalMinutes: 60,
    manualTimeOverride: false,
    appliedRuleId: '',
    appliedRuleName: '',
    appliedRuleSummary: '',
    requiredSkill: '',
    cycleOrder: 999,
    quantity: 1,
    unitPrice: 0,
    discount: 0,
    taxableAmount: 0,
    vatRate: 22,
    vatAmount: 0,
    total: 0,
  }
}

type EditableLine = Omit<EstimateLine, 'taxableAmount' | 'vatAmount' | 'total'>

function linePreview(line: EstimateLine) {
  const taxable = Math.max(0, line.quantity * line.unitPrice - line.discount)
  const vat = taxable * (line.vatRate / 100)
  return {
    taxable,
    vat,
    total: taxable + vat,
  }
}

const ESTIMATE_STATUSES: EstimateStatus[] = ['Bozza', 'Inviato', 'In attesa conferma', 'Approvato', 'Rifiutato', 'Scaduto']
const JOB_STATUSES: JobStatus[] = ['Da pianificare', 'Pianificata', 'In lavorazione', 'In attesa', 'Controllo qualità', 'Pronta consegna', 'Consegnata', 'Annullata']

function humanDuration(minutes: number) {
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  if (!hours) return `${rest} min`
  return `${hours} h ${String(rest).padStart(2, '0')} min`
}

function dateTime(value?: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function phaseActiveOperators(phase: JobPhase) {
  return Array.from(new Set((phase.operatorAssignments ?? [])
    .filter((item) => item.activityStatus === 'Attivo' && !item.endedAt)
    .map((item) => item.operatorName)
    .filter(Boolean)))
}

function phaseAllOperators(phase: JobPhase) {
  return Array.from(new Set((phase.operatorAssignments ?? []).map((item) => item.operatorName).filter(Boolean)))
}

function minutesBetween(startedAt: string, endedAt: string) {
  return Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000))
}

function phaseDurationMinutes(phase: JobPhase) {
  const now = new Date().toISOString()
  const starts = (phase.operatorAssignments ?? []).map((item) => item.startedAt).filter(Boolean).sort()
  const startedAt = starts[0] || phase.startedAt
  if (!startedAt) return phase.actualMinutes
  const endedAt = phase.status === 'Completata' ? (phase.endedAt || now) : now
  return minutesBetween(startedAt, endedAt)
}

function phaseManMinutes(phase: JobPhase) {
  const now = new Date().toISOString()
  return (phase.operatorAssignments ?? []).reduce((sum, item) => {
    if (item.endedAt) return sum + Math.max(item.workedMinutes, minutesBetween(item.startedAt, item.endedAt))
    if (item.activityStatus === 'Attivo') return sum + minutesBetween(item.startedAt, now)
    return sum + Math.max(0, item.workedMinutes)
  }, 0)
}

export function WorkflowPage({
  data,
  customerById,
  query,
  onChange,
  setError,
  setNotice,
  onUpdateVehicleStatus,
  statusOptions,
  statusLabel,
}: {
  data: ErpData
  customerById: (id: string) => Customer | undefined
  query: string
  onChange: (next: ErpData) => void
  setError: (value: string) => void
  setNotice: (value: string) => void
  onUpdateVehicleStatus: (vehicleId: string, status: string) => void
  statusOptions: Array<{ id: string; label: string }>
  statusLabel: (status: string) => string
}) {
  const [modal, setModal] = useState<WorkflowModal | null>(null)
  const [estimateStatusFilter, setEstimateStatusFilter] = useState<'Tutti' | EstimateStatus>('Tutti')
  const [jobStatusFilter, setJobStatusFilter] = useState<'Tutti' | JobStatus>('Tutti')
  const [priorityFilter, setPriorityFilter] = useState<'Tutte' | 'Normale' | 'Alta' | 'Urgente'>('Tutte')
  const [responsibleFilter, setResponsibleFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')

  const kpis = useMemo(() => calculateJobKpis(data), [data])
  const workTypeComparison = useMemo(() => workTypeTimeComparison(data), [data])
  const estimates = data.estimates ?? []
  const jobs = data.jobs ?? []

  const q = query.trim().toLowerCase()
  const filteredEstimates = estimates.filter((estimate) => {
    const customer = customerById(estimate.customerId)
    const byStatus = estimateStatusFilter === 'Tutti' || estimate.status === estimateStatusFilter
    const byCustomer = !customerFilter || estimate.customerId === customerFilter
    const byQuery = !q || `${estimate.number} ${estimate.plate} ${customer?.name || ''}`.toLowerCase().includes(q)
    return byStatus && byCustomer && byQuery
  })

  const filteredJobs = jobs.filter((job) => {
    const customer = customerById(job.customerId)
    const byStatus = jobStatusFilter === 'Tutti' || job.status === jobStatusFilter
    const byPriority = priorityFilter === 'Tutte' || job.priority === priorityFilter
    const byResponsible = !responsibleFilter.trim() || job.responsible.toLowerCase().includes(responsibleFilter.trim().toLowerCase())
    const byCustomer = !customerFilter || job.customerId === customerFilter
    const byQuery = !q || `${job.number} ${job.plate} ${customer?.name || ''}`.toLowerCase().includes(q)
    return byStatus && byPriority && byResponsible && byCustomer && byQuery
  })

  const apply = (next: ErpData, notice: string) => {
    onChange(syncJobsWithVehicles(next))
    setError('')
    setNotice(notice)
  }

  return <>
    <section className="welcome compact-welcome">
      <div>
        <span className="eyebrow">PREVENTIVI E COMMESSE</span>
        <h2>Flusso operativo completo vettura</h2>
        <p>Dal preventivo alla consegna con collegamento reale a planner, produzione e finanza.</p>
      </div>
      <div className="planner-actions">
        <button className="secondary" onClick={() => setModal({ type: 'checklist-templates' })}>Checklist qualità</button>
        <button className="secondary" onClick={() => setModal({ type: 'job-create' })}>Commessa diretta</button>
        <button className="primary" onClick={() => setModal({ type: 'estimate-create' })}>Nuovo preventivo</button>
      </div>
    </section>

    <section className="owner-kpi-grid">
      <article className="owner-kpi-card"><span>Commesse aperte</span><strong>{kpis.openJobs}</strong><small>Escluse consegnate e annullate.</small></article>
      <article className="owner-kpi-card"><span>Vetture in lavorazione</span><strong>{kpis.vehiclesInWork}</strong><small>Include attese e controllo qualità.</small></article>
      <article className="owner-kpi-card"><span>Pronte consegna</span><strong>{kpis.readyForDelivery}</strong><small>Con checklist completata.</small></article>
      <article className="owner-kpi-card"><span>Consegnate mese</span><strong>{kpis.deliveredThisMonth}</strong><small>Rilevate da data consegna effettiva.</small></article>
      <article className="owner-kpi-card"><span>Valore lavori aperti</span><strong>{money(kpis.openValue)}</strong><small>Non genera incassi automatici.</small></article>
      <article className="owner-kpi-card"><span>Valore completato</span><strong>{money(kpis.completedValue)}</strong><small>Commesse concluse.</small></article>
      <article className="owner-kpi-card"><span>Ritardi</span><strong>{kpis.delayedJobs}</strong><small>Consegna prevista superata.</small></article>
      <article className="owner-kpi-card"><span>Completamento puntuale</span><strong>{kpis.onTimeCompletionRate}%</strong><small>Solo su commesse consegnate.</small></article>
    </section>

    <section className="panel table-panel">
      <div className="panel-head">
        <div><span className="eyebrow">PREVENTIVI</span><h3>{filteredEstimates.length} documenti</h3></div>
        <div className="planner-actions">
          <select value={estimateStatusFilter} onChange={(event) => setEstimateStatusFilter(event.target.value as 'Tutti' | EstimateStatus)}>
            <option value="Tutti">Tutti gli stati</option>
            {ESTIMATE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)}>
            <option value="">Tutti i clienti</option>
            {data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
        </div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Numero</th><th>Cliente / targa</th><th>Stato</th><th>Data</th><th>Totale</th><th>Stadio economico</th><th>Azioni</th></tr></thead><tbody>
        {filteredEstimates.map((estimate) => {
          const customer = customerById(estimate.customerId)
          const editable = !estimate.convertedJobId
          return <tr key={estimate.id}>
            <td><strong>{estimate.number}</strong><small>{estimate.companyName || 'Nessuna azienda'}</small></td>
            <td><strong className="plate">{estimate.plate}</strong><small>{customer?.name || 'Cliente'}</small></td>
            <td>
              <select value={estimate.status} onChange={(event) => {
                try {
                  apply(updateEstimateStatus(data, estimate.id, event.target.value as EstimateStatus), `Preventivo ${estimate.number} aggiornato.`)
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Aggiornamento stato non riuscito.')
                }
              }}>
                {ESTIMATE_STATUSES.map((status) => <option key={status}>{status}</option>)}
              </select>
            </td>
            <td>{estimate.date}</td>
            <td>{money(estimate.total)}</td>
            <td><span className="tag">{estimateFinancialStage(data, estimate)}</span></td>
            <td><div className="row-actions">
              <button onClick={() => setModal({ type: 'estimate-edit', estimateId: estimate.id })} disabled={!editable}>Modifica</button>
              <button className="primary" onClick={() => {
                try {
                  apply(approveEstimateAndCreateJob(data, estimate.id), `Preventivo ${estimate.number} approvato e convertito in commessa.`)
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Conversione non riuscita.')
                }
              }} disabled={Boolean(estimate.convertedJobId)}>Approva e crea commessa</button>
            </div></td>
          </tr>
        })}
      </tbody></table></div>
      {!filteredEstimates.length && <div className="empty">Nessun preventivo trovato.</div>}
    </section>

    <section className="panel table-panel">
      <div className="panel-head">
        <div><span className="eyebrow">COMMESSE</span><h3>{filteredJobs.length} pratiche</h3></div>
        <div className="planner-actions">
          <select value={jobStatusFilter} onChange={(event) => setJobStatusFilter(event.target.value as 'Tutti' | JobStatus)}>
            <option value="Tutti">Tutti gli stati</option>
            {JOB_STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as 'Tutte' | 'Normale' | 'Alta' | 'Urgente')}>
            <option value="Tutte">Tutte le priorità</option>
            <option>Normale</option>
            <option>Alta</option>
            <option>Urgente</option>
          </select>
          <input placeholder="Responsabile" value={responsibleFilter} onChange={(event) => setResponsibleFilter(event.target.value)} />
        </div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Commessa</th><th>Cliente / targa</th><th>Stato commessa</th><th>Stato vettura</th><th>Fase corrente</th><th>Consegna</th><th>Avanzamento</th><th>Valore</th><th>Cono</th><th>Azioni</th></tr></thead><tbody>
        {filteredJobs.map((job) => {
          const customer = customerById(job.customerId)
          const currentPhase = findJobCurrentPhase(job)
          const vehicle = job.vehicleId ? data.vehicles.find((item) => item.id === job.vehicleId) : null
          const vehicleOptions = vehicle && statusOptions.some((item) => item.id === vehicle.status)
            ? statusOptions
            : (vehicle ? [...statusOptions, { id: vehicle.status, label: statusLabel(vehicle.status) }] : statusOptions)
          return <tr key={job.id}>
            <td><strong>{job.number}</strong><small>{job.estimateId ? 'Da preventivo' : 'Commessa diretta'}</small></td>
            <td><strong className="plate">{job.plate}</strong><small>{customer?.name || 'Cliente'}</small></td>
            <td>
              <select value={job.status} onChange={(event) => {
                try {
                  apply(updateJobStatus(data, job.id, event.target.value as JobStatus), `Stato commessa ${job.number} aggiornato.`)
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Aggiornamento stato commessa non riuscito.')
                }
              }}>
                {JOB_STATUSES.map((status) => <option key={status}>{status}</option>)}
              </select>
            </td>
            <td>{vehicle ? <><select value={vehicle.status} onChange={(event) => onUpdateVehicleStatus(vehicle.id, event.target.value)}>{vehicleOptions.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select><small>{vehicle.statusMode === 'manual' ? 'Override manuale' : (vehicle.suggestedStatus ? `Suggerito: ${statusLabel(vehicle.suggestedStatus)}` : 'Suggerimento automatico')}</small></> : '—'}</td>
            <td>{currentPhase ? <><strong>{currentPhase.name}</strong><small>{currentPhase.status}</small></> : '—'}</td>
            <td>{job.expectedDeliveryDate}</td>
            <td>{job.progressPercent}%</td>
            <td>{money(job.total)}</td>
            <td>{coneLabelForJob(job)}</td>
            <td><div className="row-actions"><button onClick={() => setModal({ type: 'job-edit', jobId: job.id })}>Apri scheda</button></div></td>
          </tr>
        })}
      </tbody></table></div>
      {!filteredJobs.length && <div className="empty">Nessuna commessa trovata.</div>}
    </section>

    {modal?.type === 'estimate-create' && <EstimateEditor
      title="Nuovo preventivo"
      data={data}
      customerById={customerById}
      onCancel={() => setModal(null)}
      onSubmit={(payload) => {
        try {
          apply(createEstimate(data, payload), 'Preventivo creato con calcolo automatico imponibile, IVA e totale.')
          setModal(null)
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Creazione preventivo non riuscita.')
        }
      }}
      onConfirm={(payload) => {
        void (async () => {
          try {
            const confirmed = await confirmEstimateAndCreateJobTransactional(data, payload, {
              save: saveDatabase,
              load: loadDatabase,
            })
            apply(confirmed, 'Preventivo confermato, commessa creata e resa disponibile al Planner.')
            setModal(null)
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Conferma preventivo non riuscita.')
          }
        })()
      }}
    />}

    {modal?.type === 'estimate-edit' && <EstimateEditor
      title="Modifica preventivo"
      data={data}
      customerById={customerById}
      initial={estimates.find((estimate) => estimate.id === modal.estimateId)}
      onCancel={() => setModal(null)}
      onSubmit={(payload) => {
        if (!modal || modal.type !== 'estimate-edit') return
        try {
          apply(updateEstimate(data, modal.estimateId, payload), 'Preventivo aggiornato.')
          setModal(null)
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Modifica preventivo non riuscita.')
        }
      }}
      onConfirm={(payload) => {
        if (!modal || modal.type !== 'estimate-edit') return
        void (async () => {
          try {
            const confirmed = await confirmEstimateAndCreateJobTransactional(data, payload, {
              save: saveDatabase,
              load: loadDatabase,
            }, modal.estimateId)
            apply(confirmed, 'Preventivo confermato, commessa creata e resa disponibile al Planner.')
            setModal(null)
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Conferma preventivo non riuscita.')
          }
        })()
      }}
    />}

    {modal?.type === 'job-create' && <DirectJobEditor
      data={data}
      onCancel={() => setModal(null)}
      onSubmit={(payload) => {
        try {
          apply(createDirectJob(data, payload), 'Commessa diretta creata.')
          setModal(null)
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Creazione commessa diretta non riuscita.')
        }
      }}
    />}

    {modal?.type === 'job-edit' && <JobEditor
      data={data}
      customerById={customerById}
      job={jobs.find((job) => job.id === modal.jobId)}
      onCancel={() => setModal(null)}
      onSubmit={(jobId, payload) => {
        try {
          apply(updateJobMeta(data, jobId, payload), 'Pianificazione commessa aggiornata.')
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Aggiornamento commessa non riuscito.')
        }
      }}
      onUpdatePhase={(jobId, phaseId, payload) => {
        try {
          apply(updateJobPhase(data, jobId, phaseId, payload), 'Fase operativa aggiornata.')
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Aggiornamento fase non riuscito.')
        }
      }}
      onSetPhaseOperators={(jobId, phaseId, operatorNames) => {
        try {
          apply(updateJobPhaseOperators(data, jobId, phaseId, operatorNames), 'Operatori di fase aggiornati.')
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Aggiornamento operatori fase non riuscito.')
        }
      }}
      onUpdatePhaseEstimatedMinutes={(jobId, phaseId, minutes, reason) => {
        try {
          apply(updateJobPhaseEstimatedMinutes(data, jobId, phaseId, minutes, reason), 'Tempo preventivato fase aggiornato.')
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Aggiornamento tempo fase non riuscito.')
        }
      }}
      onToggleChecklist={(jobId, itemId, checked) => {
        try {
          apply(toggleJobChecklistItem(data, jobId, itemId, checked), 'Checklist qualità aggiornata.')
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Aggiornamento checklist non riuscito.')
        }
      }}
    />}

    {modal?.type === 'checklist-templates' && <ChecklistTemplateEditor
      data={data}
      onCancel={() => setModal(null)}
      onSubmit={(labels) => {
        apply(updateQualityChecklistTemplates(data, labels), 'Template checklist qualità aggiornati.')
        setModal(null)
      }}
    />}

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">STORICO TEMPI</span><h3>Previsto vs consuntivo per lavorazione</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>Lavorazione</th><th>Minuti previsti</th><th>Minuti consuntivi</th><th>Delta</th><th>Campioni</th></tr></thead><tbody>
        {workTypeComparison.map((row) => <tr key={row.workType}><td>{row.workType}</td><td>{row.plannedMinutes}</td><td>{row.actualMinutes}</td><td>{row.deltaMinutes}</td><td>{row.samples}</td></tr>)}
      </tbody></table></div>
      {!workTypeComparison.length && <div className="empty">Storico non ancora disponibile.</div>}
    </section>
  </>
}

function EstimateEditor({
  title,
  data,
  customerById,
  initial,
  onCancel,
  onSubmit,
  onConfirm,
}: {
  title: string
  data: ErpData
  customerById: (id: string) => Customer | undefined
  initial?: EstimateDocument
  onCancel: () => void
  onSubmit: (payload: {
    customerId: string
    vehicleId?: string
    plate: string
    companyName: string
    contactName: string
    date: string
    priority?: RepairJob['priority']
    requestedDeliveryDate?: string
    notes: string
    productionForecast?: EstimateDocument['productionForecast']
    lines: EditableLine[]
  }) => void
  onConfirm?: (payload: {
    customerId: string
    vehicleId?: string
    plate: string
    companyName: string
    contactName: string
    date: string
    priority?: RepairJob['priority']
    requestedDeliveryDate?: string
    notes: string
    productionForecast?: EstimateDocument['productionForecast']
    lines: EditableLine[]
  }) => void
}) {
  type EstimateEditorStep = 1 | 2 | 3 | 4
  type PanelDraft = {
    id: string
    panelId: string
    side: '' | 'sx' | 'dx' | 'center'
    name: string
    repairExtent: 'intero' | 'mezzo'
    workNote: string
    vehicleSizeClass: 'piccola' | 'media' | 'grande' | ''
    colorFamily: string
    paintCycle: string
  }

  const [customerId, setCustomerId] = useState(initial?.customerId ?? '')
  const [vehicleId, setVehicleId] = useState(initial?.vehicleId ?? '')
  const [plate, setPlate] = useState(initial?.plate ?? '')
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '')
  const [contactName, setContactName] = useState(initial?.contactName ?? '')
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10))
  const [priority, setPriority] = useState<RepairJob['priority']>(initial?.priority ?? 'Normale')
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState(initial?.requestedDeliveryDate ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [lines, setLines] = useState<EditableLine[]>(
    initial?.lines?.map((line) => ({
      id: line.id,
      description: line.description,
      panelId: line.panelId,
      panelName: line.panelName,
      panelSide: line.panelSide,
      repairExtent: line.repairExtent,
      panelWorkNote: line.panelWorkNote,
      vehicleSizeClass: line.vehicleSizeClass,
      colorFamily: line.colorFamily,
      paintCycle: line.paintCycle,
      standardWorkId: line.standardWorkId,
      category: line.category,
      standardWorkName: line.standardWorkName,
      categoryOrPhase: line.categoryOrPhase,
      calculationType: line.calculationType,
      standardMinutes: line.standardMinutes,
      estimatedMinutes: line.estimatedMinutes,
      lineTotalMinutes: line.lineTotalMinutes,
      manualTimeOverride: line.manualTimeOverride,
      appliedRuleId: line.appliedRuleId,
      appliedRuleName: line.appliedRuleName,
      appliedRuleSummary: line.appliedRuleSummary,
      requiredSkill: line.requiredSkill,
      cycleOrder: line.cycleOrder,
      technicalWaitMinutes: line.technicalWaitMinutes,
      technicalWaitBlocksPhaseNames: line.technicalWaitBlocksPhaseNames,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      vatRate: line.vatRate,
    })) ?? [],
  )
  const [panels, setPanels] = useState<PanelDraft[]>(() => {
    const sourceLines = initial?.lines ?? []
    const byName = new Map<string, EstimateLine[]>()
    for (const line of sourceLines) {
      const key = String(line.panelName ?? '').trim()
      if (!key) continue
      byName.set(key, [...(byName.get(key) ?? []), line])
    }
    return Array.from(byName.entries()).map(([name, grouped]) => ({
      id: crypto.randomUUID(),
      panelId: String(grouped.find((line) => line.panelId)?.panelId ?? ''),
      side: grouped.find((line) => line.panelSide)?.panelSide === 'sx' || grouped.find((line) => line.panelSide)?.panelSide === 'dx' || grouped.find((line) => line.panelSide)?.panelSide === 'center'
        ? grouped.find((line) => line.panelSide)?.panelSide as '' | 'sx' | 'dx' | 'center'
        : '',
      name,
      repairExtent: grouped.find((line) => line.repairExtent)?.repairExtent === 'mezzo' ? 'mezzo' : 'intero',
      workNote: String(grouped.find((line) => line.panelWorkNote)?.panelWorkNote ?? ''),
      vehicleSizeClass: grouped.find((line) => line.vehicleSizeClass)?.vehicleSizeClass ?? '',
      colorFamily: grouped.find((line) => line.colorFamily)?.colorFamily ?? '',
      paintCycle: grouped.find((line) => line.paintCycle)?.paintCycle ?? '',
    }))
  })
  const [activePanelId, setActivePanelId] = useState<string>('')
  const [customPanelName, setCustomPanelName] = useState('')
  const [activeView, setActiveView] = useState<VehicleViewId>('top')
  const [hoveredPanelId, setHoveredPanelId] = useState<string>('')
  const [zoomLevel, setZoomLevel] = useState(1)
  const pinchDistanceRef = useRef<number | null>(null)
  const [step, setStep] = useState<EstimateEditorStep>(1)
  const [searchTerm, setSearchTerm] = useState(() => {
    const initialCustomer = initial ? customerById(initial.customerId) : undefined
    return initial?.plate || initialCustomer?.name || ''
  })
  const [panelAdvancedOpen, setPanelAdvancedOpen] = useState(false)
  const [advancedMetaOpen, setAdvancedMetaOpen] = useState(false)
  const [expandedWorkIds, setExpandedWorkIds] = useState<Record<string, boolean>>({})
  const [summaryDetailsOpen, setSummaryDetailsOpen] = useState<{ economic: boolean; technical: boolean }>({ economic: false, technical: false })

  const vehicleOptions = data.vehicles.filter((vehicle) => !customerId || vehicle.customerId === customerId)
  const priceList = data.plannerSettings.standardWorkPriceList ?? []
  const timePresets = data.plannerSettings.standardWorkTimePresets ?? []
  const internalCostSettings = data.plannerSettings.internalCostSettings
  const standardWorks = (data.plannerSettings.standardWorks ?? [])
    .filter((item) => item.active)
    .sort((a, b) => a.cycleOrder - b.cycleOrder || a.name.localeCompare(b.name, 'it-IT'))
  const [dismissedPriceMismatch, setDismissedPriceMismatch] = useState<Record<string, boolean>>({})
  const [manualPriceOverrides, setManualPriceOverrides] = useState<Record<string, boolean>>({})

  const panelLines = (panelName: string) => lines.filter((line) => normalizePanelName(line.panelName ?? '') === normalizePanelName(panelName))
  const lineForPanelWork = (panelName: string, workId: string) => lines.find((line) => normalizePanelName(line.panelName ?? '') === normalizePanelName(panelName) && line.standardWorkId === workId)
  const lineListItem = (line: EditableLine) => resolvePriceListItem(priceList, line)
  const selectedCustomer = customerId ? customerById(customerId) : undefined

  const applyRulePreview = (line: EditableLine, forceAuto = false): EditableLine => {
    const resolved = resolveStandardRuleForLine(standardWorks, line, timePresets)
    const nextEstimated = line.manualTimeOverride && !forceAuto
      ? (line.estimatedMinutes ?? resolved.standardMinutes)
      : resolved.standardMinutes
    return {
      ...line,
      standardWorkId: resolved.standard?.id ?? line.standardWorkId,
      standardWorkName: line.standardWorkName || resolved.standard?.name || line.description,
      categoryOrPhase: line.categoryOrPhase || resolved.standard?.categoryOrPhase || '',
      calculationType: resolved.standard?.calculationType ?? line.calculationType,
      standardMinutes: resolved.standardMinutes,
      estimatedMinutes: nextEstimated,
      appliedRuleId: resolved.rule?.id ?? '',
      appliedRuleName: resolved.rule?.name ?? '',
      appliedRuleSummary: resolved.summary,
    }
  }

  const workCategoryFor = (work: { categoryOrPhase?: string }) => {
    const phase = String(work.categoryOrPhase ?? '').toLowerCase()
    if (phase.includes('verniciatura')) return 'verniciatura' as WorkCategory
    if (phase.includes('ricambi')) return 'ricambi' as WorkCategory
    if (phase.includes('meccanica')) return 'meccanica' as WorkCategory
    return 'carrozzeria' as WorkCategory
  }

  const findPanelByName = (name: string) => panels.find((panel) => normalizePanelName(panel.name) === normalizePanelName(name))
  const activePanel = panels.find((panel) => panel.id === activePanelId) ?? null

  const ensurePanel = (panelName: string, panelId?: string, side?: '' | 'sx' | 'dx' | 'center') => {
    const clean = panelName.trim()
    if (!clean) return
    const existing = findPanelByName(clean)
    if (existing) {
      setActivePanelId(existing.id)
      return
    }
    const created: PanelDraft = {
      id: crypto.randomUUID(),
      panelId: panelId ? panelId.trim() : '',
      side: side ?? '',
      name: clean,
      repairExtent: 'intero',
      workNote: '',
      vehicleSizeClass: '',
      colorFamily: '',
      paintCycle: '',
    }
    setPanels((current) => [...current, created])
    setActivePanelId(created.id)
  }

  useEffect(() => {
    if (activePanelId || !panels.length) return
    setActivePanelId(panels[0].id)
  }, [activePanelId, panels])

  useEffect(() => {
    if (customerId || !vehicleId) return
    const vehicle = data.vehicles.find((item) => item.id === vehicleId)
    if (!vehicle) return
    setCustomerId(vehicle.customerId)
  }, [customerId, data.vehicles, vehicleId])

  const applyCustomerSelection = (nextCustomerId: string) => {
    setCustomerId(nextCustomerId)
    const customer = customerById(nextCustomerId)
    if (!customer) return
    if (!contactName.trim()) setContactName(customer.name)
    if (!companyName.trim() && customer.type === 'Azienda') setCompanyName(customer.name)
  }

  const applyVehicleSelection = (nextVehicleId: string) => {
    const vehicle = data.vehicles.find((item) => item.id === nextVehicleId)
    setVehicleId(nextVehicleId)
    if (!vehicle) return
    setPlate(vehicle.plate)
    setPriority(vehicle.priority ?? 'Normale')
    setRequestedDeliveryDate(vehicle.requestedDeliveryDate ?? '')
    applyCustomerSelection(vehicle.customerId)
    setSearchTerm(`${vehicle.plate} · ${customerById(vehicle.customerId)?.name || ''}`.trim())
  }

  const searchResults = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase()
    if (!needle) return [] as Array<{ id: string; kind: 'vehicle' | 'customer'; title: string; subtitle: string }>
    const vehicleMatches = data.vehicles
      .filter((vehicle) => {
        const customer = customerById(vehicle.customerId)
        return `${vehicle.plate} ${vehicle.make} ${vehicle.model} ${customer?.name || ''} ${customer?.phone || ''}`.toLowerCase().includes(needle)
      })
      .slice(0, 6)
      .map((vehicle) => ({
        id: vehicle.id,
        kind: 'vehicle' as const,
        title: vehicle.plate,
        subtitle: `${customerById(vehicle.customerId)?.name || 'Cliente'} · ${vehicle.make} ${vehicle.model}`.trim(),
      }))
    const matchedCustomerIds = new Set(vehicleMatches.map((item) => data.vehicles.find((vehicle) => vehicle.id === item.id)?.customerId).filter(Boolean))
    const customerMatches = data.customers
      .filter((customer) => !matchedCustomerIds.has(customer.id) && `${customer.name} ${customer.phone} ${customer.email}`.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((customer) => ({
        id: customer.id,
        kind: 'customer' as const,
        title: customer.name,
        subtitle: `${customer.phone || 'Telefono n/d'}${customer.email ? ` · ${customer.email}` : ''}`,
      }))
    return [...vehicleMatches, ...customerMatches]
  }, [customerById, data.customers, data.vehicles, searchTerm])

  const updatePanelContext = (panelId: string, patch: Partial<PanelDraft>) => {
    const target = panels.find((panel) => panel.id === panelId)
    if (!target) return
    setPanels((current) => current.map((panel) => panel.id === panelId ? { ...panel, ...patch } : panel))
    setLines((current) => current.map((line) => {
      if (normalizePanelName(line.panelName ?? '') !== normalizePanelName(target.name)) return line
      const nextLine = applyRulePreview({
        ...line,
        panelId: patch.panelId ?? line.panelId,
        panelSide: patch.side ?? line.panelSide,
        repairExtent: patch.repairExtent ?? line.repairExtent,
        panelWorkNote: patch.workNote ?? line.panelWorkNote,
        vehicleSizeClass: patch.vehicleSizeClass ?? line.vehicleSizeClass,
        colorFamily: patch.colorFamily ?? line.colorFamily,
        paintCycle: patch.paintCycle ?? line.paintCycle,
      })
      if (patch.paintCycle == null) return nextLine
      const manualOverride = Boolean(manualPriceOverrides[line.id])
      if (manualOverride) return nextLine
      const listItem = resolvePriceListItem(priceList, nextLine)
      if (!listItem) return nextLine
      return { ...nextLine, unitPrice: Number(listItem.unitPrice ?? 0) }
    }))
  }

  const renamePanel = (panelId: string, nextName: string) => {
    const target = panels.find((panel) => panel.id === panelId)
    if (!target) return
    const clean = nextName.trim() || target.name
    setPanels((current) => current.map((panel) => panel.id === panelId ? { ...panel, name: clean } : panel))
    setLines((current) => current.map((line) => normalizePanelName(line.panelName ?? '') === normalizePanelName(target.name) ? { ...line, panelName: clean } : line))
  }

  const removePanel = (panelId: string) => {
    const target = panels.find((panel) => panel.id === panelId)
    if (!target) return
    setPanels((current) => {
      const remaining = current.filter((panel) => panel.id !== panelId)
      if (activePanelId === panelId) setActivePanelId(remaining[0]?.id ?? '')
      return remaining
    })
    setLines((current) => current.filter((line) => normalizePanelName(line.panelName ?? '') !== normalizePanelName(target.name)))
  }

  const togglePanelWork = (panel: PanelDraft, workId: string, enabled: boolean) => {
    const work = standardWorks.find((item) => item.id === workId)
    if (!work) return
    if (!enabled) {
      setLines((current) => current.filter((line) => !(normalizePanelName(line.panelName ?? '') === normalizePanelName(panel.name) && line.standardWorkId === work.id)))
      return
    }
    const base: EditableLine = {
      ...emptyLine(),
      panelId: panel.panelId,
      panelName: panel.name,
      panelSide: panel.side,
      repairExtent: panel.repairExtent,
      panelWorkNote: panel.workNote,
      vehicleSizeClass: panel.vehicleSizeClass,
      colorFamily: panel.colorFamily,
      paintCycle: panel.paintCycle,
      description: work.name,
      category: workCategoryFor(work),
      standardWorkId: work.id,
      standardWorkName: work.name,
      categoryOrPhase: work.categoryOrPhase,
      calculationType: work.calculationType,
      standardMinutes: work.standardMinutes,
      estimatedMinutes: work.standardMinutes,
      manualTimeOverride: false,
      requiredSkill: work.requiredSkill,
      cycleOrder: work.cycleOrder,
      technicalWaitMinutes: work.technicalWaitMinutes ?? 0,
      technicalWaitBlocksPhaseNames: work.technicalWaitBlocksPhaseNames ?? [],
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      vatRate: 22,
    }
    const variants = resolvePriceListVariants(priceList, base)
    const selectedVariant = variants.length === 1
      ? variants[0]
      : variants.length > 1
        ? panel.paintCycle
        : panel.paintCycle
    const withVariant = { ...base, paintCycle: selectedVariant }
    const listItem = variants.length > 1 && !selectedVariant
      ? null
      : resolvePriceListItem(priceList, withVariant)
    const preview = applyRulePreview({ ...withVariant, unitPrice: listItem ? listItem.unitPrice : withVariant.unitPrice }, true)
    setLines((current) => [...current, preview])
    setManualPriceOverrides((current) => ({ ...current, [preview.id]: false }))
  }

  const variantOptionsFor = (panel: PanelDraft, work: { name: string }) => resolvePriceListVariants(priceList, {
    panelId: panel.panelId,
    panelName: panel.name,
    repairExtent: panel.repairExtent,
    standardWorkName: work.name,
    description: work.name,
  } as Partial<EstimateLine>)

  const onVariantChange = (line: EditableLine, nextVariant: string) => {
    const changed = { ...line, paintCycle: nextVariant }
    const listItem = resolvePriceListItem(priceList, changed)
    setLines((current) => current.map((row) => {
      if (row.id !== line.id) return row
      const manualOverride = Boolean(manualPriceOverrides[row.id])
      if (manualOverride) return { ...row, paintCycle: nextVariant }
      return {
        ...row,
        paintCycle: nextVariant,
        unitPrice: listItem ? Number(listItem.unitPrice ?? 0) : 0,
      }
    }))
  }

  const totals = lines.reduce((acc, line) => {
    const preview = linePreview(line as EstimateLine)
    acc.taxable += preview.taxable
    acc.vat += preview.vat
    acc.total += preview.total
    return acc
  }, { taxable: 0, vat: 0, total: 0 })
  const phaseTotals = estimatePhaseTotals(lines as EstimateLine[])
  const vehicleMinutes = estimateVehicleTotalMinutes(lines as EstimateLine[])
  const economicsByLine = useMemo(() => Object.fromEntries(lines.map((line) => {
    const liveLine: Partial<EstimateLine> = {
      ...line,
      lineTotalMinutes: estimateLineTotalMinutes(line as EstimateLine),
    }
    return [line.id, computeLineInternalEconomics(liveLine, data.plannerSettings)]
  })), [data.plannerSettings, lines])
  const economicsTotals = useMemo(() => {
    const values = lines.map((line) => economicsByLine[line.id])
    const totalInternalCost = values.reduce((sum, item) => sum + Number(item?.internalCostAmount ?? 0), 0)
    const totalMarginAmount = values.reduce((sum, item) => sum + Number(item?.theoreticalMarginAmount ?? 0), 0)
    const lossLines = values.filter((item) => item?.marginStatus === 'loss').length
    const lowMarginLines = values.filter((item) => item?.marginStatus === 'low').length
    const zeroPriceLines = values.filter((item) => item?.marginStatus === 'zero-price').length
    const revenue = totals.taxable
    const marginPercent = revenue > 0 ? (totalMarginAmount / revenue) * 100 : 0
    return {
      totalInternalCost,
      totalMarginAmount,
      marginPercent,
      lossLines,
      lowMarginLines,
      zeroPriceLines,
    }
  }, [economicsByLine, lines, totals.taxable])
  const productionForecast = useMemo(() => {
    if (!lines.length || !plate.trim()) return null
    return simulateEstimateProductionForecast(data, {
      vehicleId: vehicleId || undefined,
      plate,
      priority,
      requestedDeliveryDate,
      lines: lines as EstimateLine[],
    })
  }, [data, lines, plate, priority, requestedDeliveryDate, vehicleId])

  const catalogPanelNames = new Set(PANEL_CATALOG.map((panel) => normalizePanelName(panel.name)))
  const customPanels = panels.filter((panel) => !catalogPanelNames.has(normalizePanelName(panel.name)))
  const selectedPanelIds = new Set(panels.map((panel) => panel.panelId).filter(Boolean))
  const completeSide = {
    sx: SIDE_MAIN_PANEL_IDS.sx.every((panelId) => selectedPanelIds.has(panelId)),
    dx: SIDE_MAIN_PANEL_IDS.dx.every((panelId) => selectedPanelIds.has(panelId)),
  }

  const openPanelLines = activePanel ? panelLines(activePanel.name) : []
  const openPanelMinutes = openPanelLines.reduce((sum, line) => sum + estimateLineTotalMinutes(line as EstimateLine), 0)
  const openPanelTotals = openPanelLines.reduce((acc, line) => {
    const preview = linePreview(line as EstimateLine)
    acc.taxable += preview.taxable
    acc.total += preview.total
    return acc
  }, { taxable: 0, total: 0 })

  const panelState = (name: string) => {
    const panel = findPanelByName(name)
    if (!panel) return 'none'
    const configured = panelLines(panel.name).length > 0
    if (panel.id === activePanelId) return configured ? 'open-configured' : 'open-selected'
    return configured ? 'configured' : 'selected'
  }

  const activeViewPanels = PANEL_CATALOG.filter((panel) => panel.view === activeView)
  const hoveredPanel = PANEL_CATALOG.find((panel) => panel.id === hoveredPanelId) ?? null
  const selectedWorksCount = lines.length
  const selectedPanelsCount = panels.length
  const totalTechnicalWaitMinutes = lines.reduce((sum, line) => sum + Math.max(0, Number(line.technicalWaitMinutes ?? 0)), 0)
  const summaryStatus = !productionForecast && !lines.length
    ? { tone: 'neutral' as const, label: 'Da completare', message: 'Seleziona pannelli e lavorazioni per ottenere stima tempi, margine e consegna.' }
    : economicsTotals.lossLines > 0 || productionForecast?.requestedDeliveryCompatible === false
      ? { tone: 'red' as const, label: 'Perdita prevista / consegna non rispettabile', message: productionForecast?.requestedDeliveryCompatible === false ? `Prima data realistica: ${productionForecast.advisedDeliveryDate}` : 'Una o più lavorazioni risultano in perdita.' }
      : economicsTotals.lowMarginLines > 0 || (productionForecast?.workshopLoadPercent ?? 0) >= 85
        ? { tone: 'yellow' as const, label: 'Margine basso / capacità limitata', message: economicsTotals.lowMarginLines > 0 ? 'Verifica il margine delle lavorazioni evidenziate.' : 'Capacità officina vicina alla saturazione.' }
        : { tone: 'green' as const, label: 'Sostenibile', message: 'Margine e capacità compatibili con la consegna stimata.' }
  const timelinePhases = [
    { id: 'Smontaggio', label: 'Smontaggio', minutes: phaseTotals.get('Smontaggio') ?? 0 },
    { id: 'Lattoneria', label: 'Riparazione', minutes: phaseTotals.get('Lattoneria') ?? 0 },
    { id: 'Preparazione', label: 'Preparazione', minutes: phaseTotals.get('Preparazione') ?? 0 },
    { id: 'Verniciatura', label: 'Verniciatura', minutes: phaseTotals.get('Verniciatura') ?? 0 },
    { id: 'Attesa', label: 'Attesa', minutes: totalTechnicalWaitMinutes },
    { id: 'Rimontaggio', label: 'Rimontaggio', minutes: phaseTotals.get('Rimontaggio') ?? 0 },
    { id: 'Lucidatura', label: 'Lucidatura', minutes: phaseTotals.get('Lucidatura') ?? 0 },
    { id: 'Consegna', label: 'Consegna', minutes: 0 },
  ]
  const canAdvance = {
    1: Boolean(customerId && plate.trim()),
    2: selectedPanelsCount > 0,
    3: selectedWorksCount > 0,
    4: Boolean(customerId && plate.trim() && selectedWorksCount > 0),
  } as const
  const zoomIn = () => setZoomLevel((current) => Math.min(MAX_ZOOM, Number((current + 0.15).toFixed(2))))
  const zoomOut = () => setZoomLevel((current) => Math.max(MIN_ZOOM, Number((current - 0.15).toFixed(2))))
  const zoomFit = () => setZoomLevel(1)

  const onCanvasWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    setZoomLevel((current) => {
      const delta = event.deltaY < 0 ? 0.12 : -0.12
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current + delta).toFixed(2))))
    })
  }

  const onCanvasTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return
    const first = event.touches[0]
    const second = event.touches[1]
    pinchDistanceRef.current = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
  }

  const onCanvasTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return
    event.preventDefault()
    const first = event.touches[0]
    const second = event.touches[1]
    const nextDistance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
    const prevDistance = pinchDistanceRef.current
    if (!prevDistance) {
      pinchDistanceRef.current = nextDistance
      return
    }
    const ratio = nextDistance / prevDistance
    if (Math.abs(1 - ratio) < 0.02) return
    setZoomLevel((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current * ratio).toFixed(2)))))
    pinchDistanceRef.current = nextDistance
  }

  const onCanvasTouchEnd = () => {
    pinchDistanceRef.current = null
  }

  return <Modal title={title} onClose={onCancel} className="modal-estimate-workspace">
    <form className="form-grid estimate-workspace-form" onSubmit={(event) => {
      event.preventDefault()
      onSubmit({
        customerId,
        vehicleId: vehicleId || undefined,
        plate,
        companyName,
        contactName,
        date,
        priority,
        requestedDeliveryDate,
        notes,
        productionForecast: productionForecast ?? undefined,
        lines,
      })
    }}>
      <div className="full estimate-step-tabs" role="tablist" aria-label="Step preventivo">
        <button type="button" role="tab" aria-selected={step === 1} className={step === 1 ? 'active' : ''} onClick={() => setStep(1)}>1 Cliente e vettura</button>
        <button type="button" role="tab" aria-selected={step === 2} className={step === 2 ? 'active' : ''} onClick={() => setStep(2)}>2 Seleziona pannelli</button>
        <button type="button" role="tab" aria-selected={step === 3} className={step === 3 ? 'active' : ''} onClick={() => setStep(3)}>3 Scegli lavorazioni</button>
        <button type="button" role="tab" aria-selected={step === 4} className={step === 4 ? 'active' : ''} onClick={() => setStep(4)}>4 Controlla e conferma</button>
      </div>

      {step === 1 && <section className="full panel estimate-step-panel">
        <div className="panel-head"><div><span className="eyebrow">STEP 1</span><h3>Cliente e vettura</h3></div></div>
        <div className="estimate-quick-search">
          <label className="full">Ricerca unica
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Targa, cliente o telefono"
            />
          </label>
          {!!searchResults.length && <div className="estimate-search-results">
            {searchResults.map((result) => <button
              key={`${result.kind}-${result.id}`}
              type="button"
              className="estimate-search-result"
              onClick={() => {
                if (result.kind === 'vehicle') {
                  applyVehicleSelection(result.id)
                  return
                }
                applyCustomerSelection(result.id)
                setSearchTerm(result.title)
              }}
            >
              <strong>{result.title}</strong>
              <small>{result.subtitle}</small>
            </button>)}
          </div>}
        </div>
        <div className="estimate-customer-grid">
          <label>Cliente<select required value={customerId} onChange={(event) => applyCustomerSelection(event.target.value)}><option value="">Seleziona cliente</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <label>Vettura esistente<select value={vehicleId} onChange={(event) => applyVehicleSelection(event.target.value)}><option value="">Nessuna vettura</option>{vehicleOptions.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} - {vehicle.make} {vehicle.model}</option>)}</select></label>
          <label>Targa<input required value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} placeholder="AB123CD" /></label>
          <label>Consegna richiesta<input type="date" value={requestedDeliveryDate} onChange={(event) => setRequestedDeliveryDate(event.target.value)} /></label>
          <div className="full estimate-smart-card-grid">
            <article className="summary-card"><span>Cliente selezionato</span><strong>{selectedCustomer?.name || 'Da selezionare'}</strong><small>{selectedCustomer?.phone || 'Telefono non disponibile'}</small></article>
            <article className="summary-card"><span>Vettura collegata</span><strong>{vehicleId ? plate : 'Nuova targa'}</strong><small>{vehicleId ? `${data.vehicles.find((item) => item.id === vehicleId)?.make || ''} ${data.vehicles.find((item) => item.id === vehicleId)?.model || ''}`.trim() || 'Vettura esistente' : 'Sarà completata più avanti se necessario'}</small></article>
            <article className="summary-card"><span>Preventivo</span><strong>{date}</strong><small>Data proposta automaticamente</small></article>
          </div>
          <div className="full estimate-advanced-toggle-row">
            <button type="button" className="secondary" onClick={() => setAdvancedMetaOpen((current) => !current)}>{advancedMetaOpen ? 'Nascondi dettagli' : 'Dettagli cliente e opzioni'}</button>
          </div>
          {advancedMetaOpen && <>
            <label>Concessionario / azienda<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
            <label>Referente<input value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
            <label>Data preventivo<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label>Priorita<select value={priority} onChange={(event) => setPriority(event.target.value as RepairJob['priority'])}><option>Normale</option><option>Alta</option><option>Urgente</option></select></label>
            <label className="full">Note<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          </>}
        </div>
      </section>}

      {step === 2 && <section className="full estimate-step-panel">
        <div className="full exploded-layout estimate-work-layout">
          <div className="exploded-views" data-testid="exploded-vehicle">
            <section className="exploded-view" data-testid="exploded-vehicle-main">
              <header>Vettura interattiva grande</header>
              <div className="exploded-toolbar">
                <div className="exploded-view-switch" role="tablist" aria-label="Seleziona vista vettura">
                  {VIEW_LABELS.map((view) => <button
                    key={view.id}
                    type="button"
                    role="tab"
                    aria-selected={activeView === view.id}
                    className={activeView === view.id ? 'active' : ''}
                    onClick={() => setActiveView(view.id)}
                  >
                    {view.tabLabel}
                  </button>)}
                </div>

                <div className="exploded-zoom-controls" aria-label="Controlli zoom vettura">
                  <button type="button" onClick={zoomIn}>+ Zoom</button>
                  <button type="button" onClick={zoomOut}>- Zoom</button>
                  <button type="button" onClick={zoomFit}>Adatta</button>
                </div>
              </div>

              <div
                className={`exploded-canvas-pro view-${activeView}`}
                onWheel={onCanvasWheel}
                onTouchStart={onCanvasTouchStart}
                onTouchMove={onCanvasTouchMove}
                onTouchEnd={onCanvasTouchEnd}
                onTouchCancel={onCanvasTouchEnd}
              >
                <div className="exploded-zoom-stage" style={{ transform: `scale(${zoomLevel})` }}>
                  <svg viewBox={VIEW_BOX_BY_VIEW[activeView]} aria-label={`Sagoma vettura ${VIEW_LABELS.find((view) => view.id === activeView)?.label.toLowerCase()}`}>
                    <defs>
                      <linearGradient id="carBodyGradient" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stopColor="#292b32" />
                        <stop offset="60%" stopColor="#1a1d24" />
                        <stop offset="100%" stopColor="#13161b" />
                      </linearGradient>
                      <linearGradient id="glassGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#5f6f87" />
                        <stop offset="100%" stopColor="#2b3340" />
                      </linearGradient>
                    </defs>

                    {activeView === 'top' && <>
                      <path className="car-body" d="M30 6 Q50 1 70 6 L75 15 L72 67 L62 76 Q50 79 38 76 L28 67 L25 15 Z" />
                      <path className="car-window" d="M36 24 Q50 20 64 24 L62 48 Q50 53 38 48 Z" />
                      <text x="50" y="77.5" textAnchor="middle" className="car-front-marker">FRONTE</text>
                    </>}

                    {activeView === 'left' && <>
                      <path className="car-body" d="M7 54 L10 47 Q13 38 20 33 L30 26 L42 24 L60 24 L71 26 L82 33 Q88 37 91 45 L93 52 L90 58 Q88 62 82 63 L16 63 Q10 62 8 58 Z" />
                      <path className="car-window" d="M33 29 L44 27 L60 27 L70 29 L76 34 L63 34 L42 34 L34 33 Z" />
                      <circle className="car-wheel" cx="28" cy="61" r="5.2" />
                      <circle className="car-wheel" cx="72" cy="61" r="5.2" />
                    </>}

                    {activeView === 'right' && <>
                      <path className="car-body" d="M93 54 L90 47 Q87 38 80 33 L70 26 L58 24 L40 24 L29 26 L18 33 Q12 37 9 45 L7 52 L10 58 Q12 62 18 63 L84 63 Q90 62 92 58 Z" />
                      <path className="car-window" d="M67 29 L56 27 L40 27 L30 29 L24 34 L37 34 L58 34 L66 33 Z" />
                      <circle className="car-wheel" cx="72" cy="61" r="5.2" />
                      <circle className="car-wheel" cx="28" cy="61" r="5.2" />
                    </>}

                    {activeViewPanels.map((spot) => {
                      const state = panelState(spot.name)
                      const isHovered = hoveredPanelId === spot.id
                      return <g key={spot.id}>
                        <path
                          data-testid={`vehicle-panel-${spot.id}`}
                          className="vehicle-panel-hit"
                          d={spot.path}
                          role="button"
                          tabIndex={0}
                          aria-label={spot.name}
                          onMouseEnter={() => setHoveredPanelId(spot.id)}
                          onMouseLeave={() => setHoveredPanelId('')}
                          onFocus={() => setHoveredPanelId(spot.id)}
                          onBlur={() => setHoveredPanelId('')}
                          onClick={() => ensurePanel(spot.name, spot.id, panelSideFromId(spot.id))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              ensurePanel(spot.name, spot.id, panelSideFromId(spot.id))
                            }
                          }}
                        />
                        <path
                          className={`vehicle-panel-shape state-${state} ${isHovered ? 'is-hovered' : ''}`}
                          d={spot.path}
                          pointerEvents="none"
                        >
                          <title>{spot.name}</title>
                        </path>
                      </g>
                    })}
                  </svg>
                </div>

                {hoveredPanel && hoveredPanel.view === activeView && <div
                  className="vehicle-panel-tooltip"
                  style={{ left: `${hoveredPanel.badgeX}%`, top: `${hoveredPanel.badgeY}%` }}
                >
                  {hoveredPanel.name}
                </div>}
              </div>

              <div className="custom-panel-add">
                <input value={customPanelName} onChange={(event) => setCustomPanelName(event.target.value)} placeholder="Altro pannello configurabile" />
                <button type="button" className="secondary" onClick={() => {
                  ensurePanel(customPanelName, '', 'center')
                  setCustomPanelName('')
                }}>+ Aggiungi pannello</button>
              </div>
              {!!customPanels.length && <div className="custom-panel-list">
                {customPanels.map((panel) => {
                  const configured = panelLines(panel.name).length > 0
                  const active = panel.id === activePanelId
                  return <button key={panel.id} type="button" className={`secondary custom-panel-chip ${configured ? 'configured' : ''} ${active ? 'active' : ''}`} onClick={() => setActivePanelId(panel.id)}>{panel.name}</button>
                })}
              </div>}
              <div className="custom-panel-list">
                <span className={`custom-panel-chip fiancata-chip ${completeSide.sx ? 'configured' : ''}`}>Fiancata completa SX</span>
                <span className={`custom-panel-chip fiancata-chip ${completeSide.dx ? 'configured' : ''}`}>Fiancata completa DX</span>
              </div>
            </section>
          </div>

          <div className="panel estimate-panel-right" style={{ margin: 0 }}>
            <div className="panel-head">
              <div><span className="eyebrow">STEP 2</span><h3>{activePanel?.name || 'Seleziona un pannello'}</h3></div>
            </div>
            {!activePanel && <small>Seleziona i pannelli dalla sagoma. In questo step servono solo estensione e nota rapida.</small>}
            {activePanel && <>
              <div className="estimate-panel-meta-grid">
                <label>Estensione riparazione<select value={activePanel.repairExtent} onChange={(event) => updatePanelContext(activePanel.id, { repairExtent: event.target.value === 'mezzo' ? 'mezzo' : 'intero' })}><option value="intero">Pezzo intero</option><option value="mezzo">Mezzo pezzo</option></select></label>
                <label>Nome pannello<input value={activePanel.name} onChange={(event) => renamePanel(activePanel.id, event.target.value)} /></label>
              </div>
              <label className="estimate-panel-note">Note lavorazione pannello
                <textarea
                  rows={3}
                  placeholder="Annotazioni specifiche per questo pannello"
                  value={activePanel.workNote}
                  onChange={(event) => updatePanelContext(activePanel.id, { workNote: event.target.value })}
                />
              </label>
              <div className="row-actions estimate-advanced-toggle-row" style={{ margin: '8px 0 12px 0' }}>
                <button type="button" className="secondary" onClick={() => setPanelAdvancedOpen((current) => !current)}>{panelAdvancedOpen ? 'Nascondi dettagli pannello' : 'Dettagli pannello'}</button>
                <button type="button" className="danger" onClick={() => removePanel(activePanel.id)}>Rimuovi pannello dal preventivo</button>
              </div>
              {panelAdvancedOpen && <div className="estimate-panel-meta-grid estimate-panel-advanced-grid">
                <label>Dimensione vettura<select value={activePanel.vehicleSizeClass} onChange={(event) => updatePanelContext(activePanel.id, { vehicleSizeClass: event.target.value as 'piccola' | 'media' | 'grande' | '' })}><option value="">Non specificata</option><option value="piccola">Piccola</option><option value="media">Media</option><option value="grande">Grande</option></select></label>
                <label>Famiglia colore<input placeholder="Es. nero" value={activePanel.colorFamily} onChange={(event) => updatePanelContext(activePanel.id, { colorFamily: event.target.value })} /></label>
                <label>Tipo vernice/ciclo<input placeholder="Es. perlato" value={activePanel.paintCycle} onChange={(event) => updatePanelContext(activePanel.id, { paintCycle: event.target.value })} /></label>
              </div>}

              <div className="summary-grid" style={{ marginTop: 10 }}>
                <div className="summary-card"><span>Pannelli selezionati</span><strong>{selectedPanelsCount}</strong></div>
                <div className="summary-card"><span>Totale minuti pannello</span><strong>{humanDuration(openPanelMinutes)}</strong></div>
                <div className="summary-card"><span>Totale prezzo pannello (imponibile)</span><strong>{money(openPanelTotals.taxable)}</strong></div>
                <div className="summary-card"><span>Totale pannello (IVA inclusa)</span><strong>{money(openPanelTotals.total)}</strong></div>
              </div>
              {!!panels.length && <div className="estimate-panel-summary-list">
                {panels.map((panel) => <button key={panel.id} type="button" className={`secondary ${panel.id === activePanelId ? 'active' : ''}`} onClick={() => setActivePanelId(panel.id)}>{panel.name} · {panel.repairExtent === 'mezzo' ? 'Mezzo' : 'Intero'}</button>)}
              </div>}
            </>}
          </div>
        </div>
      </section>}

      {step === 3 && <section className="full estimate-step-panel" data-testid="estimate-work-step">
        <div className="full exploded-layout estimate-work-layout">
          <section className="panel" style={{ margin: 0 }}>
            <div className="panel-head"><div><span className="eyebrow">STEP 3</span><h3>Pannelli selezionati</h3></div></div>
            {!panels.length && <small>Seleziona almeno un pannello nello step precedente.</small>}
            {!!panels.length && <div className="estimate-panel-summary-list vertical">
              {panels.map((panel) => <button key={panel.id} type="button" className={`secondary ${panel.id === activePanelId ? 'active' : ''}`} onClick={() => setActivePanelId(panel.id)}>{panel.name} · {panel.repairExtent === 'mezzo' ? 'Mezzo' : 'Intero'}</button>)}
            </div>}
          </section>

          <section className="panel estimate-panel-right" style={{ margin: 0 }}>
            <div className="panel-head"><div><span className="eyebrow">LAVORAZIONI</span><h3>{activePanel?.name || 'Seleziona un pannello'}</h3></div></div>
            {!activePanel && <small>Seleziona un pannello per scegliere le lavorazioni suggerite.</small>}
            {activePanel && <div className="estimate-work-list compact">
              {standardWorks.map((work) => {
                const line = lineForPanelWork(activePanel.name, work.id)
                const checked = Boolean(line)
                const preview = line ? linePreview(line as EstimateLine) : { taxable: 0, total: 0 }
                const variants = variantOptionsFor(activePanel, work)
                const requiresVariantChoice = variants.length > 1
                const selectedVariant = (line?.paintCycle ?? '').trim() || activePanel.paintCycle.trim() || (variants.length === 1 ? variants[0] : '')
                const previewContext = {
                  panelId: activePanel.panelId,
                  panelName: activePanel.name,
                  repairExtent: activePanel.repairExtent,
                  paintCycle: selectedVariant,
                  standardWorkName: work.name,
                  description: work.name,
                } as Partial<EstimateLine>
                const standardPriceItem = requiresVariantChoice && !selectedVariant
                  ? null
                  : resolvePriceListItem(priceList, previewContext)
                const standardPrice = standardPriceItem ? Number(standardPriceItem.unitPrice ?? 0) : null
                const standardRule = resolveStandardRuleForLine(standardWorks, previewContext, timePresets)
                const hasConfiguredTime = Boolean(standardRule.rule) || Number(work.standardMinutes ?? 0) > 0
                const standardMinutesValue = hasConfiguredTime ? Math.max(0, Number(standardRule.standardMinutes ?? 0)) : null
                const estimatedMinutesValue = line ? Number(line.estimatedMinutes ?? 0) : null
                const appliedPriceValue = line ? Number(line.unitPrice ?? 0) : null
                const hasConfiguredPrice = standardPrice != null
                const timeOverridden = Boolean(line?.manualTimeOverride)
                const priceOverridden = Boolean(line && standardPrice != null && Math.abs(Number(line.unitPrice ?? 0) - standardPrice) > 0.0001)
                const economics = line ? economicsByLine[line.id] : null
                const detailKey = `${activePanel.id}-${work.id}`

                return <article className="estimate-work-item compact" key={detailKey}>
                  <div className="estimate-work-row-head">
                    <label className="estimate-work-head check">
                      <input type="checkbox" checked={checked} onChange={(event) => togglePanelWork(activePanel, work.id, event.target.checked)} />
                      <span>{work.name}</span>
                    </label>
                    <div className="estimate-work-quick-metrics">
                      <small>Tempo <strong>{estimatedMinutesValue == null ? (standardMinutesValue == null ? 'n/d' : humanDuration(standardMinutesValue)) : humanDuration(estimatedMinutesValue)}</strong></small>
                      <small>Prezzo <strong>{appliedPriceValue == null ? (standardPrice == null ? 'n/d' : money(standardPrice)) : (appliedPriceValue > 0 || hasConfiguredPrice ? money(appliedPriceValue) : 'Prezzo non configurato')}</strong></small>
                    </div>
                  </div>
                  <div className="estimate-work-row-actions">
                    <small>Selezione automatica da listino e tempi standard, modificabile solo se necessario.</small>
                    {checked && <button type="button" className="secondary" onClick={() => setExpandedWorkIds((current) => ({ ...current, [detailKey]: !current[detailKey] }))}>{expandedWorkIds[detailKey] ? 'Chiudi dettagli' : 'Dettagli'}</button>}
                  </div>

                  {checked && line && expandedWorkIds[detailKey] && <div className="estimate-work-detail">
                    {!!variants.length && <label>Tipo / Variante<select value={line.paintCycle ?? ''} onChange={(event) => onVariantChange(line, event.target.value)}>
                      {variants.length > 1 && <option value="">Seleziona variante</option>}
                      {variants.map((variant) => <option key={variant} value={variant}>{variant}</option>)}
                    </select></label>}

                    {(() => {
                      const item = lineListItem(line)
                      const listPrice = item ? Number(item.unitPrice ?? 0) : null
                      const isMismatch = listPrice != null && Math.abs(listPrice - Number(line.unitPrice ?? 0)) > 0.0001 && !dismissedPriceMismatch[line.id]
                      if (!isMismatch) return null
                      return <div className="estimate-price-alert">
                        <small>Prezzo listino attuale diverso dal prezzo applicato</small>
                        <div className="row-actions">
                          <button type="button" className="secondary" onClick={() => setDismissedPriceMismatch((current) => ({ ...current, [line.id]: true }))}>Mantieni prezzo preventivo</button>
                          <button type="button" className="primary" onClick={() => {
                            setManualPriceOverrides((current) => ({ ...current, [line.id]: false }))
                            setLines((current) => current.map((row) => row.id === line.id ? { ...row, unitPrice: listPrice ?? row.unitPrice } : row))
                          }}>Aggiorna al listino attuale</button>
                        </div>
                      </div>
                    })()}

                    <small>Regola tempo: <strong>{line.appliedRuleName || 'Tempo base'}</strong></small>
                    <small>Sequenza: <strong>{line.categoryOrPhase || 'Non definita'}</strong></small>
                    <small>Competenza/reparto: <strong>{line.requiredSkill || 'Non definita'}</strong></small>
                    <small>Tempo tecnico dopo lavorazione: <strong>{humanDuration(Number(line.technicalWaitMinutes ?? 0))}</strong></small>
                    {!!(line.technicalWaitBlocksPhaseNames ?? []).length && <small>Blocca: <strong>{(line.technicalWaitBlocksPhaseNames ?? []).join(', ')}</strong></small>}
                    <small>Costo interno: <strong>{money(Number(economics?.internalCostAmount ?? 0))}</strong></small>
                    <small>Margine teorico: <strong>{money(Number(economics?.theoreticalMarginAmount ?? 0))}</strong> ({Number(economics?.theoreticalMarginPercent ?? 0).toFixed(1)}%)</small>
                    <small>Stato marginalita: <strong>{marginStatusLabel(economics?.marginStatus)}</strong>{economics?.marginStatus === 'low' && internalCostSettings ? ` (soglia ${Number(internalCostSettings.minimumMarginPercent ?? 0).toFixed(1)}%)` : ''}</small>
                    <div className="estimate-inline-grid">
                      <label>Tempo preventivato (min)<input type="number" min="1" step="1" value={line.estimatedMinutes ?? work.standardMinutes} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, estimatedMinutes: Number(event.target.value), manualTimeOverride: true } : row))} /></label>
                      <label>Prezzo applicato<MoneyInput value={line.unitPrice} onValueChange={(value) => {
                        setManualPriceOverrides((current) => ({ ...current, [line.id]: true }))
                        setLines((current) => current.map((row) => row.id === line.id ? { ...row, unitPrice: value ?? 0 } : row))
                      }} /></label>
                      <label>Tempo tecnico dopo (min)<input type="number" min="0" step="1" value={line.technicalWaitMinutes ?? 0} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, technicalWaitMinutes: Number(event.target.value) } : row))} /></label>
                      <label>Sconto<MoneyInput value={line.discount} onValueChange={(value) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, discount: value ?? 0 } : row))} /></label>
                      <label>IVA %<input type="number" min="0" step="0.01" value={line.vatRate} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, vatRate: Number(event.target.value) } : row))} /></label>
                      <label>Quantita<input type="number" min="0" step="0.01" value={line.quantity} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, quantity: Number(event.target.value) } : row))} /></label>
                    </div>
                    <small>Override tempo: <strong>{timeOverridden ? 'Si' : 'No'}</strong> · Override prezzo: <strong>{priceOverridden ? 'Si' : 'No'}</strong></small>
                    <small>Imponibile riga: <strong>{money(preview.taxable)}</strong></small>
                    <small>Totale riga: <strong>{money(preview.total)}</strong></small>
                  </div>}
                </article>
              })}
              {!standardWorks.length && <small>Nessuna lavorazione standard attiva in configurazione Planner.</small>}
            </div>}
          </section>
        </div>
      </section>}

      {step === 4 && <section className="full panel estimate-step-panel" data-testid="estimate-confirm-step">
        <div className="panel-head"><div><span className="eyebrow">STEP 4</span><h3>Controlla e conferma</h3></div></div>
        <div className="estimate-visual-status-row">
          <div className={`estimate-status-pill ${summaryStatus.tone}`}>
            <strong>{summaryStatus.tone === 'green' ? 'Sostenibile' : summaryStatus.tone === 'yellow' ? 'Attenzione' : summaryStatus.tone === 'red' ? 'Critico' : 'Da completare'}</strong>
            <small>{summaryStatus.label}</small>
          </div>
          <p>{summaryStatus.message}</p>
        </div>

        <div className="summary-grid estimate-summary-kpis" data-testid="estimate-economic-step">
          <div className="summary-card"><span>Totale preventivo</span><strong>{money(totals.total)}</strong></div>
          <div className="summary-card"><span>Ore previste</span><strong>{humanDuration(vehicleMinutes)}</strong></div>
          <div className="summary-card"><span>Margine previsto</span><strong>{money(economicsTotals.totalMarginAmount)}</strong><small>{economicsTotals.marginPercent.toFixed(1)}%</small></div>
          <div className="summary-card"><span>Consegna stimata</span><strong>{productionForecast?.advisedDeliveryDate || '—'}</strong></div>
          <div className="summary-card"><span>Prima disponibilita</span><strong>{productionForecast?.firstAvailabilityDate || '—'}</strong></div>
          <div className="summary-card"><span>Affidabilita</span><strong>{productionForecast?.reliability || '—'}</strong></div>
        </div>

        <div className="estimate-timeline-board">
          {timelinePhases.map((item) => <article key={item.id} className={`estimate-timeline-phase ${item.minutes > 0 || item.id === 'Consegna' ? 'active' : ''}`}>
            <span>{item.label}</span>
            <strong>{item.id === 'Consegna' ? (productionForecast?.advisedDeliveryDate || '—') : item.minutes > 0 ? humanDuration(item.minutes) : '—'}</strong>
          </article>)}
        </div>

        {productionForecast?.requestedDeliveryDate && <div className="estimate-price-alert" style={{ marginTop: 10 }}>
          <small>{productionForecast.requestedDeliveryCompatible ? 'Consegna richiesta compatibile con il carico produttivo attuale.' : `ATTENZIONE: la data richiesta dal cliente non e compatibile. Prima data realistica: ${productionForecast.advisedDeliveryDate}.`}</small>
        </div>}

        <div className="estimate-summary-detail-stack">
          <button type="button" className="secondary" onClick={() => setSummaryDetailsOpen((current) => ({ ...current, economic: !current.economic }))}>{summaryDetailsOpen.economic ? 'Nascondi dettagli economici' : 'Dettagli economici'}</button>
          {summaryDetailsOpen.economic && <div className="panel" style={{ margin: 0 }}>
            <div className="summary-grid">
              <div className="summary-card"><span>Ricavo preventivo (imponibile)</span><strong>{money(totals.taxable)}</strong></div>
              <div className="summary-card"><span>Costo interno teorico totale</span><strong>{money(economicsTotals.totalInternalCost)}</strong></div>
              <div className="summary-card"><span>Margine teorico totale</span><strong>{money(economicsTotals.totalMarginAmount)}</strong></div>
              <div className="summary-card"><span>Margine % complessivo</span><strong>{economicsTotals.marginPercent.toFixed(1)}%</strong></div>
              <div className="summary-card"><span>Lavorazioni in perdita</span><strong>{economicsTotals.lossLines}</strong></div>
              <div className="summary-card"><span>Lavorazioni sotto margine minimo</span><strong>{economicsTotals.lowMarginLines}</strong></div>
              <div className="summary-card"><span>Imponibile complessivo</span><strong>{money(totals.taxable)}</strong></div>
              <div className="summary-card"><span>IVA</span><strong>{money(totals.vat)}</strong></div>
              <div className="summary-card"><span>Cliente</span><strong>{customerById(customerId)?.name || 'Seleziona cliente'}</strong></div>
            </div>
          </div>}

          <button type="button" className="secondary" onClick={() => setSummaryDetailsOpen((current) => ({ ...current, technical: !current.technical }))}>{summaryDetailsOpen.technical ? 'Nascondi dettagli tecnici' : 'Dettagli tecnici'}</button>
          {summaryDetailsOpen.technical && <div className="panel" style={{ margin: 0 }}>
            <div className="summary-grid">
              <div className="summary-card"><span>Pannelli selezionati</span><strong>{panels.length}</strong></div>
              <div className="summary-card"><span>Lavorazioni selezionate</span><strong>{selectedWorksCount}</strong></div>
              <div className="summary-card"><span>Inizio lavorazione previsto</span><strong>{productionForecast ? dateTime(productionForecast.estimatedStartAt) : '—'}</strong></div>
              <div className="summary-card"><span>Fine tecnica prevista</span><strong>{productionForecast ? dateTime(productionForecast.technicalCompletionAt) : '—'}</strong></div>
              <div className="summary-card"><span>Durata produttiva prevista</span><strong>{productionForecast ? humanDuration(productionForecast.productiveDurationMinutes) : '—'}</strong></div>
              <div className="summary-card"><span>Carico officina</span><strong>{productionForecast ? `${productionForecast.workshopLoadPercent.toFixed(1)}%` : '—'}</strong></div>
            </div>
            <div className="summary-grid" style={{ marginTop: 10 }}>{Array.from(phaseTotals.entries()).sort((a, b) => a[0].localeCompare(b[0], 'it-IT')).map(([phase, minutes]) => <div className="summary-card" key={phase}><span>{phase}</span><strong>{humanDuration(minutes)}</strong></div>)}</div>
            {!phaseTotals.size && <small>Nessuna fase riconosciuta dalle righe correnti.</small>}
          </div>}
        </div>
      </section>}

      <div className="full estimate-sticky-summary" data-testid="estimate-sticky-summary">
        <div className="estimate-sticky-metrics">
          <span>Pannelli <strong>{panels.length}</strong></span>
          <span>Lavorazioni <strong>{selectedWorksCount}</strong></span>
          <span>Tempo <strong>{humanDuration(vehicleMinutes)}</strong></span>
          <span>Imponibile <strong>{money(totals.taxable)}</strong></span>
          <span>IVA <strong>{money(totals.vat)}</strong></span>
          <span>TOTALE <strong>{money(totals.total)}</strong></span>
        </div>
        <div className="estimate-sticky-actions">
          <button type="button" className="secondary" onClick={onCancel}>Annulla</button>
          <button type="button" className="secondary" onClick={() => setStep((current) => Math.max(1, current - 1) as EstimateEditorStep)} disabled={step === 1}>Indietro</button>
          {step < 4 && <button type="button" className="primary" onClick={() => setStep((current) => Math.min(4, current + 1) as EstimateEditorStep)} disabled={!canAdvance[step]}>Avanti</button>}
          {step === 4 && <button className="secondary" type="submit">Salva bozza</button>}
          {step === 4 && <button type="button" className="primary" onClick={() => onConfirm?.({
            customerId,
            vehicleId: vehicleId || undefined,
            plate,
            companyName,
            contactName,
            date,
            priority,
            requestedDeliveryDate,
            notes,
            productionForecast: productionForecast ?? undefined,
            lines,
          })} disabled={!canAdvance[4] || !productionForecast}>Conferma preventivo</button>}
        </div>
      </div>
    </form>
  </Modal>
}

function DirectJobEditor({
  data,
  onCancel,
  onSubmit,
}: {
  data: ErpData
  onCancel: () => void
  onSubmit: (payload: {
    customerId: string
    vehicleId?: string
    plate: string
    companyName: string
    contactName: string
    entryDate: string
    expectedDeliveryDate: string
    priority: RepairJob['priority']
    responsible: string
    notes: string
    lines: EditableLine[]
  }) => void
}) {
  const [customerId, setCustomerId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [plate, setPlate] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10))
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(new Date().toISOString().slice(0, 10))
  const [priority, setPriority] = useState<RepairJob['priority']>('Normale')
  const [responsible, setResponsible] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()])

  const vehicleOptions = data.vehicles.filter((vehicle) => !customerId || vehicle.customerId === customerId)
  const standardWorks = (data.plannerSettings.standardWorks ?? [])
    .filter((item) => item.active)
    .sort((a, b) => a.cycleOrder - b.cycleOrder || a.name.localeCompare(b.name, 'it-IT'))
  const timePresets = data.plannerSettings.standardWorkTimePresets ?? []
  const applyRulePreview = (line: EditableLine, forceAuto = false): EditableLine => {
    const resolved = resolveStandardRuleForLine(standardWorks, line, timePresets)
    const nextEstimated = line.manualTimeOverride && !forceAuto
      ? (line.estimatedMinutes ?? resolved.standardMinutes)
      : resolved.standardMinutes
    return {
      ...line,
      standardWorkId: resolved.standard?.id ?? line.standardWorkId,
      standardWorkName: line.standardWorkName || resolved.standard?.name || line.description,
      categoryOrPhase: line.categoryOrPhase || resolved.standard?.categoryOrPhase || '',
      calculationType: resolved.standard?.calculationType ?? line.calculationType,
      standardMinutes: resolved.standardMinutes,
      estimatedMinutes: nextEstimated,
      appliedRuleId: resolved.rule?.id ?? '',
      appliedRuleName: resolved.rule?.name ?? '',
      appliedRuleSummary: resolved.summary,
    }
  }

  return <Modal title="Commessa diretta" onClose={onCancel}>
    <form className="form-grid" onSubmit={(event) => {
      event.preventDefault()
      onSubmit({
        customerId,
        vehicleId: vehicleId || undefined,
        plate,
        companyName,
        contactName,
        entryDate,
        expectedDeliveryDate,
        priority,
        responsible,
        notes,
        lines,
      })
    }}>
      <label>Cliente<select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Seleziona cliente</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
      <label>Veicolo<select value={vehicleId} onChange={(event) => {
        const next = event.target.value
        setVehicleId(next)
        const vehicle = data.vehicles.find((item) => item.id === next)
        if (vehicle) setPlate(vehicle.plate)
      }}><option value="">Nessun veicolo</option>{vehicleOptions.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} - {vehicle.make} {vehicle.model}</option>)}</select></label>
      <label>Targa<input required value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} /></label>
      <label>Azienda<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
      <label>Referente<input value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
      <label>Responsabile<input value={responsible} onChange={(event) => setResponsible(event.target.value)} /></label>
      <label>Data ingresso<input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
      <label>Consegna prevista<input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} /></label>
      <label>Priorità<select value={priority} onChange={(event) => setPriority(event.target.value as RepairJob['priority'])}><option>Normale</option><option>Alta</option><option>Urgente</option></select></label>
      <label className="full">Note<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>

      <div className="form-section-title">Lavorazioni iniziali</div>
      <div className="full" style={{ display: 'grid', gap: 10 }}>
        {lines.map((line) => {
          const preview = linePreview(line as EstimateLine)
          return <div className="finance-line-grid" key={line.id}>
            <label>Descrizione<input required value={line.description} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, description: event.target.value } : row))} /></label>
            <label>Pannello<input placeholder="Es. Porta posteriore SX" value={line.panelName ?? ''} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, panelName: event.target.value } : row))} /></label>
            <label>Dimensione vettura<select value={line.vehicleSizeClass ?? ''} onChange={(event) => setLines((current) => current.map((row) => {
              if (row.id !== line.id) return row
              return applyRulePreview({ ...row, vehicleSizeClass: event.target.value as 'piccola' | 'media' | 'grande' | '' })
            }))}><option value="">Non specificata</option><option value="piccola">Piccola</option><option value="media">Media</option><option value="grande">Grande</option></select></label>
            <label>Famiglia colore<input placeholder="Es. chiara" value={line.colorFamily ?? ''} onChange={(event) => setLines((current) => current.map((row) => {
              if (row.id !== line.id) return row
              return applyRulePreview({ ...row, colorFamily: event.target.value })
            }))} /></label>
            <label>Tipo vernice/ciclo<input placeholder="Es. opaco" value={line.paintCycle ?? ''} onChange={(event) => setLines((current) => current.map((row) => {
              if (row.id !== line.id) return row
              return applyRulePreview({ ...row, paintCycle: event.target.value })
            }))} /></label>
            <label>Categoria<select value={line.category} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, category: event.target.value as WorkCategory } : row))}>{WORK_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label>Lavorazione standard<select value={line.standardWorkName ?? ''} onChange={(event) => {
              const selected = standardWorks.find((item) => item.name === event.target.value)
              setLines((current) => current.map((row) => {
                if (row.id !== line.id) return row
                return applyRulePreview({
                  ...row,
                  standardWorkId: selected?.id ?? '',
                  standardWorkName: event.target.value,
                  calculationType: selected?.calculationType ?? 'per-vehicle',
                  standardMinutes: selected?.standardMinutes ?? 0,
                  requiredSkill: selected?.requiredSkill ?? row.requiredSkill,
                  cycleOrder: selected?.cycleOrder ?? row.cycleOrder,
                  manualTimeOverride: false,
                }, true)
              }))
            }}><option value="">Nessuna</option>{standardWorks.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
            <label>Tipo calcolo<input readOnly value={line.calculationType === 'per-panel' ? 'Per pannello' : 'Per vettura'} /></label>
            <label>Tempo standard<input readOnly value={line.standardMinutes ?? 0} /></label>
            <label>Tempo preventivato (min)<input type="number" min="1" step="1" value={line.estimatedMinutes ?? 60} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, estimatedMinutes: Number(event.target.value), manualTimeOverride: true } : row))} /></label>
            <label>Quantità<input type="number" min="0" step="0.01" value={line.quantity} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, quantity: Number(event.target.value) } : row))} /></label>
            <label>Prezzo unitario<MoneyInput value={line.unitPrice} onValueChange={(value) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, unitPrice: value ?? 0 } : row))} /></label>
            <label>Sconto<MoneyInput value={line.discount} onValueChange={(value) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, discount: value ?? 0 } : row))} /></label>
            <label>IVA %<input type="number" min="0" step="0.01" value={line.vatRate} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, vatRate: Number(event.target.value) } : row))} /></label>
            <div><small>Override manuale</small><strong>{line.manualTimeOverride ? 'Si' : 'No'}</strong></div>
            <div><small>Regola applicata</small><strong>{line.appliedRuleName || 'Tempo base'}</strong><small>{line.appliedRuleSummary || 'Tempo base lavorazione'}</small></div>
            <div><small>Totale minuti riga</small><strong>{humanDuration(estimateLineTotalMinutes(line as EstimateLine))}</strong></div>
            <div><small>Imponibile</small><strong>{money(preview.taxable)}</strong></div>
            <div><small>Totale</small><strong>{money(preview.total)}</strong></div>
            <button type="button" className="danger" onClick={() => setLines((current) => current.length === 1 ? current : current.filter((row) => row.id !== line.id))}>Rimuovi</button>
          </div>
        })}
        <button type="button" className="secondary" onClick={() => setLines((current) => [...current, emptyLine()])}>Aggiungi riga</button>
      </div>

      <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>Annulla</button><button className="primary">Crea commessa</button></div>
    </form>
  </Modal>
}

function JobEditor({
  data,
  customerById,
  job,
  onCancel,
  onSubmit,
  onUpdatePhase,
  onSetPhaseOperators,
  onUpdatePhaseEstimatedMinutes,
  onToggleChecklist,
}: {
  data: ErpData
  customerById: (id: string) => Customer | undefined
  job?: RepairJob
  onCancel: () => void
  onSubmit: (jobId: string, payload: { expectedDeliveryDate: string; priority: RepairJob['priority']; responsible: string; notes: string }) => void
  onUpdatePhase: (jobId: string, phaseId: string, payload: { status: JobPhaseStatus; notes?: string; blockedReason?: string; notRequired?: boolean }) => void
  onSetPhaseOperators: (jobId: string, phaseId: string, operatorNames: string[]) => void
  onUpdatePhaseEstimatedMinutes: (jobId: string, phaseId: string, minutes: number, reason: string) => void
  onToggleChecklist: (jobId: string, itemId: string, checked: boolean) => void
}) {
  const [responsible, setResponsible] = useState(job?.responsible ?? '')
  const [priority, setPriority] = useState<RepairJob['priority']>(job?.priority ?? 'Normale')
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(job?.expectedDeliveryDate ?? new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState(job?.notes ?? '')
  const [phaseMinutesDraft, setPhaseMinutesDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries((job?.phases ?? []).map((phase) => [phase.id, phase.estimatedMinutes])))
  const [phaseReasonDraft, setPhaseReasonDraft] = useState<Record<string, string>>({})

  if (!job) return null

  const operatorOptions = Array.from(new Set([
    ...data.plannerSettings.operators.map((operator) => operator.name.trim()).filter(Boolean),
    ...(data.production?.identities ?? []).map((identity) => identity.operatorName.trim()).filter(Boolean),
    ...job.phases.flatMap((phase) => phaseAllOperators(phase)),
  ])).sort((a, b) => a.localeCompare(b, 'it-IT'))

  const linkedInvoice = data.invoices.find((invoice) => invoice.lines.some((line) => line.vehicleId && line.vehicleId === job.vehicleId))
  const residual = linkedInvoice ? Math.max(0, linkedInvoice.total - linkedInvoice.collectedAmount - linkedInvoice.ribaAllocatedAmount) : 0
  const totalPlannedMinutes = job.phases.filter((phase) => !phase.notRequired).reduce((sum, phase) => sum + Math.max(0, phase.estimatedMinutes), 0)

  return <Modal title={`Scheda commessa ${job.number}`} onClose={onCancel}>
    <form className="form-grid" onSubmit={(event) => {
      event.preventDefault()
      onSubmit(job.id, { expectedDeliveryDate, priority, responsible, notes })
    }}>
      <label>Cliente<input readOnly value={customerById(job.customerId)?.name ?? ''} /></label>
      <label>Targa<input readOnly value={job.plate} /></label>
      <label>Consegna prevista<input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} /></label>
      <label>Priorità<select value={priority} onChange={(event) => setPriority(event.target.value as RepairJob['priority'])}><option>Normale</option><option>Alta</option><option>Urgente</option></select></label>
      <label>Responsabile<input value={responsible} onChange={(event) => setResponsible(event.target.value)} /></label>
      <label>Cono assegnato<input readOnly value={job.coneNumber ?? 'Non assegnato'} /></label>
      <label className="full">Note<input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>

      <div className="full summary-grid">
        <div className="summary-card"><span>Imponibile</span><strong>{money(job.taxableAmount)}</strong></div>
        <div className="summary-card"><span>IVA</span><strong>{money(job.vatAmount)}</strong></div>
        <div className="summary-card"><span>Totale</span><strong>{money(job.total)}</strong></div>
        <div className="summary-card"><span>Ore previste commessa</span><strong>{humanDuration(totalPlannedMinutes)}</strong></div>
        <div className="summary-card"><span>Avanzamento</span><strong>{job.progressPercent}%</strong></div>
      </div>

      <div className="full panel" style={{ margin: 0 }}>
        <div className="panel-head"><div><span className="eyebrow">FASI OPERATIVE</span><h3>Aggiornamento rapido</h3></div></div>
        <div className="job-phases-list">
          {job.phases.map((phase) => {
            const phaseClass = phase.status === 'Completata'
              ? 'job-phase-row completed'
              : phase.status === 'Bloccata'
                ? 'job-phase-row blocked'
                : phase.status === 'In lavorazione'
                  ? 'job-phase-row current'
                  : 'job-phase-row'
            const isQuality = phase.name === 'Controllo qualità'
            return <div key={phase.id} className={phaseClass}>
              {(() => {
                const activeOperators = phaseActiveOperators(phase)
                const allOperators = phaseAllOperators(phase)
                const duration = phaseDurationMinutes(phase)
                const manMinutes = phaseManMinutes(phase)
                return <>
              <div className="job-phase-head">
                <div className="job-phase-title-wrap">
                  <strong className="job-phase-title">{phase.name}</strong>
                  <small className="job-phase-duration">Durata lavorazione: {duration ? humanDuration(duration) : 'Nessuna durata consuntiva'}</small>
                </div>
                <span className="tag">{phase.status}</span>
              </div>
              <div className="job-phase-meta">
                <small>Inizio: {dateTime(phase.startedAt)}</small>
                <small>Fine: {dateTime(phase.endedAt)}</small>
                <small>Operatori coinvolti: {allOperators.length}</small>
                <small>Ore uomo: {humanDuration(manMinutes)}</small>
                <small>Attivi ora: {activeOperators.length ? activeOperators.join(', ') : 'Nessuno'}</small>
                {phase.notRequired && <small className="tag">Non necessaria</small>}
              </div>
              <div className="job-phase-controls">
                <label>Stato<select value={phase.status} onChange={(event) => onUpdatePhase(job.id, phase.id, { status: event.target.value as JobPhaseStatus, notes: phase.notes, blockedReason: phase.blockedReason, notRequired: phase.notRequired })}><option>Da fare</option><option>In lavorazione</option><option>Completata</option><option>Bloccata</option></select></label>
                <label>Operatori attivi<select multiple value={activeOperators} onChange={(event) => onSetPhaseOperators(job.id, phase.id, Array.from(event.target.selectedOptions).map((option) => option.value))}>{operatorOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                {!isQuality && <label className="check">Non necessaria<input type="checkbox" checked={Boolean(phase.notRequired)} onChange={(event) => onUpdatePhase(job.id, phase.id, { status: phase.status, notes: phase.notes, blockedReason: phase.blockedReason, notRequired: event.target.checked })} /></label>}
              </div>
              <div className="job-phase-controls">
                <label>Note<input value={phase.notes} onChange={(event) => onUpdatePhase(job.id, phase.id, { status: phase.status, notes: event.target.value, blockedReason: phase.blockedReason, notRequired: phase.notRequired })} /></label>
                <label>Motivo blocco<input value={phase.blockedReason} onChange={(event) => onUpdatePhase(job.id, phase.id, { status: phase.status, notes: phase.notes, blockedReason: event.target.value, notRequired: phase.notRequired })} /></label>
              </div>
              <div className="job-phase-controls">
                <label>Tempo preventivato (min)<input type="number" min="1" step="1" value={phaseMinutesDraft[phase.id] ?? phase.estimatedMinutes} onChange={(event) => setPhaseMinutesDraft((current) => ({ ...current, [phase.id]: Number(event.target.value) }))} /></label>
                <label>Motivazione modifica tempo<input value={phaseReasonDraft[phase.id] ?? ''} onChange={(event) => setPhaseReasonDraft((current) => ({ ...current, [phase.id]: event.target.value }))} placeholder="Es. lavoro aggiuntivo emerso" /></label>
                <button type="button" className="secondary" onClick={() => onUpdatePhaseEstimatedMinutes(job.id, phase.id, phaseMinutesDraft[phase.id] ?? phase.estimatedMinutes, phaseReasonDraft[phase.id] ?? '')}>Aggiorna tempo fase</button>
              </div>
              {!!(phase.timeAdjustments?.length) && <div className="job-phase-meta">{(phase.timeAdjustments ?? []).slice(0, 5).map((entry) => <small key={entry.id}>{dateTime(entry.at)} • {entry.fromMinutes}{' -> '}{entry.toMinutes} min • {entry.reason}</small>)}</div>}
              </>
              })()}
            </div>
          })}
        </div>
      </div>

      <div className="full panel" style={{ margin: 0 }}>
        <div className="panel-head"><div><span className="eyebrow">CHECKLIST QUALITÀ</span><h3>Obbligatoria prima di pronta consegna</h3></div></div>
        <div style={{ display: 'grid', gap: 8 }}>
          {(job.qualityChecklist ?? []).map((item) => <label className="check" key={item.id}><input type="checkbox" checked={item.checked} onChange={(event) => onToggleChecklist(job.id, item.id, event.target.checked)} />{item.label}</label>)}
          {!job.qualityChecklist.length && <small>Nessun template configurato. Configura la checklist dalla pagina principale.</small>}
        </div>
      </div>

      <div className="full panel" style={{ margin: 0 }}>
        <div className="panel-head"><div><span className="eyebrow">COLLEGAMENTO ECONOMICO</span><h3>Separazione valore / incasso</h3></div></div>
        {!linkedInvoice && <div className="empty-small">Nessuna fattura collegata: la commessa non genera incasso automatico.</div>}
        {linkedInvoice && <div className="summary-grid">
          <div className="summary-card"><span>Fattura</span><strong>{linkedInvoice.number}</strong></div>
          <div className="summary-card"><span>Importo</span><strong>{money(linkedInvoice.total)}</strong></div>
          <div className="summary-card"><span>Residuo</span><strong>{money(residual)}</strong></div>
          <div className="summary-card"><span>Stato pagamento</span><strong>{linkedInvoice.status}</strong></div>
        </div>}
      </div>

      <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>Chiudi</button><button className="primary">Salva scheda</button></div>
    </form>
  </Modal>
}

function ChecklistTemplateEditor({
  data,
  onCancel,
  onSubmit,
}: {
  data: ErpData
  onCancel: () => void
  onSubmit: (labels: string[]) => void
}) {
  const [draft, setDraft] = useState((data.qualityChecklistTemplates ?? []).join('\n'))
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit(draft.split('\n').map((line) => line.trim()).filter(Boolean))
  }
  return <Modal title="Template checklist qualità" onClose={onCancel}>
    <form className="form-grid" onSubmit={submit}>
      <label className="full">Una voce per riga<textarea rows={10} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Lavorazioni completate\nControllo verniciatura\nRimontaggio\nSpie/errori\nPulizia\nDocumentazione\nControllo finale" /></label>
      <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>Annulla</button><button className="primary">Salva template</button></div>
    </form>
  </Modal>
}
