import { useEffect, useState, type FormEvent } from 'react'
import '../../App.css'
import { loadDatabase, saveDatabase } from '../../services/database'
import { ORIGIN_BLOCK_MESSAGE, isFileOrigin, tryRedirectFromFileOrigin } from '../../services/originGuard'
import { changeVehicleStatus } from '../../services/erp'
import { nextTaskForOperator, recalculateOperatorPrograms, todayKey } from '../../services/planner'
import type { ErpData, ProductionOperatorIdentity, ProductionPhase, ProductionReportType } from '../../types'
import { listSelectableVehicleStatuses, resolveVehicleStatusId } from '../../services/vehicleStatuses'
import {
  PRODUCTION_PHASES,
  PRODUCTION_REPORT_TYPES,
  buildTodayInShopSnapshot,
  defaultProductionIdentity,
  listProductionWorkLogs,
  moveProductionPhase,
  openProductionReports,
  pauseProductionTimer,
  paceStateByVehicle,
  reportProductionIssue,
  resumeProductionTimer,
  runProductionDelayControl,
  startProductionTimer,
  stopProductionTimer,
  syncProductionJobsFromVehicles,
  syncVehicleWorkedHoursFromProduction,
  totalWorkedHoursByVehicle,
} from './production'

const prettyDateTime = (value: string) =>
  new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
const hhmm = (value: string) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(value))

interface TabletState {
  data: ErpData
  identity: ProductionOperatorIdentity
}

export function ProductionPage() {
  const blockedByOrigin = isFileOrigin()
  const [state, setState] = useState<TabletState | null>(null)
  const [query, setQuery] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [reportNote, setReportNote] = useState('')
  const [reportType, setReportType] = useState<ProductionReportType>('richiesta all\'ufficio')
  const [photoDataUrl, setPhotoDataUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (blockedByOrigin) {
      tryRedirectFromFileOrigin()
    }
  }, [blockedByOrigin])

  useEffect(() => {
    void loadDatabase()
      .then((loaded) => {
        const synced = runProductionDelayControl(
          recalculateOperatorPrograms(syncVehicleWorkedHoursFromProduction(syncProductionJobsFromVehicles(loaded)), todayKey(), 'Ricalcolo automatico tablet'),
          'Controllo tempi in apertura tablet',
        )
        const identity = defaultProductionIdentity(synced)
        setState({ data: synced, identity })
        void saveDatabase(synced).catch((problem) => setError(problem instanceof Error ? problem.message : 'Impossibile salvare i dati.'))
      })
      .catch((problem) => setError(problem instanceof Error ? problem.message : 'Impossibile caricare il database.'))
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setState((current) => {
        if (!current) return current
        const hasRunning = (current.data.production?.workLogs ?? []).some((log) => log.status === 'running')
        if (!hasRunning) return current
        const nextData = runProductionDelayControl(current.data, 'Controllo tempi periodico tablet')
        if (JSON.stringify(nextData.production?.paceStates ?? []) === JSON.stringify(current.data.production?.paceStates ?? [])) {
          return current
        }
        void saveDatabase(nextData).catch((problem) => setError(problem instanceof Error ? problem.message : 'Impossibile salvare i dati.'))
        return { ...current, data: nextData }
      })
    }, 30_000)
    return () => clearInterval(timer)
  }, [])

  const persist = (nextData: ErpData) => {
    const synced = runProductionDelayControl(
      recalculateOperatorPrograms(syncVehicleWorkedHoursFromProduction(syncProductionJobsFromVehicles(nextData)), todayKey(), 'Ricalcolo automatico tablet'),
      'Controllo tempi dopo operazione tablet',
    )
    setState((current) => {
      const identity = current?.identity ?? defaultProductionIdentity(synced)
      return { data: synced, identity }
    })
    void saveDatabase(synced).catch((problem) => setError(problem instanceof Error ? problem.message : 'Impossibile salvare i dati.'))
  }

  if (blockedByOrigin) {
    return <main className="origin-blocked"><h1>{ORIGIN_BLOCK_MESSAGE}</h1></main>
  }

  if (!state) {
    return <main className="production-tablet"><section className="tablet-top"><h1>Caricamento produzione...</h1></section></main>
  }

  const { data, identity } = state
  const statusOptions = listSelectableVehicleStatuses(data.plannerSettings)
  const jobs = data.production?.jobs ?? []
  const reports = openProductionReports(data)
  const snapshot = buildTodayInShopSnapshot(data)
  const rows = jobs
    .map((job) => {
      const vehicle = data.vehicles.find((item) => item.id === job.vehicleId)
      const customer = vehicle ? data.customers.find((item) => item.id === vehicle.customerId) : undefined
      const workflowJob = (data.jobs ?? []).find((item) => item.vehicleId === job.vehicleId && item.status !== 'Annullata')
      return { job, vehicle, customer, workflowJob }
    })
    .filter((row) => row.vehicle)
    .filter((row) => {
      const value = `${row.vehicle?.plate} ${row.vehicle?.make} ${row.vehicle?.model} ${row.customer?.name || ''}`.toLowerCase()
      return value.includes(query.toLowerCase())
    })

  const selected = rows.find((row) => row.job.vehicleId === selectedVehicleId) ?? rows[0]
  const selectedPhasePanelNotes = Array.from(new Set((selected?.workflowJob?.lines ?? [])
    .filter((line) => String(line.categoryOrPhase ?? '').trim().toLowerCase() === String(selected?.job.phase ?? '').trim().toLowerCase())
    .map((line) => String(line.panelWorkNote ?? '').trim())
    .filter(Boolean)))
  const selectedPhasePanels = Array.from(new Set((selected?.workflowJob?.lines ?? [])
    .filter((line) => String(line.categoryOrPhase ?? '').trim().toLowerCase() === String(selected?.job.phase ?? '').trim().toLowerCase())
    .map((line) => String(line.panelName ?? '').trim())
    .filter(Boolean)))
  const assignedProgram = (data.operatorPrograms ?? []).find((program) => program.date === todayKey() && program.operatorId === identity.operatorId)
  const nextTask = nextTaskForOperator(data, identity.operatorId)
  const selectedPace = selected ? paceStateByVehicle(data, selected.job.vehicleId) : null
  const latePace = rows
    .map((row) => paceStateByVehicle(data, row.job.vehicleId))
    .find((item) => item?.level === 'IN RITARDO')
  const stepPhase = (vehicleId: string, currentPhase: ProductionPhase, direction: -1 | 1) => {
    const index = PRODUCTION_PHASES.indexOf(currentPhase)
    const next = PRODUCTION_PHASES[index + direction]
    if (!next) return
    try {
      persist(moveProductionPhase(data, {
        vehicleId,
        nextPhase: next,
        operator: identity,
      }))
      setNotice(`Fase aggiornata a ${next}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Aggiornamento fase non riuscito.')
    }
  }

  const submitReport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    try {
      persist(reportProductionIssue(data, {
        vehicleId: selected.job.vehicleId,
        type: reportType,
        note: reportNote,
        photoDataUrl: photoDataUrl || undefined,
        operator: identity,
      }))
      setReportNote('')
      setPhotoDataUrl('')
      setNotice('Segnalazione registrata e visibile all\'ufficio.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Impossibile registrare la segnalazione.')
    }
  }

  const activeLog = selected
    ? listProductionWorkLogs(data, selected.job.vehicleId)
      .find((log) => log.operatorId === identity.operatorId && log.status !== 'completed')
    : undefined

  const handleTimer = () => {
    if (!selected) return
    if (!activeLog) {
      persist(startProductionTimer(data, {
        vehicleId: selected.job.vehicleId,
        phase: selected.job.phase,
        operator: identity,
      }))
      setNotice('Timer avviato.')
      return
    }
    if (activeLog.status === 'running') {
      persist(pauseProductionTimer(data, activeLog.id))
      setNotice('Timer in pausa.')
      return
    }
    persist(resumeProductionTimer(data, activeLog.id))
    setNotice('Timer ripreso.')
  }

  const closeTimer = () => {
    if (!activeLog) return
    persist(stopProductionTimer(data, activeLog.id))
    setNotice('Timer terminato e ore sincronizzate.')
  }

  return <main className="production-tablet">
    <section className="tablet-top">
      <div>
        <span className="eyebrow">TABLET PRODUZIONE</span>
        <h1>Oggi in carrozzeria</h1>
        <p>Operatore: {identity.operatorName}. Nessun dato economico o finanziario visibile in questa modalità.</p>
      </div>
      <a className="secondary tablet-link" href="/">Apri gestionale ufficio</a>
    </section>

    {notice && <div className="toast success">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="toast error">{error}<button onClick={() => setError('')}>×</button></div>}
    {latePace && <section className="delay-banner"><h2>LAVORAZIONE IN RITARDO</h2><p>{latePace.phaseName} - {data.vehicles.find((vehicle) => vehicle.id === latePace.vehicleId)?.plate || 'Vettura'}</p><p>Previsto: {Math.round(latePace.estimatedMinutes / 60)} h</p><p>Effettivo: {Math.floor(latePace.workedMinutes / 60)} h {latePace.workedMinutes % 60} min</p><p>Ritardo: +{Math.max(0, latePace.workedMinutes - latePace.estimatedMinutes)} min</p></section>}

    <section className="tablet-kpis">
      <article><span>Segnalazioni aperte</span><strong>{snapshot.alertsOpen}</strong></article>
      <article><span>Timer attivi</span><strong>{snapshot.activeTimers}</strong></article>
      <article><span>Consegne oggi</span><strong>{snapshot.dueToday}</strong></article>
      <article><span>In ritardo</span><strong>{snapshot.overdue}</strong></article>
      <article><span>Priorita urgente</span><strong>{snapshot.byPriority.urgente}</strong></article>
      <article><span>Priorita alta</span><strong>{snapshot.byPriority.alta}</strong></article>
    </section>

    <section className="tablet-search">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca targa, modello, cliente" />
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">PROGRAMMA OPERATORE</span><h3>{identity.operatorName}</h3></div><button className="secondary" onClick={() => persist(recalculateOperatorPrograms(data, todayKey(), 'Ricalcolo piano manuale da tablet'))}>Ricalcola piano</button></div>
      <div className="table-wrap"><table><thead><tr><th>Orario</th><th>Commessa</th><th>Fase</th><th>Vettura</th><th>Durata</th><th>Pannelli / note</th><th>Motivo</th></tr></thead><tbody>{(assignedProgram?.tasks ?? []).map((task) => <tr key={task.id}><td>{hhmm(task.startAt)}-{hhmm(task.endAt)}</td><td>{task.jobNumber}</td><td>{task.phaseName}</td><td>{task.plate}</td><td>{task.plannedMinutes} min</td><td><small>{task.panelNames?.join(', ') || '—'}</small><small>{task.panelNotes?.join(' | ') || 'Nessuna nota pannello'}</small></td><td>{task.reason}</td></tr>)}</tbody></table></div>
      {!(assignedProgram?.tasks ?? []).length && <div className="empty">Nessuna attivita assegnata per oggi.</div>}
      {nextTask && <div className="toast success">Prossima attivita: {nextTask.jobNumber} - {nextTask.phaseName} - {nextTask.plate}</div>}
    </section>

    <section className="tablet-phases">
      {snapshot.phaseCards.map((card) => <article className="phase-column" key={card.phase}>
        <header>
          <h3>{card.phase}</h3>
          <b>{card.jobs.length}</b>
        </header>
        <div className="phase-cards">
          {rows.filter((row) => row.job.phase === card.phase).map((row) => {
            const selectedRow = selected?.job.vehicleId === row.job.vehicleId
            const workedHours = totalWorkedHoursByVehicle(data, row.job.vehicleId)
            const openForVehicle = reports.filter((report) => report.vehicleId === row.job.vehicleId).length
            return <button className={selectedRow ? 'phase-card active' : 'phase-card'} key={row.job.vehicleId} onClick={() => setSelectedVehicleId(row.job.vehicleId)}>
              <strong>{row.vehicle?.plate}</strong>
              <small>{row.customer?.name || 'Cliente'}</small>
              <small>{row.vehicle?.make} {row.vehicle?.model}</small>
              <small>Ore lavorate: {workedHours.toFixed(2)}</small>
              <small>Segnalazioni aperte: {openForVehicle}</small>
            </button>
          })}
          {!rows.filter((row) => row.job.phase === card.phase).length && <div className="empty-small">Nessuna vettura in questa fase.</div>}
        </div>
      </article>)}
    </section>

    {selected && <section className="tablet-detail">
      <header>
        <h2>{selected.vehicle?.plate} · {selected.vehicle?.make} {selected.vehicle?.model}</h2>
        <div className="phase-controls">
          <button className="secondary" onClick={() => stepPhase(selected.job.vehicleId, selected.job.phase, -1)}>Fase precedente</button>
          <b>{selected.job.phase}</b>
          <button className="primary" onClick={() => stepPhase(selected.job.vehicleId, selected.job.phase, 1)}>Fase successiva</button>
        </div>
      </header>
      <div className="detail-grid">
        <article>
          <h3>Tempi lavorazione</h3>
          {selected.vehicle && <label>Stato vettura<select value={selected.vehicle.status} onChange={(event) => {
            persist(changeVehicleStatus(data, selected.vehicle!.id, resolveVehicleStatusId(data.plannerSettings, event.target.value), { source: 'manual', note: 'Aggiornamento manuale da Produzione.' }))
            setNotice('Stato vettura aggiornato manualmente.')
          }}>{(statusOptions.some((status) => status.id === selected.vehicle!.status) ? statusOptions : [...statusOptions, { id: selected.vehicle!.status, label: selected.vehicle!.status }]).map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></label>}
          {!!selectedPhasePanels.length && <p><strong>PANNELLI IN FASE:</strong> {selectedPhasePanels.join(', ')}</p>}
          {!!selectedPhasePanelNotes.length && <p><strong>NOTE DEL PANNELLO:</strong> {selectedPhasePanelNotes.join(' | ')}</p>}
          <p>Promessa consegna: {selected.job.promisedAt || 'Non definita'}</p>
          <p>Ore stimate: {selected.vehicle?.estimatedHours ?? 0}</p>
          <p>Ore lavorate: {totalWorkedHoursByVehicle(data, selected.job.vehicleId).toFixed(2)}</p>
          {selectedPace && <div className="pace-box">
            <p>Tempo previsto: {Math.floor(selectedPace.estimatedMinutes / 60)} h {selectedPace.estimatedMinutes % 60} min</p>
            <p>Tempo lavorato: {Math.floor(selectedPace.workedMinutes / 60)} h {selectedPace.workedMinutes % 60} min</p>
            <p>Tempo residuo: {Math.floor(selectedPace.residualMinutes / 60)} h {selectedPace.residualMinutes % 60} min</p>
            <p>Consumo previsto: {selectedPace.consumedPercent}%</p>
            <p className={selectedPace.level === 'IN RITARDO' ? 'pace-level late' : selectedPace.level === 'A RISCHIO' ? 'pace-level warning' : 'pace-level normal'}>{selectedPace.level}</p>
            {selectedPace.level === 'A RISCHIO' && <div className="toast warning">ATTENZIONE - restano {selectedPace.residualMinutes} minuti rispetto al tempo preventivato</div>}
          </div>}
          <div className="timer-actions">
            <button className="primary" onClick={handleTimer}>{!activeLog ? 'Avvia timer' : activeLog.status === 'running' ? 'Pausa timer' : 'Riprendi timer'}</button>
            <button className="secondary" onClick={closeTimer} disabled={!activeLog}>Chiudi timer</button>
          </div>
          {activeLog && <small>Sessione {activeLog.status} iniziata il {prettyDateTime(activeLog.startedAt)}</small>}
        </article>
        <article>
          <h3>Segnalazioni reparto</h3>
          <form onSubmit={submitReport} className="report-form">
            <label>Tipo
              <select value={reportType} onChange={(event) => setReportType(event.target.value as ProductionReportType)}>
                {PRODUCTION_REPORT_TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label>Nota operativa
              <textarea required rows={3} value={reportNote} onChange={(event) => setReportNote(event.target.value)} placeholder="Descrivi il blocco o la richiesta" />
            </label>
            <label>Foto (data URL opzionale)
              <input value={photoDataUrl} onChange={(event) => setPhotoDataUrl(event.target.value)} placeholder="data:image/..." />
            </label>
            <button className="primary">Invia segnalazione</button>
          </form>
        </article>
      </div>
      <article className="panel table-panel">
        <div className="panel-head"><div><span className="eyebrow">SEGNALAZIONI APERTE</span><h3>{reports.length} totali</h3></div></div>
        <div className="table-wrap"><table><thead><tr><th>Vettura</th><th>Tipo</th><th>Nota</th><th>Operatore</th><th>Data</th></tr></thead><tbody>{reports.map((report) => {
          const reportVehicle = data.vehicles.find((item) => item.id === report.vehicleId)
          return <tr key={report.id}><td>{reportVehicle?.plate || 'Vettura'}</td><td>{report.type}</td><td>{report.note}</td><td>{report.operatorName}</td><td>{prettyDateTime(report.createdAt)}</td></tr>
        })}</tbody></table></div>
      </article>
    </section>}
  </main>
}
