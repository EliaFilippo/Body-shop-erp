import { useEffect, useRef, useState } from 'react'
import type { CloudAuthConfig, CloudAuthSession } from '../../services/cloudAuth'
import { interpolateHours, productionRpc, type HoursReport, type LiveFeed } from '../../services/liveProduction'

const hoursText = (seconds: number | null) => seconds === null ? 'Da configurare' : `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}m`
const romeMonth = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' }).format(new Date())

export function HoursTotals({ report, elapsed, stale }: { report: HoursReport; elapsed: number; stale: boolean }) {
  const hours = interpolateHours(report, stale ? 0 : elapsed)
  return <div className="live-hours-totals"><div><span>Lavoro registrato</span><strong>{hoursText(hours.workedSeconds)}</strong></div>
    <div><span>Ore ordinarie</span><strong>{hoursText(hours.ordinarySeconds)}</strong></div><div><span>Ore extra</span><strong>{hoursText(hours.extraSeconds)}</strong></div>
    {hours.unconfigured && <p>Completa gli orari dell’operatore per distinguere le ore ordinarie dagli extra.</p>}
    {stale && <p>Ultimi dati ricevuti · aggiornamento sospeso</p>}
  </div>
}

export function EmployeeHours({ feed, session, config, elapsed, stale }: {
  feed: LiveFeed; session: CloudAuthSession; config: CloudAuthConfig; elapsed: number; stale: boolean;
}) {
  const [selected, setSelected] = useState('')
  const [month, setMonth] = useState(romeMonth)
  const [report, setReport] = useState<HoursReport | null>(null)
  const [error, setError] = useState('')
  const reportSample = useRef(-Infinity)
  useEffect(() => {
    if (!selected || !/^\d{4}-\d{2}$/.test(month)) return
    let cancelled = false
    const [year, number] = month.split('-').map(Number)
    const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate()
    void productionRpc<HoursReport>('production_hours_report', { p_company_id: feed.companyId, p_operator_id: selected,
      p_from: `${month}-01`, p_to: `${month}-${lastDay}` }, session, config)
      .then(result => { if (!cancelled) { setReport(result); reportSample.current = performance.now(); setError('') } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Riepilogo non disponibile.') })
    return () => { cancelled = true }
  }, [selected, month, feed.companyId, feed.serverNow, session, config])
  const reportStale = stale || performance.now() - reportSample.current > 8000 || !!error
  const display = report && report.operatorId === selected && report.from.startsWith(month)
    ? interpolateHours(report, reportStale ? 0 : (performance.now() - reportSample.current) / 1000) : null
  return <section className="live-staff"><h2>Profili dipendenti · monte ore</h2>
    <p>Ore produttive registrate sulle vetture. Le pause sono escluse; gli extra sono calcolati oltre l’orario configurato di ciascuna giornata. Non è un registro delle presenze.</p>
    <div className="live-job-grid">{feed.staff?.map(employee => <button key={employee.operatorId} className="live-employee" aria-pressed={selected === employee.operatorId}
      onClick={() => { setSelected(employee.operatorId); setReport(null) }}><strong>{employee.name}</strong>
      <span>Oggi: {hoursText(interpolateHours(employee.today, stale ? 0 : elapsed).workedSeconds)}</span></button>)}</div>
    {selected && <><label>Mese del monte ore<input type="month" value={month} onChange={e => { setMonth(e.target.value); setReport(null) }} /></label>
      {error && <p role="alert">{error}</p>}{display && <><h3>{display.name} · {month}</h3>
        <HoursTotals report={display} elapsed={0} stale={reportStale} />
        <div className="live-table-scroll"><table><caption>Ore giornaliere di {display.name}</caption><thead><tr><th>Giorno</th><th>Lavorate</th><th>Ordinarie</th><th>Extra</th></tr></thead>
          <tbody>{display.days.map(day => <tr key={day.date}><th>{day.date}</th><td>{hoursText(day.workedSeconds)}{day.running ? ' · in corso' : ''}</td>
            <td>{hoursText(day.ordinarySeconds)}</td><td>{hoursText(day.extraSeconds)}</td></tr>)}</tbody></table></div></>}</>}
  </section>
}
