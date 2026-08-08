import { useMemo, useState } from 'react'
import { MoneyInput } from '../../components/MoneyInput'
import { calculateEconomicGoalSnapshot } from '../../services/economic'
import type { ErpData, MonthlyGoalRecord, PlannerSettings } from '../../types'

const euro = (value: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
const monthKey = () => new Date().toISOString().slice(0, 7)
type GoalMode = 'automatic' | 'custom'
const monthSelectorOptions = (history: MonthlyGoalRecord[]) => {
  const months = new Set<string>([monthKey(), ...history.map((entry) => entry.monthKey)])
  return Array.from(months).sort().reverse()
}

const goalModeLabel = (mode: GoalMode) => mode === 'custom' ? 'Personalizzato' : 'Automatico'

const normalizeDraft = (draft: PlannerSettings): PlannerSettings => ({
  ...draft,
  monthlyRevenueGoalMode: draft.monthlyRevenueGoalMode ?? 'automatic',
  monthlyRevenueGoalSuggested: Number(draft.monthlyRevenueGoalSuggested ?? draft.monthlyRevenueGoal ?? 0),
  monthlyRevenueGoalManual: draft.monthlyRevenueGoalManual ?? null,
  ownerWithdrawalAmount: Number(draft.ownerWithdrawalAmount ?? 3000),
  ownerWithdrawalPlannedDate: draft.ownerWithdrawalPlannedDate ?? new Date().toISOString().slice(0, 10),
  economicSafetyMarginPercent: Number(draft.economicSafetyMarginPercent ?? 10),
})

export function MonthlyGoalsSettingsPage({ data, onSave }: { data: ErpData; onSave: (settings: PlannerSettings) => void }) {
  const [draft, setDraft] = useState(() => normalizeDraft(structuredClone(data.plannerSettings)))
  const [selectedMonth, setSelectedMonth] = useState(monthKey())
  const [saved, setSaved] = useState(false)
  const history = draft.monthlyGoalHistory ?? []
  const options = monthSelectorOptions(history)
  const snapshot = useMemo(() => calculateEconomicGoalSnapshot({ ...data, plannerSettings: draft }, `${selectedMonth}-01`), [data, draft, selectedMonth])

  const openMonth = (month: string) => {
    setSelectedMonth(month)
    const record = history.find((entry) => entry.monthKey === month)
    setDraft((current) => ({
      ...normalizeDraft(current),
      monthlyRevenueGoalMode: record?.goalMode ?? current.monthlyRevenueGoalMode ?? 'automatic',
      monthlyRevenueGoalSuggested: record?.suggestedRevenueGoal ?? current.monthlyRevenueGoalSuggested ?? current.monthlyRevenueGoal,
      monthlyRevenueGoalManual: record?.customRevenueGoal ?? current.monthlyRevenueGoalManual ?? null,
      monthlyRevenueGoal: record?.appliedRevenueGoal ?? current.monthlyRevenueGoal,
      ownerWithdrawalAmount: record?.ownerWithdrawalAmount ?? current.ownerWithdrawalAmount ?? 3000,
      ownerWithdrawalPlannedDate: record?.ownerWithdrawalPlannedDate ?? current.ownerWithdrawalPlannedDate,
      monthlyMarginGoal: record?.marginGoal ?? current.monthlyMarginGoal,
    }))
  }

  const updateMode = (mode: GoalMode) => {
    setDraft((current) => {
      const normalized = normalizeDraft(current)
      const manualGoal = normalized.monthlyRevenueGoalManual ?? normalized.monthlyRevenueGoal ?? snapshot.suggestedRevenueGoal
      return {
        ...normalized,
        monthlyRevenueGoalMode: mode,
        monthlyRevenueGoalSuggested: snapshot.suggestedRevenueGoal,
        monthlyRevenueGoalManual: mode === 'custom' ? manualGoal : normalized.monthlyRevenueGoalManual ?? manualGoal,
        monthlyRevenueGoal: mode === 'custom' ? manualGoal : snapshot.suggestedRevenueGoal,
      }
    })
  }

  const updateManualGoal = (value: number) => {
    setDraft((current) => ({
      ...normalizeDraft(current),
      monthlyRevenueGoalMode: 'custom',
      monthlyRevenueGoalManual: value,
      monthlyRevenueGoal: value,
    }))
  }

  const save = () => {
    const appliedRevenueGoal = snapshot.mode === 'custom' ? (snapshot.customRevenueGoal ?? snapshot.appliedRevenueGoal) : snapshot.appliedRevenueGoal
    const nextHistory = [
      {
        id: history.find((entry) => entry.monthKey === selectedMonth)?.id ?? crypto.randomUUID(),
        monthKey: selectedMonth,
        revenueGoal: appliedRevenueGoal,
        suggestedRevenueGoal: snapshot.suggestedRevenueGoal,
        appliedRevenueGoal,
        goalMode: snapshot.mode,
        customRevenueGoal: snapshot.customRevenueGoal,
        revenueActual: snapshot.revenueRealized,
        baseNeed: snapshot.baseNeed,
        safetyBuffer: snapshot.safetyBuffer,
        ownerWithdrawalAmount: snapshot.ownerWithdrawalAmount,
        ownerWithdrawalPlannedDate: snapshot.ownerWithdrawalPlannedDate,
        marginGoal: snapshot.ownerWithdrawalAmount,
        marginActual: round(snapshot.revenueRealized - snapshot.totalCosts),
        residualNeed: snapshot.residualNeed,
        realCosts: snapshot.realCosts,
        plannedCosts: snapshot.plannedCosts,
        revenueRealized: snapshot.revenueRealized,
        dailyRevenueNeed: snapshot.dailyRevenueNeed,
        weeklyRevenueNeed: snapshot.weeklyRevenueNeed,
        forecastRevenue: appliedRevenueGoal,
        updatedAt: new Date().toISOString(),
      },
      ...history.filter((entry) => entry.monthKey !== selectedMonth),
    ].slice(0, 12)

    const nextDraft = {
      ...normalizeDraft(draft),
      monthlyRevenueGoal: appliedRevenueGoal,
      monthlyRevenueGoalMode: snapshot.mode,
      monthlyRevenueGoalSuggested: snapshot.suggestedRevenueGoal,
      monthlyRevenueGoalManual: snapshot.customRevenueGoal,
      ownerWithdrawalAmount: draft.ownerWithdrawalAmount,
      ownerWithdrawalPlannedDate: draft.ownerWithdrawalPlannedDate,
      monthlyMarginGoal: snapshot.ownerWithdrawalAmount,
      monthlyGoalHistory: nextHistory,
    }

    onSave(nextDraft)
    setDraft((current) => ({ ...current, ...nextDraft, monthlyGoalHistory: nextHistory }))
    setSaved(true)
  }

  return <section className="settings-stack">
    <div className="welcome"><div><span className="eyebrow">OBIETTIVI DINAMICI</span><h2>Impostazioni → Obiettivi mensili</h2><p>Il sistema ricalcola fabbisogno, suggerimento e residuo partendo da spese previste, prelievo titolare e fatturato già emesso.</p></div><button className="primary" onClick={save}>Salva obiettivi</button></div>
    {saved && <div className="toast success">Obiettivi mensili salvati e storicizzati.</div>}

    <section className="panel form-grid planner-config">
      <label>Mese di riferimento<select value={selectedMonth} onChange={(event) => openMonth(event.target.value)}>{options.map((month) => <option value={month} key={month}>{month}</option>)}</select></label>
      <label>Modalità obiettivo<div className="segmented"><button className={draft.monthlyRevenueGoalMode !== 'custom' ? 'active' : ''} onClick={() => updateMode('automatic')} type="button">Automatico</button><button className={draft.monthlyRevenueGoalMode === 'custom' ? 'active' : ''} onClick={() => updateMode('custom')} type="button">Personalizzato</button></div></label>
      <div className="hint-block"><small><strong>Automatico:</strong> l'obiettivo viene ricalcolato automaticamente in base a spese previste, prelievo titolare e cuscinetto di liquidità.</small><small><strong>Personalizzato:</strong> il titolare stabilisce manualmente l'obiettivo del mese.</small></div>
      <label>Prelievo titolare (€)<MoneyInput minValue={0} value={draft.ownerWithdrawalAmount ?? 3000} onValueChange={(value) => setDraft({ ...normalizeDraft(draft), ownerWithdrawalAmount: value ?? 0 })} /></label>
      <label>Data prevista prelievo<input type="date" value={draft.ownerWithdrawalPlannedDate ?? new Date().toISOString().slice(0, 10)} onChange={(event) => setDraft({ ...normalizeDraft(draft), ownerWithdrawalPlannedDate: event.target.value })} /></label>
      <label>Cuscinetto sicurezza (%)<input type="number" min="0" max="100" value={draft.economicSafetyMarginPercent ?? 10} onChange={(event) => setDraft({ ...normalizeDraft(draft), economicSafetyMarginPercent: Number(event.target.value) })} /></label>
      <label>Obiettivo consigliato dal sistema (€)<input readOnly value={snapshot.suggestedRevenueGoal} /></label>
      <label>Obiettivo effettivo del mese (€)<input readOnly value={snapshot.appliedRevenueGoal} /></label>
      <label>Imposta obiettivo manuale (€)<MoneyInput allowEmpty minValue={0} value={draft.monthlyRevenueGoalManual ?? null} onValueChange={(value) => updateManualGoal(value ?? 0)} disabled={draft.monthlyRevenueGoalMode !== 'custom'} /></label>
      <small>{draft.monthlyRevenueGoalMode === 'custom' ? 'Modalità personalizzata attiva: il valore manuale determina l\'obiettivo effettivo del mese.' : 'Modalità automatica attiva: il valore manuale è conservato ma non viene usato nei calcoli.'}</small>
      <label>Fatturato realizzato (€)<input readOnly value={snapshot.revenueRealized} /></label>
      <label>Fabbisogno residuo (€)<input readOnly value={snapshot.residualNeed} /></label>
    </section>

    <section className="panel economic-panel">
      <div className="panel-head"><div><span className="eyebrow">CONFRONTO OBIETTIVO / RISULTATO</span><h3>{snapshot.monthKey}</h3></div><b className={snapshot.status === 'ok' ? 'goal-ok' : snapshot.status === 'warning' ? 'goal-gap' : 'goal-critical'}>{snapshot.status === 'ok' ? 'In linea' : snapshot.status === 'warning' ? 'Attenzione' : 'In ritardo'}</b></div>
      <div className="goal-meter"><span>Avanzamento cumulativo</span><strong>{snapshot.progressPercent}%</strong><i><b style={{ width: `${snapshot.progressPercent}%` }} /></i></div>
      <div className="economic-grid">
        <div><span>Spese previste</span><strong>{euro(snapshot.plannedCosts)}</strong></div>
        <div><span>Prelievo titolare</span><strong>{euro(snapshot.ownerWithdrawalAmount)}</strong></div>
        <div><span>Cuscinetto {snapshot.safetyMarginPercent}%</span><strong>{euro(snapshot.safetyBuffer)}</strong></div>
        <div><span>Obiettivo totale</span><strong>{euro(snapshot.appliedRevenueGoal)}</strong></div>
        <div><span>Realizzato</span><strong>{euro(snapshot.revenueRealized)}</strong></div>
        <div><span>Residuo</span><strong>{euro(snapshot.residualNeed)}</strong></div>
        <div><span>Obiettivo giornaliero residuo</span><strong>{euro(snapshot.dailyRevenueNeed)}</strong></div>
        <div><span>Obiettivo settimanale residuo</span><strong>{euro(snapshot.weeklyRevenueNeed)}</strong></div>
        <div><span>Base fabbisogno</span><strong>{euro(snapshot.baseNeed)}</strong></div>
      </div>
    </section>

    <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">ANDAMENTO CUMULATIVO</span><h3>Obiettivo contro fatturato</h3></div></div>
      <div className="goal-chart">
        {snapshot.chart.slice(-12).map((point) => {
          const actualHeight = snapshot.appliedRevenueGoal ? Math.max(6, Math.min(100, (point.actualRevenue / snapshot.appliedRevenueGoal) * 100)) : 0
          const targetHeight = snapshot.appliedRevenueGoal ? Math.max(6, Math.min(100, (point.targetRevenue / snapshot.appliedRevenueGoal) * 100)) : 0
          return <div className="goal-chart-bar" key={point.date}><div className="goal-chart-track"><i className="actual" style={{ height: `${actualHeight}%` }} /><i className="target" style={{ height: `${targetHeight}%` }} /></div><small>{point.label}</small></div>
        })}
      </div>
    </section>

    <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">STORICO MENSILE</span><h3>Ultimi 12 mesi</h3></div></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Mese</th><th>Modalità</th><th>Base</th><th>Prelievo</th><th>Totale</th><th>Realizzato</th><th>Residuo</th><th>Aggiornato</th></tr></thead>
          <tbody>
            {history.map((entry) => <tr key={entry.id}><td>{entry.monthKey}</td><td>{goalModeLabel(entry.goalMode ?? 'automatic')}</td><td>{euro(entry.baseNeed ?? entry.plannedCosts ?? 0)}</td><td>{euro(entry.ownerWithdrawalAmount ?? 0)}</td><td>{euro(entry.appliedRevenueGoal ?? entry.revenueGoal)}</td><td>{euro(entry.revenueActual)}</td><td>{euro(entry.residualNeed ?? Math.max(0, (entry.appliedRevenueGoal ?? entry.revenueGoal) - entry.revenueActual))}</td><td>{new Date(entry.updatedAt).toLocaleDateString('it-IT')}</td></tr>)}
            {!history.length && <tr><td colSpan={8}><div className="empty-small">Nessuno storico disponibile.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </section>
}

const round = (value: number) => Math.round(value * 100) / 100
