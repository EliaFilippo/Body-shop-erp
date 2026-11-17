import { useState } from 'react'
import type { PlannerAbsence } from '../../types'
import { parseTimeToMinutes } from '../../services/workCalendar'
import './operatorAbsences.css'

export function OperatorAbsences({ operatorId, operatorName, date, absences, onSave }: {
  operatorId: string
  operatorName: string
  date: string
  absences: PlannerAbsence[]
  onSave: (absences: PlannerAbsence[]) => Promise<void>
}) {
  const [draft, setDraft] = useState<PlannerAbsence | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const rows = absences.filter(item => item.operatorId === operatorId)
  const affectsDay = rows.some(item => item.startDate <= date && item.endDate >= date)

  function edit(value: PlannerAbsence) {
    setError('')
    setDraft(value)
  }

  async function save(next: PlannerAbsence[]) {
    setSaving(true)
    setError('')
    try {
      await onSave(next)
      setDraft(null)
    } catch {
      setError('Salvataggio dell’assenza non riuscito. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  return <details className="operator-absences" aria-label={`Assenze di ${operatorName}`}>
    <summary>{affectsDay ? 'Assenza registrata · Gestisci' : 'Gestisci assenze'}</summary>
    {rows.map(item => <p key={item.id}>
      {item.startDate}{item.endDate !== item.startDate && ` – ${item.endDate}`} · {item.startTime && item.endTime
        ? `${item.startTime}–${item.endTime}` : item.hoursPerDay == null ? 'Tutto il giorno' : `${item.hoursPerDay} ore al giorno`}
      {item.reason && ` · ${item.reason}`}{' '}
      <button type="button" disabled={saving} onClick={() => edit(item)}>Modifica</button>{' '}
      <button type="button" disabled={saving} onClick={() => void save(absences.filter(row => row.id !== item.id))}>Rimuovi</button>
    </p>)}
    <button type="button" disabled={saving} onClick={() => edit({
      id: crypto.randomUUID(), operatorId, startDate: date, endDate: date, hoursPerDay: null, reason: '',
    })}>Aggiungi assenza</button>
    {draft && <form onSubmit={event => {
      event.preventDefault()
      const timed = Boolean(draft.startTime || draft.endTime)
      const start = parseTimeToMinutes(draft.startTime)
      const end = parseTimeToMinutes(draft.endTime)
      if (draft.endDate < draft.startDate || (timed && (start == null || end == null || start >= end))) {
        setError('Verifica le date e gli orari dell’assenza.')
        return
      }
      const updated = { ...draft, hoursPerDay: timed ? null : draft.hoursPerDay }
      void save(absences.some(item => item.id === draft.id)
        ? absences.map(item => item.id === draft.id ? updated : item) : [...absences, updated])
    }}>
      <fieldset disabled={saving}>
        <label>Dal <input required type="date" value={draft.startDate} onChange={event => {
          const startDate = event.target.value
          setDraft({ ...draft, startDate, endDate: draft.endDate < startDate ? startDate : draft.endDate })
        }} /></label>
        <label>Al <input required type="date" min={draft.startDate} value={draft.endDate} onChange={event => setDraft({ ...draft, endDate: event.target.value })} /></label>
        <label>Dalle <input type="time" value={draft.startTime ?? ''} onChange={event => setDraft({ ...draft, startTime: event.target.value })} /></label>
        <label>Alle <input type="time" value={draft.endTime ?? ''} onChange={event => setDraft({ ...draft, endTime: event.target.value })} /></label>
        <label>Ore di assenza <input type="number" min="0" max="24" step="0.5" disabled={Boolean(draft.startTime || draft.endTime)} value={draft.hoursPerDay ?? ''} onChange={event => setDraft({ ...draft, hoursPerDay: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <p>Lascia vuoti ore e orari per indicare tutto il giorno.</p>
        <label>Motivo <input value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} /></label>
        <button type="submit">Salva assenza</button>{' '}
        <button type="button" onClick={() => { setDraft(null); setError('') }}>Annulla</button>
      </fieldset>
    </form>}
    {error && <p role="alert">{error}</p>}
  </details>
}
