import { useEffect, useMemo, useState } from 'react'
import { marginTargetRate } from '../../services/marginTargetRate'
import { MarginTargetRatePanel } from './MarginTargetRatePanel'
import { calculateGoalProgress, goalWeekStart, remainingWeeklyMarginGoals } from '../../services/goalProgress'
import { addDays } from '../../services/workCalendar'
import type { VehicleWork } from '../../services/productionPlanningState'
import type { ErpData } from '../../types'

const money = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
const displayDate = new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', dateStyle: 'medium' })
const formatDate = (day: string) => displayDate.format(new Date(day + 'T12:00:00Z'))

export function GoalProgressPanel({ data, vehicleWork }: { data: ErpData; vehicleWork?: VehicleWork[] }) {
  const [today, setToday] = useState(() => date.format(new Date()))
  const [selectedDay, setSelectedDay] = useState<string>()
  const [selectedWeek, setSelectedWeek] = useState<string>()
  useEffect(() => {
    const timer = setInterval(() => setToday(date.format(new Date())), 30_000)
    return () => clearInterval(timer)
  }, [])
  const monday = goalWeekStart(today)
  const day = selectedDay ?? today
  const week = selectedWeek ?? monday
  const periods = useMemo(() => calculateGoalProgress(data, today, vehicleWork, { day, week }), [data, today, vehicleWork, day, week])

  const target = useMemo(() => marginTargetRate(data, today.slice(0, 7), today, periods[2]), [data, today, periods])

  const breakdown = useMemo(() => remainingWeeklyMarginGoals(data, today, target?.remainingMargin ?? 0), [data, today, target?.remainingMargin])

  return <>
  <section className="panel" aria-label="Avanzamento obiettivi di margine">
    <div className="panel-head"><div><span className="eyebrow">MARGINE · IVA ESCLUSA</span><h3>Avanzamento obiettivi</h3></div></div>
    <div className="owner-kpi-grid">
      {periods.map(period => {
        const hasGoal = period.goal > 0
        const canCalculate = hasGoal && period.hasMargin
        const reached = canCalculate && period.gap === 0
        const partial = period.incomplete || period.provisional
        const confirmed = reached && !partial
        const width = canCalculate ? Math.min(100, Math.max(0, 100 * period.done / period.goal)) : 0
        const history = period.label === 'Oggi'
          ? { value: day, current: today, step: 1, unit: 'giorno', set: setSelectedDay, label: formatDate(day) }
          : period.label === 'Settimana'
            ? { value: week, current: monday, step: 7, unit: 'settimana', set: setSelectedWeek, label: formatDate(week) + ' – ' + formatDate(addDays(week, 6)) }
            : null
        const historical = history && history.value !== history.current
        return <article className="owner-kpi-card" key={period.label}>
          <span>{historical && period.label === 'Oggi' ? 'Giorno' : period.label}</span>
          {history && <div>
            <small aria-live="polite">{history.label}</small>
            <div className="planner-actions" style={{ justifyContent: 'flex-start' }}>
              <button type="button" aria-label={history.unit === 'giorno' ? 'Giorno precedente' : 'Settimana precedente'}
                onClick={() => history.set(addDays(history.value, -history.step))}>‹</button>
              <button type="button" aria-label={history.unit === 'giorno' ? 'Giorno successivo' : 'Settimana successiva'}
                disabled={!historical} onClick={() => {
                  const next = addDays(history.value, history.step)
                  history.set(next >= history.current ? undefined : next)
                }}>›</button>
              {historical && <button type="button" onClick={() => history.set(undefined)}>
                {history.unit === 'giorno' ? 'Torna a oggi' : 'Settimana attuale'}
              </button>}
            </div>
          </div>}
          <strong>{canCalculate ? money.format(period.gap) : '—'}</strong>
          <small>{!hasGoal ? 'Obiettivo da impostare' : !canCalculate ? 'Dati da completare'
            : reached ? (partial ? 'Stima sopra o pari all’obiettivo · da confermare' : 'Obiettivo raggiunto')
            : historical ? (partial ? 'Scostamento · stima parziale' : 'Scostamento dall’obiettivo')
            : (partial ? 'Da raggiungere · stima parziale' : 'Da raggiungere')}</small>
          {period.payrollActual !== undefined && <small>Conguaglio dipendenti: {money.format(period.payrollAdjustment)} di costo aggiuntivo</small>}
          {historical && period.label === 'Oggi' && <>
            <small>Obiettivo base del giorno: {hasGoal ? money.format(period.goal) : '—'}</small>
            <small>{partial ? 'Margine provvisorio' : 'Margine registrato'}: {period.hasMargin ? money.format(period.done) : '—'}</small>
          </>}
          {canCalculate && <div role="progressbar" aria-label={`Avanzamento ${period.label.toLowerCase()}`}
            aria-valuenow={Math.round(width)} aria-valuetext={`${money.format(period.gap)} da raggiungere${partial ? ', stima parziale' : ''}`}
            style={{ height: 7, borderRadius: 6, overflow: 'hidden', background: confirmed ? 'var(--green)' : reached ? '#a96918' : '#9c3939' }}>
            {!reached && <div style={{ height: '100%', width: `${width}%`, background: 'var(--red)' }} />}
          </div>}
        </article>
      })}
    </div>
  </section>
  {target && <section className="panel" aria-label="Ripartizione del margine residuo fino a fine mese">
    <div className="panel-head"><h3>Obiettivi delle settimane rimanenti</h3></div>
    <p>Margine da recuperare dal {formatDate(today)} alla fine del mese, distribuito in base alle ore disponibili degli operatori. Le settimane già trascorse non vengono conteggiate.</p>
    <div className="planner-detail-summary-grid economic-grid">
      <div><span>Residuo mensile da recuperare</span><strong>{money.format(target.remainingMargin)}</strong></div>
      <div><span>Ore lavorative ancora disponibili</span><strong>{(breakdown.totalMinutes / 60).toLocaleString('it-IT', { maximumFractionDigits: 1 })} h</strong></div>
      <div><span>Media necessaria per ora</span><strong>{breakdown.totalMinutes > 0 ? money.format(target.remainingMargin / (breakdown.totalMinutes / 60)) + '/h' : 'Non calcolabile'}</strong></div>
    </div>
    <div className="planner-detail-summary-grid economic-grid">
      {breakdown.weeks.map(week => <div key={week.start}>
        <span>{formatDate(week.start)} – {formatDate(week.end)}</span>
        <strong>{money.format(week.amount)}</strong>
        <small>Ore previste: {(week.minutes / 60).toLocaleString('it-IT', { maximumFractionDigits: 1 })} ore disponibili</small>
      </div>)}
    </div>
    <p><strong>Somma degli obiettivi settimanali: {money.format(breakdown.weeks.reduce((sum, week) => sum + week.amount, 0) + breakdown.unallocated)}</strong> · Residuo mensile: {money.format(target.remainingMargin)}</p>
    {breakdown.unallocated > 0 && <small>Attenzione: nessuna ora lavorativa disponibile. {money.format(breakdown.unallocated)} non sono assegnabili alle settimane: controlla turni e assenze.</small>}
    {target.partial && <small>Importi provvisori: alcune fasi hanno costi incompleti.</small>}
  </section>}
  {target && <MarginTargetRatePanel target={target} />}
  </>
}
