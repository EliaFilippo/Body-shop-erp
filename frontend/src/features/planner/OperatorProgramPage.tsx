import { useMemo } from 'react'
import { isVehicleWaitingForCone } from '../../services/erp'
import { recalculateOperatorPrograms, todayKey } from '../../services/planner'
import type { ErpData } from '../../types'

const timeLabel = (iso: string) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso))

export function OperatorProgramPage({ data, onChange }: { data: ErpData; onChange: (next: ErpData) => void }) {
  const date = todayKey()
  const programs = useMemo(() => (data.operatorPrograms ?? []).filter((item) => item.date === date).sort((a, b) => a.operatorName.localeCompare(b.operatorName, 'it-IT')), [data.operatorPrograms, date])
  const history = useMemo(() => (data.operatorProgramHistory ?? []).filter((item) => item.date === date).slice(0, 6), [data.operatorProgramHistory, date])
  const coneLabelByTask = (jobId: string, vehicleId: string) => {
    const job = (data.jobs ?? []).find((item) => item.id === jobId)
    if (job?.coneNumber != null) return `Cono ${job.coneNumber}`
    const vehicle = data.vehicles.find((item) => item.id === vehicleId)
    if (vehicle?.coneNumber != null) return `Cono ${vehicle.coneNumber}`
    return vehicle && isVehicleWaitingForCone(vehicle) ? 'In attesa cono (Nessun cono disponibile)' : '—'
  }

  return <>
    <section className="welcome">
      <div>
        <span className="eyebrow">PROGRAMMA OPERATORI</span>
        <h2>Piano giornaliero autonomo</h2>
        <p>Sequenza attivita per operatore calcolata da priorita, consegne, stato fase, compatibilita e disponibilita.</p>
      </div>
      <div className="planner-actions">
        <button className="primary" onClick={() => onChange(recalculateOperatorPrograms(data, date, 'Ricalcolo piano manuale'))}>Ricalcola piano</button>
      </div>
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">TIMELINE</span><h3>{date}</h3></div></div>
      <div className="week-grid">
        {programs.map((program) => <article className="day-card" key={program.operatorId}>
          <div className="day-head"><strong>{program.operatorName}</strong><span>rev. {program.revision}</span></div>
          <div className="day-jobs">
            {program.tasks.map((task) => <div className="day-job" key={task.id}>
              <strong className="plate">{timeLabel(task.startAt)}-{timeLabel(task.endAt)}</strong>
              <span>{task.jobNumber} - {task.phaseName} - {task.plate}</span>
              <small>{task.plannedMinutes} min · {task.priority}</small>
              <small>{coneLabelByTask(task.jobId, task.vehicleId)}</small>
              {!!task.panelNames?.length && <small>Pannelli: {task.panelNames.join(', ')}</small>}
              {!!task.panelNotes?.length && <small>Note pannello: {task.panelNotes.join(' | ')}</small>}
              <small>{task.reason}</small>
            </div>)}
            {!program.tasks.length && <small>Nessuna attivita assegnata.</small>}
          </div>
        </article>)}
        {!programs.length && <article className="day-card"><div className="day-head"><strong>Nessun programma disponibile</strong></div><small>Esegui Ricalcola piano per generare il piano giornaliero.</small></article>}
      </div>
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">STORICO</span><h3>Revisioni automatiche</h3></div></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Revisione</th><th>Generato</th><th>Motivo</th><th>Operatori</th><th>Attivita</th></tr></thead>
          <tbody>
            {history.map((entry) => <tr key={entry.id}>
              <td>{entry.revision}</td>
              <td>{new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.generatedAt))}</td>
              <td>{entry.reason}</td>
              <td>{entry.programs.length}</td>
              <td>{entry.programs.reduce((sum, program) => sum + program.tasks.length, 0)}</td>
            </tr>)}
            {!history.length && <tr><td colSpan={5}><div className="empty">Nessuna revisione disponibile.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </>
}
