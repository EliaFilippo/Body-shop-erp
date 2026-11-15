import { useState } from 'react'
import type { ErpData, ManualOperatorDay, OperatorDayProgram } from '../../types'
import { closedPlanningWork } from '../../services/closedPlanningWork'
import { phaseDisplayName } from '../../services/workCycle'
import { manualOperatorPhaseMinutes, manualOperatorWorkIntervals } from '../../services/planner'

const durationLabel = (minutes: number) => `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`

export function ManualOperatorDayEditor({ data, date, programs, timeLabel, coneLabel, onSave }: {
  data: ErpData
  date: string
  programs: Pick<OperatorDayProgram, 'operatorId' | 'tasks'>[]
  timeLabel: (iso: string) => string
  coneLabel: (jobId: string, vehicleId?: string) => string
  onSave: (plan: ManualOperatorDay) => void
}) {
  const saved = data.plannerSettings.manualOperatorDays?.find(plan => plan.date === date)
  const [period, setPeriod] = useState<ManualOperatorDay['period']>(saved?.period ?? 'day')
  const [assignments, setAssignments] = useState(saved?.assignments ?? [])
  const closed = closedPlanningWork(data)
  const available = (data.jobs ?? []).filter(job => job.vehicleId && !closed.jobIds.has(job.id))
    .flatMap(job => job.phases
      .filter(phase => !phase.notRequired && phase.status !== 'Completata' && phase.name !== 'Consegna')
      .map(phase => ({ job, phase, key: JSON.stringify([job.id, phase.id]) })))
  const operatorsByPhase = new Map<string, Set<string>>()
  for (const program of programs) {
    for (const task of program.tasks) {
      const key = JSON.stringify([task.jobId, task.phaseId])
      const operators = operatorsByPhase.get(key) ?? new Set<string>()
      operators.add(program.operatorId)
      operatorsByPhase.set(key, operators)
    }
  }

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
    <p>Il giorno e l’ordine scelti fanno parte del piano manuale. Gli orari sono indicativi e la disponibilità effettiva delle fasi è mostrata sul tablet.</p>
    <p>Al salvataggio il gestionale completa il turno con le lavorazioni disponibili, anche anticipando quelle dei giorni successivi.</p>
    <p>Per aggiungere una vettura mantenendo le fasi già pianificate, riprendile per l’operatore interessato e poi aggiungi la nuova fase.</p>
    {data.plannerSettings.operators.filter(operator => operator.active).map(operator => {
      const rows = assignments.flatMap((row, index) => {
        if (row.operatorId !== operator.id) return []
        const job = data.jobs?.find(item => item.id === row.jobId)
        const phase = job?.phases.find(item => item.id === row.phaseId)
        const minutes = job?.vehicleId && !closed.jobIds.has(job.id) && phase ? manualOperatorPhaseMinutes(phase) : 0
        return [{ row, index, job, phase, minutes }]
      })
      const assignedMinutes = rows.reduce((sum, row) => sum + row.minutes, 0)
      const capacity = (scope: ManualOperatorDay['period']) => manualOperatorWorkIntervals(date, scope, data.plannerSettings, operator)
        .reduce((sum, interval) => sum + interval.endMinute - interval.startMinute, 0)
      const dayMinutes = capacity('day')
      const periodMinutes = period === 'day' ? dayMinutes : capacity(period)
      const tasks = programs.find(program => program.operatorId === operator.id)?.tasks ?? []
      const options = available.filter(({ job, phase }) =>
        !assignments.some(row => row.jobId === job.id && row.phaseId === phase.id))
      const remaining = new Set(options.map(option => option.key))
      const importable = tasks.flatMap(task => {
        const key = JSON.stringify([task.jobId, task.phaseId])
        const start = timeLabel(task.startAt)
        const end = timeLabel(task.endAt)
        const inPeriod = period === 'day' || (period === 'morning' ? start < '13:00' : end > '13:00')
        if (!inPeriod || operatorsByPhase.get(key)?.size !== 1 || !remaining.delete(key)) return []
        return [{ operatorId: operator.id, jobId: task.jobId, phaseId: task.phaseId }]
      })
      return <div key={operator.id}>
        <h4>{operator.name}</h4>
        <p><strong>Assegnate a mano {durationLabel(assignedMinutes)}</strong> · Turno {durationLabel(dayMinutes)} · Da completare {durationLabel(Math.max(0, dayMinutes - assignedMinutes))}</p>
        {period !== 'day' && <p>Disponibili nella fascia {durationLabel(periodMinutes)}</p>}
        {assignedMinutes > periodMinutes && <p>Oltre la fascia selezionata di {durationLabel(assignedMinutes - periodMinutes)}</p>}
        {tasks.length > 0 && <>
          <strong>Programma attuale</strong>
          <ul>{tasks.map(task => <li key={task.id}>
            {timeLabel(task.startAt)}–{timeLabel(task.endAt)} · {task.plate} · {coneLabel(task.jobId, task.vehicleId)} · {phaseDisplayName(task.phaseName)} · {durationLabel(task.plannedMinutes)}
          </li>)}</ul>
          {importable.length > 0 && <button type="button" onClick={() => setAssignments(current => [...current, ...importable])}>
            Riprendi le fasi pianificate di {operator.name}
          </button>}
        </>}
        {rows.length > 0 && <strong>Assegnazioni manuali</strong>}
        <ol>{rows.map(({ row, index, job, phase, minutes }, position) => {
          return <li key={JSON.stringify([row.jobId, row.phaseId])}>
            {job ? `${job.plate} · ${coneLabel(job.id, job.vehicleId)}` : 'Vettura non disponibile'} · {phaseDisplayName(phase?.name ?? 'Fase non disponibile')}{phase?.status === 'Completata' ? ' · Completata' : ''}
            {minutes > 0 && ` · ${durationLabel(minutes)}`}
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
          {options.map(({ job, phase, key }) => <option key={key} value={key}>{job.plate} · {coneLabel(job.id, job.vehicleId)} · {phaseDisplayName(phase.name)} · {durationLabel(manualOperatorPhaseMinutes(phase))}</option>)}
        </select>
      </div>
    })}
    <button className="primary" type="button" onClick={() => onSave({ date, period, assignments })}>Salva e calcola orari</button>
    {saved && <button type="button" onClick={() => { setAssignments([]); onSave({ date, period, assignments: [] }) }}>Torna alla pianificazione automatica</button>}
  </section>
}
