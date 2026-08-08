import { useState } from 'react'
import { MoneyInput } from '../../components/MoneyInput'
import type { PlannerAbsence, PlannerOperator, PlannerSettings } from '../../types'

const dayLabels = [{ value: 1, label: 'Lun' }, { value: 2, label: 'Mar' }, { value: 3, label: 'Mer' }, { value: 4, label: 'Gio' }, { value: 5, label: 'Ven' }, { value: 6, label: 'Sab' }, { value: 0, label: 'Dom' }]
const uid = () => crypto.randomUUID()

export function PlannerSettingsPage({ settings, onSave }: { settings: PlannerSettings; onSave: (settings: PlannerSettings) => void }) {
  const [draft, setDraft] = useState(() => structuredClone(settings))
  const [saved, setSaved] = useState(false)
  const [validationError, setValidationError] = useState('')
  const updateOperator = (id: string, patch: Partial<PlannerOperator>) =>
    setDraft((value) => ({ ...value, operators: value.operators.map((operator) => operator.id === id ? { ...operator, ...patch } : operator) }))
  const updateAbsence = (id: string, patch: Partial<PlannerAbsence>) =>
    setDraft((value) => ({ ...value, absences: value.absences.map((absence) => absence.id === id ? { ...absence, ...patch } : absence) }))
  const save = () => {
    const problem = !draft.workingDays.length
      ? 'Seleziona almeno un giorno lavorativo.'
      : draft.operators.some((operator) => !operator.name.trim() || operator.dailyHours <= 0 || operator.dailyHours > 24)
        ? 'Completa correttamente nomi e ore degli operatori.'
        : draft.efficiencyPercent <= 0 || draft.efficiencyPercent > 100 || draft.safetyMarginPercent < 0 || draft.safetyMarginPercent >= 100
          ? 'Efficienza e margine di sicurezza non sono validi.'
          : draft.absences.some((absence) => !absence.startDate || !absence.endDate || absence.endDate < absence.startDate)
            ? 'Completa correttamente gli intervalli di ferie e assenze.'
            : ''
    if (problem) {
      setValidationError(problem)
      setSaved(false)
      return
    }
    onSave(draft)
    setValidationError('')
    setSaved(true)
  }
  return <section className="settings-stack">
    <div className="welcome"><div><span className="eyebrow">CAPACITÀ PRODUTTIVA</span><h2>Impostazioni Planner</h2><p>Ogni modifica ricalcola capacità, consegne e obiettivo economico.</p></div><button className="primary" onClick={save}>Salva impostazioni</button></div>
    {saved && <div className="toast success">Impostazioni salvate in archivio.</div>}
    {validationError && <div className="toast warning">{validationError}</div>}
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">SQUADRA</span><h3>Operatori produttivi</h3></div><button className="secondary" onClick={() => setDraft((value) => ({ ...value, operators: [...value.operators, { id: uid(), name: '', dailyHours: 8, active: true }] }))}>+ Aggiungi operatore</button></div>
      <div className="settings-list">{draft.operators.map((operator) => <div className="settings-row" key={operator.id}><input aria-label="Nome operatore" placeholder="Nome operatore" value={operator.name} onChange={(event) => updateOperator(operator.id, { name: event.target.value })} /><input aria-label="Ore giornaliere" type="number" min="0.5" max="24" step="0.5" value={operator.dailyHours} onChange={(event) => updateOperator(operator.id, { dailyHours: Number(event.target.value) })} /><label className="check"><input type="checkbox" checked={operator.active} onChange={(event) => updateOperator(operator.id, { active: event.target.checked })} /> Attivo</label><button className="danger" onClick={() => setDraft((value) => ({ ...value, operators: value.operators.filter((item) => item.id !== operator.id), absences: value.absences.filter((item) => item.operatorId !== operator.id) }))}>Rimuovi</button></div>)}</div>
      {!draft.operators.length && <p className="settings-note">Aggiungi almeno un operatore per ottenere capacità produttiva.</p>}
    </section>
    <section className="panel form-grid planner-config">
      <fieldset><legend>Giorni lavorativi</legend><div className="day-picker">{dayLabels.map((day) => <label className={draft.workingDays.includes(day.value) ? 'selected' : ''} key={day.value}><input type="checkbox" checked={draft.workingDays.includes(day.value)} onChange={() => setDraft((value) => ({ ...value, workingDays: value.workingDays.includes(day.value) ? value.workingDays.filter((item) => item !== day.value) : [...value.workingDays, day.value] }))} />{day.label}</label>)}</div></fieldset>
      <label>Efficienza programmata (%)<input type="number" min="1" max="100" value={draft.efficiencyPercent} onChange={(event) => setDraft({ ...draft, efficiencyPercent: Number(event.target.value) })} /></label>
      <label>Margine di sicurezza (%)<input type="number" min="0" max="99" value={draft.safetyMarginPercent} onChange={(event) => setDraft({ ...draft, safetyMarginPercent: Number(event.target.value) })} /></label>
      <label>Obiettivo fatturato mensile (€)<MoneyInput minValue={0} value={draft.monthlyRevenueGoal} onValueChange={(value) => setDraft({ ...draft, monthlyRevenueGoal: value ?? 0 })} /></label>
      <label>Obiettivo margine mensile (€)<MoneyInput allowEmpty minValue={0} value={draft.monthlyMarginGoal ?? null} onValueChange={(value) => setDraft({ ...draft, monthlyMarginGoal: value })} /></label>
      <label>Festività (una data per riga)<textarea value={draft.holidays.join('\n')} onChange={(event) => setDraft({ ...draft, holidays: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} placeholder="2026-08-15" /></label>
      <label>Chiusure aziendali (una data per riga)<textarea value={draft.closures.join('\n')} onChange={(event) => setDraft({ ...draft, closures: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} placeholder="2026-08-17" /></label>
    </section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">FERIE E ASSENZE</span><h3>Disponibilità operatori</h3></div><button className="secondary" disabled={!draft.operators.length} onClick={() => setDraft((value) => ({ ...value, absences: [...value.absences, { id: uid(), operatorId: value.operators[0].id, startDate: '', endDate: '', hoursPerDay: null, reason: '' }] }))}>+ Aggiungi assenza</button></div>
      <div className="settings-list">{draft.absences.map((absence) => <div className="settings-row absence-row" key={absence.id}><select value={absence.operatorId} onChange={(event) => updateAbsence(absence.id, { operatorId: event.target.value })}>{draft.operators.map((operator) => <option value={operator.id} key={operator.id}>{operator.name || 'Operatore senza nome'}</option>)}</select><input aria-label="Inizio assenza" type="date" value={absence.startDate} onChange={(event) => updateAbsence(absence.id, { startDate: event.target.value })} /><input aria-label="Fine assenza" type="date" value={absence.endDate} onChange={(event) => updateAbsence(absence.id, { endDate: event.target.value })} /><input aria-label="Ore assenza" type="number" min="0" step="0.5" placeholder="Tutto il giorno" value={absence.hoursPerDay ?? ''} onChange={(event) => updateAbsence(absence.id, { hoursPerDay: event.target.value ? Number(event.target.value) : null })} /><input aria-label="Motivo assenza" placeholder="Motivo" value={absence.reason} onChange={(event) => updateAbsence(absence.id, { reason: event.target.value })} /><button className="danger" onClick={() => setDraft((value) => ({ ...value, absences: value.absences.filter((item) => item.id !== absence.id) }))}>Rimuovi</button></div>)}</div>
    </section>
  </section>
}
