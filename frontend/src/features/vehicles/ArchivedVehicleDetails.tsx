import { Modal } from '../../components/Modal'
import { deliveredJobReport, deliveredPhaseTime, reportDuration } from '../../services/deliveredJobReport'
import { phaseDisplayName } from '../../services/workCycle'
import type { ProductionWorkLog, RepairJob, Vehicle } from '../../types'

const currency = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const dateTime = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })
const timestamp = (iso?: string) => iso && Number.isFinite(Date.parse(iso)) ? dateTime.format(new Date(iso)) : '—'

export function ArchivedVehicleDetails({ vehicle, customer, jobs, logs, onClose }: {
  vehicle: Vehicle
  customer: string
  jobs: RepairJob[]
  logs: ProductionWorkLog[]
  onClose: () => void
}) {
  const costs = [...(vehicle.costEntries ?? [])].sort((a, b) => b.usedAt.localeCompare(a.usedAt))

  return <Modal title={`Lavorazioni e materiali · ${vehicle.plate}`} onClose={onClose} className="vehicle-history-detail">
    {customer && <p>{customer}</p>}
    {!jobs.length && <p>Nessuna commessa collegata alla vettura.</p>}
    {jobs.map(job => <ArchivedJob key={job.id} job={job} />)}

    <section>
      <h3>Materiali, ricambi e costi registrati sulla vettura</h3>
      {costs.length ? <div className="table-wrap"><table>
        <thead><tr><th>Data</th><th>Voce</th><th>Fornitore / documento</th><th>Quantità</th><th>Costo unitario</th><th>Totale registrato</th></tr></thead>
        <tbody>{costs.map(entry => <tr key={entry.id}>
          <td>{entry.usedAt}</td><td>{entry.description}<small>{entry.category}</small>{entry.note && <small>{entry.note}</small>}</td>
          <td>{entry.supplier || '—'}{entry.documentNo && <small>{entry.documentNo}</small>}</td>
          <td>{entry.quantity} {entry.unit}</td><td>{currency.format(entry.unitCost)}{entry.discount > 0 && <small>Sconto {currency.format(entry.discount)}</small>}</td>
          <td>{currency.format(entry.total)}<small>IVA {entry.vatRate}%</small></td>
        </tr>)}</tbody>
      </table></div> : <p>Nessuna voce di costo registrata sulla vettura.</p>}
    </section>

    {logs.length > 0 && <details>
      <summary>Registro timer della vettura</summary>
      <div className="table-wrap"><table>
        <thead><tr><th>Fase</th><th>Operatore</th><th>Inizio</th><th>Fine</th><th>Tempo registrato</th></tr></thead>
        <tbody>{logs.map(log => <tr key={log.id}>
          <td>{phaseDisplayName(log.phase)}</td><td>{log.operatorName}</td><td>{timestamp(log.startedAt)}</td>
          <td>{timestamp(log.endedAt)}</td><td>{reportDuration(log.totalMinutes * 60)}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    <div className="form-actions"><button type="button" onClick={onClose}>Chiudi</button></div>
  </Modal>
}

function ArchivedJob({ job }: { job: RepairJob }) {
  const report = deliveredJobReport(job)
  const phases = job.phases.filter(phase => !phase.notRequired || phase.actualMinutes > 0 || phase.notes
    || phase.blockedReason || phase.operatorAssignments?.length || (phase.tabletWorkedSeconds ?? 0) > 0)
  const actual = job.materialActualCost
  return <section className="vehicle-history-job">
    <h3>{job.number} · {job.status}</h3>
    {job.deliveredAt && <p>Consegna {timestamp(job.deliveredAt)}</p>}
    <div className="summary-grid">
      <div className="summary-card"><span>Ore previste</span><strong>{reportDuration(report.plannedSeconds)}</strong></div>
      <div className="summary-card">
        <span>Ore registrate</span><strong>{report.complete || report.workedSeconds > 0 ? reportDuration(report.workedSeconds) : 'Da registrare'}</strong>
        {report.missing > 0 && <small>{report.missing} fasi con dati incompleti</small>}
      </div>
      <div className="summary-card"><span>Materiali stimati · IVA esclusa</span><strong>{currency.format(report.materials.estimatedMaterials)}</strong></div>
      <div className="summary-card"><span>Materiali a consuntivo · IVA esclusa</span><strong>{actual ? currency.format(actual.amount) : 'Da registrare'}</strong>
        {actual?.note && <small>{actual.note}</small>}
        {actual && <small>{timestamp(actual.at)}</small>}
      </div>
    </div>
    <h4>Fasi e operatori</h4>
    {phases.length ? <div className="table-wrap"><table>
      <thead><tr><th>Fase e stato</th><th>Inizio / fine</th><th>Tempo registrato</th><th>Operatori</th><th>Note</th></tr></thead>
      <tbody>{phases.map(phase => {
        const time = deliveredPhaseTime(phase)
        return <tr key={phase.id}>
          <th scope="row">{phaseDisplayName(phase.name)}<small>{phase.status}</small></th>
          <td>{timestamp(phase.startedAt)}<small>{timestamp(phase.completedAt || phase.endedAt)}</small></td>
          <td>{time.timeComplete || time.workedSeconds > 0 ? reportDuration(time.workedSeconds)
            : phase.actualMinutes > 0 ? <>{reportDuration(phase.actualMinutes * 60)}<small>Registrato nella fase</small></> : '—'}</td>
          <td>{time.closed.map(assignment => <small key={assignment.id}>{assignment.operatorName} · {reportDuration(assignment.workedMinutes * 60)}</small>)}
            {phase.completedByName && <small>Completata da {phase.completedByName}</small>}
            {!time.closed.length && !phase.completedByName && (phase.operatorName || '—')}
          </td>
          <td>{[phase.notes, phase.blockedReason].filter(Boolean).join(' · ') || '—'}</td>
        </tr>
      })}</tbody>
    </table></div> : <p>Nessuna fase registrata.</p>}
    {job.lines.length > 0 && <details>
      <summary>Voci della commessa</summary>
      <div className="table-wrap"><table>
        <thead><tr><th>Descrizione</th><th>Pannello</th><th>Categoria</th><th>Quantità</th></tr></thead>
        <tbody>{job.lines.map(line => <tr key={line.id}><td>{line.description}{line.panelWorkNote && <small>{line.panelWorkNote}</small>}</td>
          <td>{line.panelName || '—'}</td><td>{line.category}</td><td>{line.quantity}</td></tr>)}</tbody>
      </table></div>
    </details>}
    {!!job.materialCostHistory?.length && <details>
      <summary>Storico dei materiali a consuntivo</summary>
      <ul>{job.materialCostHistory.map((entry, index) => <li key={`${entry.at}-${index}`}>{timestamp(entry.at)} · {currency.format(entry.amount)}
        {entry.note && ` · ${entry.note}`}</li>)}</ul>
    </details>}
  </section>
}
