import { useMemo, useState, type FormEvent } from 'react'
import {
  activeWorkLogForVehicle,
  buildTodayInShopSnapshot,
  completeVehiclePhase,
  defaultProductionIdentity,
  markVehicleReady,
  openProductionReports,
  paceStateByVehicle,
  resolveVehicleBlock,
  signalVehicleBlock,
  startVehiclePhase,
  timerMinutesByVehicleAndPhase,
} from './production'
import { isVehicleWaitingForCone } from '../../services/erp'
import { workflowOperationalSnapshot } from '../../services/workflow'
import type { Customer, ErpData, ProductionReportType, VehicleStatus } from '../../types'

const dateTime = (value: string) => new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
const humanDuration = (minutes: number) => {
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  if (!hours) return `${rest} min`
  return `${hours} h ${String(rest).padStart(2, '0')} min`
}

const coneLabel = (coneNumber: number | null | undefined, status?: string) => {
  if (coneNumber != null) return String(coneNumber)
  if (!status) return '—'
  return isVehicleWaitingForCone({ coneNumber: null, status: status as VehicleStatus }) ? 'In attesa cono (Nessun cono disponibile)' : '—'
}

const REPORT_OPTIONS: ProductionReportType[] = ['ricambio mancante', 'problema tecnico', 'lavorazione aggiuntiva', 'danno non previsto', 'richiesta all\'ufficio', 'altro']

export function TodayShopPage({ data, customerById, onOpenPlanner, onOpenVehicles, onOpenPractice, onChange, setNotice, setError, onUpdateVehicleStatus, statusOptions, statusLabel }: {
  data: ErpData
  customerById: (id: string) => Customer | undefined
  onOpenPlanner: () => void
  onOpenVehicles: () => void
  onOpenPractice: (plate: string) => void
  onChange: (next: ErpData) => void
  setNotice: (value: string) => void
  setError: (value: string) => void
  onUpdateVehicleStatus: (vehicleId: string, status: string) => void
  statusOptions: Array<{ id: string; label: string }>
  statusLabel: (status: string) => string
}) {
  const snapshot = buildTodayInShopSnapshot(data)
  const reports = openProductionReports(data)
  const identity = defaultProductionIdentity(data)
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [reportType, setReportType] = useState<ProductionReportType>('richiesta all\'ufficio')
  const [reportNote, setReportNote] = useState('')

  const rows = useMemo(() => {
    const jobs = data.production?.jobs ?? []
    return jobs.map((job) => {
      const vehicle = data.vehicles.find((item) => item.id === job.vehicleId)
      const customer = vehicle ? customerById(vehicle.customerId) : undefined
      const workflowJob = (data.jobs ?? []).find((item) => item.vehicleId === job.vehicleId && item.status !== 'Annullata')
      const workflow = workflowJob ? workflowOperationalSnapshot(workflowJob) : null
      const activeLog = activeWorkLogForVehicle(data, job.vehicleId)
      const openForVehicle = reports.filter((report) => report.vehicleId === job.vehicleId)
      const elapsed = timerMinutesByVehicleAndPhase(data, job.vehicleId, job.phase)
      const pace = paceStateByVehicle(data, job.vehicleId)
      return { job, vehicle, customer, workflowJob, workflow, activeLog, openForVehicle, elapsed, pace }
    }).filter((row) => row.vehicle)
  }, [data, reports, customerById])

  const selected = rows.find((row) => row.job.vehicleId === selectedVehicleId) ?? rows[0]

  const apply = (next: ErpData, successMessage: string) => {
    onChange(next)
    setError('')
    setNotice(successMessage)
  }

  const quickStart = (vehicleId: string) => {
    try {
      apply(startVehiclePhase(data, vehicleId, identity), 'Fase avviata e tempi aggiornati.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Avvio fase non riuscito.')
    }
  }

  const quickComplete = (vehicleId: string) => {
    try {
      apply(completeVehiclePhase(data, vehicleId, identity), 'Fase completata con aggiornamento pratica.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Completamento fase non riuscito.')
    }
  }

  const quickReady = (vehicleId: string) => {
    try {
      apply(markVehicleReady(data, vehicleId, identity), 'Pratica impostata su pronta.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Impostazione pronta non riuscita.')
    }
  }

  const quickResolve = (reportId: string) => {
    try {
      apply(resolveVehicleBlock(data, reportId), 'Segnalazione risolta e stato pratica aggiornato.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Risoluzione blocco non riuscita.')
    }
  }

  const submitBlock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected?.vehicle) return
    try {
      const next = signalVehicleBlock(data, selected.vehicle.id, reportType, reportNote, identity)
      apply(next, 'Blocco segnalato e vettura aggiornata.')
      setReportNote('')
      setReportType('richiesta all\'ufficio')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Segnalazione blocco non riuscita.')
    }
  }

  return <>
    <section className="welcome">
      <div><span className="eyebrow">OGGI IN CARROZZERIA</span><h2>Fasi, tempi e segnalazioni in tempo reale</h2><p>Vista ufficio sincronizzata con i tablet di produzione.</p></div>
      <div className="planner-actions"><button className="secondary" onClick={onOpenPlanner}>Apri Planner</button><button className="secondary" onClick={onOpenVehicles}>Apri Veicoli</button><a className="primary tablet-link" href="/production.html">Apri Tablet Produzione</a></div>
    </section>

    <section className="owner-kpi-grid">
      <article className="owner-kpi-card"><span>Segnalazioni aperte</span><strong>{snapshot.alertsOpen}</strong><small>Blocchi e richieste dal reparto.</small></article>
      <article className="owner-kpi-card"><span>Timer attivi</span><strong>{snapshot.activeTimers}</strong><small>Lavorazioni in corso adesso.</small></article>
      <article className="owner-kpi-card"><span>Consegne oggi</span><strong>{snapshot.dueToday}</strong><small>Pratiche con data promessa odierna.</small></article>
      <article className="owner-kpi-card"><span>In ritardo</span><strong>{snapshot.overdue}</strong><small>Pratiche oltre la data promessa.</small></article>
    </section>

    <section className="panel today-ops-panel">
      <div className="panel-head"><div><span className="eyebrow">GESTIONE RAPIDA</span><h3>Pratiche operative</h3></div></div>
      <div className="today-ops-grid">{rows.map((row) => {
        const blocked = row.openForVehicle.length > 0
        const operatorLabel = row.workflow?.lastOperator || row.activeLog?.operatorName || row.openForVehicle[0]?.operatorName || '—'
        const elapsedLabel = row.activeLog ? humanDuration(row.elapsed) : row.elapsed ? `${row.elapsed} min registrati` : 'Nessun tempo registrato'
        const activeOperatorsLabel = row.workflow?.activeOperators?.length ? row.workflow.activeOperators.join(', ') : 'Nessuno'
        const paceLabel = row.pace?.level ?? 'IN ORARIO'
        const phasePanelNotes = Array.from(new Set((row.workflowJob?.lines ?? [])
          .filter((line) => String(line.categoryOrPhase ?? '').trim().toLowerCase() === String(row.job.phase ?? '').trim().toLowerCase())
          .map((line) => String(line.panelWorkNote ?? '').trim())
          .filter(Boolean)))
        return <article className={selected?.job.vehicleId === row.job.vehicleId ? 'today-vehicle-card active' : 'today-vehicle-card'} key={row.job.vehicleId} onClick={() => setSelectedVehicleId(row.job.vehicleId)}>
          <div className="today-vehicle-head"><strong>{row.vehicle?.plate}</strong><span>{row.customer?.name || 'Cliente'}</span></div>
          <div className="today-vehicle-info"><small>Commessa: {row.workflowJob?.number || '—'}</small><small>Cono: {coneLabel(row.vehicle?.coneNumber, row.vehicle?.status)}</small><small>Stato vettura: {row.vehicle ? <select value={row.vehicle.status} onChange={(event) => { event.stopPropagation(); onUpdateVehicleStatus(row.vehicle!.id, event.target.value) }}>{(statusOptions.some((status) => status.id === row.vehicle!.status) ? statusOptions : [...statusOptions, { id: row.vehicle!.status, label: statusLabel(row.vehicle!.status) }]).map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select> : '—'}</small><small>Fase corrente: {row.workflow?.currentPhase || row.job.phase}</small><small>Avanzamento: {row.workflow?.progressPercent ?? 0}%</small><small>Ultima fase completata: {row.workflow?.lastCompletedPhase || '—'}</small><small>Prossima fase: {row.workflow?.nextPhase || '—'}</small><small>Operatori attivi: {activeOperatorsLabel}</small><small>Operatori coinvolti fase: {row.workflow?.operatorCount ?? 0}</small><small>Durata lavorazione fase: {humanDuration(row.workflow?.phaseDurationMinutes ?? 0)}</small><small>Ore uomo fase: {humanDuration(row.workflow?.manHoursMinutes ?? 0)}</small><small>Operatore ultimo aggiornamento: {operatorLabel}</small><small>Tempo: {elapsedLabel}</small><small>Consegna prevista: {row.job.promisedAt || 'Non definita'}</small><small>Motivo segnalazione: {row.openForVehicle[0]?.note || row.vehicle?.blockReason || 'Nessuno'}</small><small>Stato tabella di marcia: {paceLabel}</small><small>Note pannello fase: {phasePanelNotes.join(' | ') || 'Nessuna'}</small></div>
          <div className="today-actions">
            <button className="primary" onClick={() => quickStart(row.job.vehicleId)}>Avvia fase</button>
            <button className="secondary" onClick={() => quickComplete(row.job.vehicleId)} disabled={row.job.phase === 'Pronta'}>Completa fase</button>
            <button className="secondary" onClick={() => quickReady(row.job.vehicleId)} disabled={row.job.phase === 'Pronta'}>Pronta per consegna</button>
            <button className="secondary" onClick={() => onOpenPractice(row.vehicle?.plate || '')}>Apri pratica</button>
            <span className={paceLabel === 'IN RITARDO' ? 'tag late' : paceLabel === 'A RISCHIO' ? 'tag warning' : blocked ? 'tag' : 'tag ok'}>{paceLabel === 'IN RITARDO' ? 'IN RITARDO' : paceLabel === 'A RISCHIO' ? 'A RISCHIO' : blocked ? `${row.openForVehicle.length} blocchi` : 'IN ORARIO'}</span>
          </div>
        </article>
      })}</div>
      {!rows.length && <div className="empty">Nessuna pratica attiva oggi.</div>}
    </section>

    {selected?.vehicle && <section className="panel today-report-panel">
      <div className="panel-head"><div><span className="eyebrow">SEGNALA BLOCCO</span><h3>{selected.vehicle.plate} · {selected.customer?.name || 'Cliente'}</h3></div></div>
      <form className="today-report-form" onSubmit={submitBlock}>
        <label>Motivo<select value={reportType} onChange={(event) => setReportType(event.target.value as ProductionReportType)}>{REPORT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label>Dettaglio<textarea required rows={3} value={reportNote} onChange={(event) => setReportNote(event.target.value)} placeholder="Descrivi il blocco reale sulla vettura" /></label>
        <button className="primary">Segnala blocco</button>
      </form>
    </section>}

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">SEGNALAZIONI PRODUZIONE</span><h3>Gestione e risoluzione</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>Vettura</th><th>Cliente</th><th>Cono</th><th>Stato vettura</th><th>Fase</th><th>Operatore</th><th>Tempo</th><th>Consegna</th><th>Motivo</th><th>Azione</th></tr></thead><tbody>{reports.map((report) => {
        const row = rows.find((item) => item.job.vehicleId === report.vehicleId)
        const elapsed = row ? humanDuration(row.elapsed) : '—'
        return <tr key={report.id}><td><strong>{row?.vehicle?.plate || 'Vettura'}</strong></td><td>{row?.customer?.name || 'Cliente'}</td><td>{coneLabel(row?.vehicle?.coneNumber, row?.vehicle?.status)}</td><td>{row?.vehicle ? <select value={row.vehicle.status} onChange={(event) => onUpdateVehicleStatus(row.vehicle!.id, event.target.value)}>{(statusOptions.some((status) => status.id === row.vehicle!.status) ? statusOptions : [...statusOptions, { id: row.vehicle!.status, label: statusLabel(row.vehicle!.status) }]).map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select> : '—'}</td><td>{row?.job.phase || '—'}</td><td>{report.operatorName}</td><td>{elapsed}</td><td>{row?.job.promisedAt || 'Non definita'}</td><td><strong>{report.type}</strong><small>{report.note}</small><small>{dateTime(report.createdAt)}</small></td><td><button className="primary" onClick={() => quickResolve(report.id)}>Risolvi blocco</button></td></tr>
      })}</tbody></table></div>
      {!reports.length && <div className="empty">Nessuna segnalazione aperta.</div>}
    </section>
  </>
}
