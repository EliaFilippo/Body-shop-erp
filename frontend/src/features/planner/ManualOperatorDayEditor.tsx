import { useState } from 'react'
import type { ErpData, ManualOperatorDay } from '../../types'
import { closedPlanningWork, waitingPartsPlanningWork } from '../../services/closedPlanningWork'
import { supportsOperatorDuty } from '../../services/operatorSkills'
import { phaseDisplayName } from '../../services/workCycle'

export function ManualOperatorDayEditor({ data, date, onSave }: {
  data: ErpData
  date: string
  onSave: (plan: ManualOperatorDay) => void
}) {
  const saved = data.plannerSettings.manualOperatorDays?.find(plan => plan.date === date)
  const [period, setPeriod] = useState<ManualOperatorDay['period']>(saved?.period ?? 'day')
  const [assignments, setAssignments] = useState(saved?.assignments ?? [])
  const closed = closedPlanningWork(data)
  const waiting = waitingPartsPlanningWork(data)
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date())
  const available = (data.jobs ?? []).filter(job => job.vehicleId && !closed.jobIds.has(job.id)
    && !waiting.jobIds.has(job.id) && !job.blocks.length && !data.vehicles.find(vehicle => vehicle.id === job.vehicleId)?.blockReason).flatMap(job => job.phases
      .filter(phase => !phase.notRequired && phase.status === 'Da fare' && phase.name !== 'Consegna')
      .map(phase => ({ job, phase, key: JSON.stringify([job.id, phase.id]) })))

  const move = (index: number, direction: number) => {
    const current = assignments[index]
    const target = direction < 0
      ? assignments.findLastIndex((row, i) => i < index && row.operatorId === current.operatorId)
      : assignments.findIndex((row, i) => i > index && row.operatorId === current.operatorId)
    if (target === -1) return
    const next = [...assignments]
    next[index] = next[target]
    next[target] = current
    setAssignments(next)
  }

  return <section className="panel table-panel" aria-label="Modifica programma del giorno">
    <h3>Modifica programma del giorno · {date}</h3>
    <label>Parte della giornata <select value={period} onChange={event => setPeriod(event.target.value as ManualOperatorDay['period'])}>
      <option value="day">Giornata intera</option>
      <option value="morning">Mattina fino alle 13:00</option>
      <option value="afternoon">Pomeriggio dalle 13:00</option>
    </select></label>
    <p>Metti in ordine le fasi per ogni operatore. Il gestionale calcola gli orari quando le fasi sono eseguibili, tenendo conto dei lavori in corso e dei turni. Le fasi senza spazio slittano al primo orario disponibile.</p>
    {data.plannerSettings.operators.filter(operator => operator.active).map(operator => {
      const rows = assignments.map((row, index) => ({ row, index })).filter(({ row }) => row.operatorId === operator.id)
      const options = available.filter(({ job, phase }) => supportsOperatorDuty(operator, phase.requiredSkill || phase.name)
        && !assignments.some(row => row.jobId === job.id && row.phaseId === phase.id)
        && !(data.plannerSettings.manualOperatorDays ?? []).some(plan => plan.date !== date && plan.date >= today
          && plan.assignments.some(row => row.jobId === job.id && row.phaseId === phase.id)))
      return <div key={operator.id}>
        <h4>{operator.name}</h4>
        <ol>{rows.map(({ row, index }, position) => {
          const job = data.jobs?.find(item => item.id === row.jobId)
          const phase = job?.phases.find(item => item.id === row.phaseId)
          return <li key={JSON.stringify([row.jobId, row.phaseId])}>
            {job?.plate ?? 'Vettura non disponibile'} · {phaseDisplayName(phase?.name ?? 'Fase non disponibile')}{phase?.status === 'Completata' ? ' · Completata' : ''}
            <button type="button" disabled={position === 0} onClick={() => move(index, -1)}>Su</button>
            <button type="button" disabled={position === rows.length - 1} onClick={() => move(index, 1)}>Giù</button>
            <button type="button" onClick={() => setAssignments(current => current.filter((_, i) => i !== index))}>Rimuovi</button>
          </li>
        })}</ol>
        <select aria-label={`Aggiungi fase per ${operator.name}`} value="" onChange={event => {
          const selected = options.find(option => option.key === event.target.value)
          if (selected) setAssignments(current => [...current, { operatorId: operator.id, jobId: selected.job.id, phaseId: selected.phase.id }])
        }}>
          <option value="">Aggiungi fase…</option>
          {options.map(({ job, phase, key }) => <option key={key} value={key}>{job.plate} · {phaseDisplayName(phase.name)}</option>)}
        </select>
      </div>
    })}
    <button className="primary" type="button" onClick={() => onSave({ date, period, assignments })}>Salva e calcola orari</button>
    {saved && <button type="button" onClick={() => { setAssignments([]); onSave({ date, period, assignments: [] }) }}>Torna alla pianificazione automatica</button>}
  </section>
}
