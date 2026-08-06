import { useMemo, useState } from 'react'
import { calculateEconomicSummary, calculateMonthlyGoalProjection } from '../../services/economic'
import type { ErpData, MonthlyGoalRecord, PlannerSettings } from '../../types'

const euro = (value: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
const monthKey = () => new Date().toISOString().slice(0, 7)
const monthSelectorOptions = (history: MonthlyGoalRecord[]) => {
  const months = new Set<string>([monthKey(), ...history.map((entry) => entry.monthKey)])
  return Array.from(months).sort().reverse()
}

export function MonthlyGoalsSettingsPage({ data, onSave }: { data: ErpData; onSave: (settings: PlannerSettings) => void }) {
  const [draft, setDraft] = useState(() => structuredClone(data.plannerSettings))
  const [selectedMonth, setSelectedMonth] = useState(monthKey())
  const [saved, setSaved] = useState(false)
  const history = draft.monthlyGoalHistory ?? []
  const options = monthSelectorOptions(history)
  const projection = useMemo(() => calculateMonthlyGoalProjection(data.vehicles, draft, `${selectedMonth}-01`), [data.vehicles, draft, selectedMonth])
  const summary = useMemo(() => calculateEconomicSummary(data.vehicles, draft, `${selectedMonth}-01`), [data.vehicles, draft, selectedMonth])

  const openMonth = (month: string) => {
    setSelectedMonth(month)
    const record = history.find((entry) => entry.monthKey === month)
    setDraft((current) => ({
      ...current,
      monthlyRevenueGoal: record?.revenueGoal ?? current.monthlyRevenueGoal,
      monthlyMarginGoal: record?.marginGoal ?? current.monthlyMarginGoal,
    }))
  }

  const save = () => {
    const nextHistory = [
      {
        id: history.find((entry) => entry.monthKey === selectedMonth)?.id ?? crypto.randomUUID(),
        monthKey: selectedMonth,
        revenueGoal: draft.monthlyRevenueGoal,
        revenueActual: projection.actualRevenue,
        marginGoal: draft.monthlyMarginGoal,
        marginActual: summary.plannedMargin,
        forecastRevenue: projection.projectedEndRevenue,
        updatedAt: new Date().toISOString(),
      },
      ...history.filter((entry) => entry.monthKey !== selectedMonth),
    ].slice(0, 12)

    onSave({ ...draft, monthlyRevenueGoal: draft.monthlyRevenueGoal, monthlyMarginGoal: draft.monthlyMarginGoal, monthlyGoalHistory: nextHistory })
    setDraft((current) => ({ ...current, monthlyGoalHistory: nextHistory }))
    setSaved(true)
  }

  return <section className="settings-stack">
    <div className="welcome"><div><span className="eyebrow">OBIETTIVI MENSILI</span><h2>Impostazioni → Obiettivi mensili</h2><p>Modifica l’obiettivo del mese, conserva lo storico e confronta il risultato previsto con il raggiungimento.</p></div><button className="primary" onClick={save}>Salva obiettivi</button></div>
    {saved && <div className="toast success">Obiettivi mensili salvati e storicizzati.</div>}

    <section className="panel form-grid planner-config">
      <label>Mese di riferimento<select value={selectedMonth} onChange={(event) => openMonth(event.target.value)}>{options.map((month) => <option value={month} key={month}>{month}</option>)}</select></label>
      <label>Obiettivo fatturato mensile (€)<input type="number" min="0" value={draft.monthlyRevenueGoal} onChange={(event) => setDraft({ ...draft, monthlyRevenueGoal: Number(event.target.value) })} /></label>
      <label>Obiettivo margine mensile (€)<input type="number" min="0" value={draft.monthlyMarginGoal ?? ''} onChange={(event) => setDraft({ ...draft, monthlyMarginGoal: event.target.value ? Number(event.target.value) : null })} /></label>
      <label>Fatturato attuale (€)<input readOnly value={projection.actualRevenue} /></label>
      <label>Previsione fine mese (€)<input readOnly value={projection.projectedEndRevenue} /></label>
    </section>

    <section className="panel economic-panel">
      <div className="panel-head"><div><span className="eyebrow">CONFRONTO OBIETTIVO / RISULTATO</span><h3>{projection.monthKey}</h3></div><b className={summary.sufficient ? 'goal-ok' : 'goal-gap'}>{summary.sufficient ? 'Carico sufficiente' : 'Carico insufficiente'}</b></div>
      <div className="economic-grid">
        <div><span>Obiettivo fatturato</span><strong>{euro(projection.goalRevenue)}</strong></div>
        <div><span>Fatturato attuale</span><strong>{euro(projection.actualRevenue)}</strong></div>
        <div><span>Scarto</span><strong>{euro(projection.deltaRevenue)}</strong></div>
        <div><span>Previsione fine mese</span><strong>{euro(projection.projectedEndRevenue)}</strong></div>
        <div><span>Giorni lavorativi residui</span><strong>{projection.remainingWorkingDays}</strong></div>
        <div><span>Media giornaliera necessaria</span><strong>{euro(projection.dailyRevenueNeeded)}</strong></div>
      </div>
    </section>

    <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">STORICO MENSILE</span><h3>Ultimi 12 mesi</h3></div></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Mese</th><th>Obiettivo</th><th>Raggiunto</th><th>Previsione</th><th>Aggiornato</th></tr></thead>
          <tbody>
            {history.map((entry) => <tr key={entry.id}><td>{entry.monthKey}</td><td>{euro(entry.revenueGoal)}</td><td>{euro(entry.revenueActual)}</td><td>{euro(entry.forecastRevenue)}</td><td>{new Date(entry.updatedAt).toLocaleDateString('it-IT')}</td></tr>)}
            {!history.length && <tr><td colSpan={5}><div className="empty-small">Nessuno storico disponibile.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </section>
}
