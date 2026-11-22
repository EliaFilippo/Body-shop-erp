import { useEffect, useState } from 'react'
import { productionRpc } from '../../services/liveProduction'
import type { NoticesConnection } from './PhaseNotices'
import './operationalEfficiency.css'

type Period = { from: string; to: string }
type EfficiencyTeam = {
  jobId: string
  group: string
  plate: string
  phase: string
  plannedSeconds: number
  workedSeconds: number
  operators: { name: string; seconds: number }[]
}
type EfficiencyRow = {
  operatorId: string
  name: string
  plannedSeconds: number | null
  workedSeconds: number | null
  savedSeconds?: number | null
  overrunSeconds?: number | null
  details?: { jobId: string; group: string; plate: string; phase: string; plannedSeconds: number; workedSeconds: number }[]
}

const levels = [
  ['green', 'Efficienza ottima'],
  ['yellow', 'Efficienza scarsa'],
  ['red', 'Nessuna efficienza'],
] as const

export function efficiencyLevel(planned: number | null, worked: number | null) {
  if (planned === null || worked === null || planned <= 0 || worked <= 0) return null
  const overrun = worked - planned
  if (overrun <= 0) return levels[0]
  return worked >= planned + planned / 10 || overrun >= 1800 ? levels[2] : levels[1]
}

function currentPeriod(): Period {
  const to = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', dateStyle: 'short' }).format(new Date())
  return { from: `${to.slice(0, 7)}-01`, to }
}

function useEfficiency(connection: NoticesConnection, mode: 'tablet' | 'dashboard' | 'report', period?: Period) {
  const { companyId, session, config } = connection
  const key = JSON.stringify([companyId, session.userId, config.url, mode, period?.from, period?.to])
  const [result, setResult] = useState<{ key: string; rows?: EfficiencyRow[]; teams?: EfficiencyTeam[]; period: Period; failed?: boolean }>()
  const from = period?.from
  const to = period?.to
  useEffect(() => {
    let active = true
    let request: AbortController | undefined
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      if (!active || document.hidden || request) return
      const dates = from && to ? { from, to } : currentPeriod()
      request = new AbortController()
      try {
        const rows = await productionRpc<EfficiencyRow[] | { rows: EfficiencyRow[]; teams: EfficiencyTeam[] }>('production_efficiency', {
          p_company_id: companyId, p_from: dates.from, p_to: dates.to,
          p_staff: mode !== 'tablet', p_details: mode === 'report',
        }, session, config, undefined, request.signal)
        if (!active) return
        if (Array.isArray(rows)) setResult({ key, rows, period: dates })
        else if (Array.isArray(rows?.rows)) setResult({ key, ...rows, period: dates })
        else setResult({ key, period: dates, failed: true })
      } catch {
        if (active) setResult({ key, period: dates, failed: true })
      } finally {
        request = undefined
        if (active && !document.hidden) timer = setTimeout(refresh, 60_000)
      }
    }
    function visible() {
      clearTimeout(timer)
      void refresh()
    }
    document.addEventListener('visibilitychange', visible)
    void refresh()
    return () => {
      active = false
      request?.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [companyId, config, session, mode, from, to, key])
  return result?.key === key ? result : undefined
}

const dateLabel = (date: string) => date.split('-').reverse().join('/')
const duration = (seconds: number) => {
  const minutes = Math.floor(Math.abs(seconds) / 60)
  return minutes < 1 && seconds !== 0 ? '<1 min' : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
const balance = (seconds: number) => `${seconds < 0 ? '−' : seconds > 0 ? '+' : ''}${duration(seconds)}`
const percentage = new Intl.NumberFormat('it-IT', { style: 'percent', maximumFractionDigits: 2 })

function PeriodLabel({ period }: { period: Period }) {
  return <p>{dateLabel(period.from)} – {dateLabel(period.to)}</p>
}

export function TabletEfficiency({ connection, operatorName }: { connection: NoticesConnection; operatorName: string }) {
  const data = useEfficiency(connection, 'tablet')
  const row = data?.rows?.length === 1 && data.rows[0].name === operatorName ? data.rows[0] : undefined
  const level = efficiencyLevel(row?.plannedSeconds ?? null, row?.workedSeconds ?? null)
  return <section className="live-day-hours operational-efficiency">
    <h2>Efficienza · {operatorName}</h2>
    <PeriodLabel period={data?.period ?? currentPeriod()} />
    {level && row?.plannedSeconds != null && row.workedSeconds != null &&
      <p>{percentage.format(row.plannedSeconds / row.workedSeconds)} · Saldo {balance(row.plannedSeconds - row.workedSeconds)}</p>}
    <ul data-rated={!!level}>{levels.map(([color, label]) => <li key={color} aria-current={level?.[0] === color ? 'true' : undefined}>
      <span className="efficiency-light" data-color={color} data-active={level?.[0] === color} /> {label}
    </li>)}</ul>
  </section>
}

export function StaffEfficiency({ connection, period }: { connection: NoticesConnection; period?: Period }) {
  const data = useEfficiency(connection, period ? 'report' : 'dashboard', period)
  return <section className="panel operational-efficiency">
    <h3>Efficienza operativa</h3>
    <PeriodLabel period={data?.period ?? period ?? currentPeriod()} />
    {data?.failed && <p role="status">Efficienza non disponibile.</p>}
    {!data && <p role="status">Caricamento efficienza…</p>}
    {data?.rows?.length === 0 && <p>Nessun operatore disponibile.</p>}
    {!!data?.rows?.length && <div className="production-score-table"><table>
      <thead><tr><th>Operatore</th><th>Semaforo</th><th>Efficienza</th><th>Previste</th><th>Effettive</th><th>Saldo</th>{period && <th>Dettaglio</th>}</tr></thead>
      <tbody>{data.rows.map(row => {
        const { plannedSeconds: planned, workedSeconds: worked } = row
        const level = efficiencyLevel(planned, worked)
        return <tr key={row.operatorId}>
          <th scope="row">{row.name}</th>
          <td><span className="efficiency-light" data-color={level?.[0]} data-active={!!level} /> {level?.[1] ?? 'Non valutabile'}</td>
          <td>{planned !== null && worked !== null && level ? percentage.format(planned / worked) : '—'}</td>
          <td>{planned === null ? '—' : duration(planned)}</td>
          <td>{worked === null ? '—' : duration(worked)}</td>
          <td>{planned === null || worked === null ? '—' : balance(planned - worked)}</td>
          {period && <td>{!!row.details?.length && <details>
            <summary>Fasi per vettura</summary>
            <p>Risparmiate {duration(row.savedSeconds ?? 0)} · Sforate {duration(row.overrunSeconds ?? 0)}</p>
            {row.details.map(item => <p key={JSON.stringify([item.jobId, item.group])}>{item.plate} · {item.phase} · {duration(item.plannedSeconds)} previste / {duration(item.workedSeconds)} effettive</p>)}
          </details>}</td>}
        </tr>
      })}</tbody>
    </table></div>}
    {!!data?.teams?.length && <details><summary>Fasi condivise · risultati di squadra</summary>
      {data.teams.map(team => <div key={JSON.stringify([team.jobId, team.group])}>
        <p>{team.plate} · {team.phase} · {percentage.format(team.plannedSeconds / team.workedSeconds)} · {duration(team.plannedSeconds)} previste / {duration(team.workedSeconds)} effettive</p>
        <p>{team.operators.map(person => `${person.name} ${duration(person.seconds)}`).join(' · ')}</p>
      </div>)}
    </details>}
  </section>
}
