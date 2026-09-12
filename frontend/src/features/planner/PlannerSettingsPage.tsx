import { useEffect, useMemo, useState } from 'react'
import { MoneyInput } from '../../components/MoneyInput'
import { Modal } from '../../components/Modal'
import type { PlannerAbsence, PlannerOperator, PlannerSettings, StandardWorkDefinition, StandardWorkRule, StandardWorkTimePreset } from '../../types'

const dayLabels = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mer' },
  { value: 4, label: 'Gio' },
  { value: 5, label: 'Ven' },
  { value: 6, label: 'Sab' },
  { value: 0, label: 'Dom' },
]

const uid = () => crypto.randomUUID()

function parseAttributes(value: string) {
  return Object.fromEntries(
    value
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.split('=').map((part) => part.trim()))
      .filter((parts) => parts.length === 2 && parts[0] && parts[1])
      .map(([key, val]) => [key, val]),
  )
}

function stringifyAttributes(attributes: Record<string, string> | undefined) {
  return Object.entries(attributes ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')
}

function formatMinutesLabel(minutes: number) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(total / 60)
  const remainder = total % 60
  if (hours <= 0) return `${total} min`
  if (remainder === 0) return `${total} min (${hours} h)`
  return `${total} min (${hours} h ${remainder} min)`
}

export function PlannerSettingsPage({
  settings,
  onSave,
}: {
  settings: PlannerSettings
  onSave: (settings: PlannerSettings) => Promise<void>
}) {
  const [draft, setDraft] = useState(() => structuredClone(settings))
  const [saved, setSaved] = useState(false)
  const [ruleSaved, setRuleSaved] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, StandardWorkRule>>({})
  const [saving, setSaving] = useState(false)
  const [editingWorkId, setEditingWorkId] = useState<string | null>(null)
  const [rulesWorkId, setRulesWorkId] = useState<string | null>(null)
  const [editingTimePresetId, setEditingTimePresetId] = useState<string | null>(null)

  useEffect(() => {
    setDraft(structuredClone(settings))
    setSaved(false)
    setRuleSaved(false)
    setDirty(false)
    setRuleDrafts({})
    setValidationError('')
  }, [settings])

  const hasPendingRuleDrafts = useMemo(() => Object.keys(ruleDrafts).length > 0, [ruleDrafts])
  const editingWork = useMemo(
    () => (draft.standardWorks ?? []).find((work) => work.id === editingWorkId) ?? null,
    [draft.standardWorks, editingWorkId],
  )
  const rulesWork = useMemo(
    () => (draft.standardWorks ?? []).find((work) => work.id === rulesWorkId) ?? null,
    [draft.standardWorks, rulesWorkId],
  )
  const editingTimePreset = useMemo(
    () => (draft.standardWorkTimePresets ?? []).find((preset) => preset.id === editingTimePresetId) ?? null,
    [draft.standardWorkTimePresets, editingTimePresetId],
  )
  const standardWorkById = useMemo(
    () => new Map((draft.standardWorks ?? []).map((work) => [work.id, work])),
    [draft.standardWorks],
  )

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && !hasPendingRuleDrafts) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, hasPendingRuleDrafts])

  const markDirty = () => {
    setDirty(true)
    setSaved(false)
    setRuleSaved(false)
  }

  const updateOperator = (id: string, patch: Partial<PlannerOperator>) => {
    markDirty()
    setDraft((value) => ({
      ...value,
      operators: value.operators.map((operator) => (operator.id === id ? { ...operator, ...patch } : operator)),
    }))
  }

  const updateStandardWork = (id: string, patch: Partial<StandardWorkDefinition>) => {
    markDirty()
    setDraft((value) => ({
      ...value,
      standardWorks: (value.standardWorks ?? []).map((work) => (work.id === id ? { ...work, ...patch } : work)),
    }))
  }

  const pushRuleHistory = (
    base: PlannerSettings,
    work: StandardWorkDefinition,
    rule: StandardWorkRule,
    action: 'create' | 'update' | 'duplicate' | 'deactivate' | 'delete',
  ): PlannerSettings => ({
    ...base,
    standardWorkRuleHistory: [
      {
        id: uid(),
        at: new Date().toISOString(),
        workId: work.id,
        workName: work.name,
        ruleId: rule.id,
        action,
        snapshot: structuredClone(rule),
      },
      ...(base.standardWorkRuleHistory ?? []),
    ].slice(0, 500),
  })

  const ruleKey = (workId: string, ruleId: string) => `${workId}:${ruleId}`

  const resolveRuleDraft = (workId: string, rule: StandardWorkRule) =>
    ruleDrafts[ruleKey(workId, rule.id)] ?? rule

  const patchRuleDraft = (workId: string, rule: StandardWorkRule, patch: Partial<StandardWorkRule>) => {
    const key = ruleKey(workId, rule.id)
    markDirty()
    setRuleDrafts((value) => {
      const current = value[key] ?? structuredClone(rule)
      const next: StandardWorkRule = {
        ...current,
        ...patch,
        conditions: { ...(current.conditions ?? {}), ...(patch.conditions ?? {}) },
      }
      return { ...value, [key]: next }
    })
  }

  const addRule = (work: StandardWorkDefinition) => {
    const next: StandardWorkRule = {
      id: uid(),
      name: '',
      minutes: work.standardMinutes,
      priority: 0,
      active: true,
      conditions: {
        vehicleSizeClass: '',
        colorFamily: '',
        paintCycle: '',
        minPanels: null,
        maxPanels: null,
        attributes: {},
      },
    }

    markDirty()
    setDraft((value) => {
      const updated = {
        ...value,
        standardWorks: (value.standardWorks ?? []).map((item) =>
          item.id === work.id ? { ...item, rules: [...(item.rules ?? []), next] } : item,
        ),
      }
      return pushRuleHistory(updated, work, next, 'create')
    })
    setRuleDrafts((value) => ({ ...value, [ruleKey(work.id, next.id)]: structuredClone(next) }))
  }

  const duplicateRule = (work: StandardWorkDefinition, rule: StandardWorkRule) => {
    const effective = resolveRuleDraft(work.id, rule)
    const duplicate = {
      ...structuredClone(effective),
      id: uid(),
      name: `${effective.name || 'Regola'} copia`,
      active: true,
    }
    markDirty()
    setDraft((value) => {
      const updated = {
        ...value,
        standardWorks: (value.standardWorks ?? []).map((item) =>
          item.id === work.id ? { ...item, rules: [...(item.rules ?? []), duplicate] } : item,
        ),
      }
      return pushRuleHistory(updated, work, duplicate, 'duplicate')
    })
    setRuleDrafts((value) => ({ ...value, [ruleKey(work.id, duplicate.id)]: structuredClone(duplicate) }))
  }

  const saveRule = (work: StandardWorkDefinition, rule: StandardWorkRule) => {
    const key = ruleKey(work.id, rule.id)
    const snapshot = ruleDrafts[key] ?? rule
    const ruleName = String(snapshot.name ?? '').trim()
    const ruleMinutes = Number(snapshot.minutes ?? 0)

    if (!ruleName || ruleMinutes <= 0) {
      setValidationError('Completa correttamente la regola tempo prima di salvare.')
      setRuleSaved(false)
      return
    }

    const normalizedRule: StandardWorkRule = {
      ...snapshot,
      name: ruleName,
      minutes: ruleMinutes,
      priority: Number(snapshot.priority ?? 0),
      active: Boolean(snapshot.active),
      conditions: {
        vehicleSizeClass: snapshot.conditions?.vehicleSizeClass ?? '',
        colorFamily: String(snapshot.conditions?.colorFamily ?? '').trim(),
        paintCycle: String(snapshot.conditions?.paintCycle ?? '').trim(),
        minPanels:
          snapshot.conditions?.minPanels == null || Number.isNaN(Number(snapshot.conditions.minPanels))
            ? null
            : Number(snapshot.conditions.minPanels),
        maxPanels:
          snapshot.conditions?.maxPanels == null || Number.isNaN(Number(snapshot.conditions.maxPanels))
            ? null
            : Number(snapshot.conditions.maxPanels),
        attributes: snapshot.conditions?.attributes ?? {},
      },
    }

    markDirty()
    setDraft((value) => {
      const updated = {
        ...value,
        standardWorks: (value.standardWorks ?? []).map((item) =>
          item.id === work.id
            ? {
                ...item,
                rules: (item.rules ?? []).map((entry) =>
                  entry.id === normalizedRule.id ? normalizedRule : entry,
                ),
              }
            : item,
        ),
      }
      return pushRuleHistory(updated, work, normalizedRule, normalizedRule.active ? 'update' : 'deactivate')
    })

    setRuleDrafts((value) => {
      const next = { ...value }
      delete next[key]
      return next
    })
    setValidationError('')
    setRuleSaved(true)
  }

  const deleteRule = (work: StandardWorkDefinition, rule: StandardWorkRule) => {
    markDirty()
    setDraft((value) => {
      const updated = {
        ...value,
        standardWorks: (value.standardWorks ?? []).map((item) =>
          item.id === work.id
            ? { ...item, rules: (item.rules ?? []).filter((entry) => entry.id !== rule.id) }
            : item,
        ),
      }
      return pushRuleHistory(updated, work, rule, 'delete')
    })
    setRuleDrafts((value) => {
      const next = { ...value }
      delete next[ruleKey(work.id, rule.id)]
      return next
    })
  }

  const updateAbsence = (id: string, patch: Partial<PlannerAbsence>) => {
    markDirty()
    setDraft((value) => ({
      ...value,
      absences: value.absences.map((absence) => (absence.id === id ? { ...absence, ...patch } : absence)),
    }))
  }

  const duplicateWork = (work: StandardWorkDefinition) => {
    const duplicate: StandardWorkDefinition = {
      ...structuredClone(work),
      id: uid(),
      name: `${work.name || 'Lavorazione'} copia`,
      rules: (work.rules ?? []).map((rule) => ({
        ...structuredClone(rule),
        id: uid(),
      })),
    }
    markDirty()
    setDraft((value) => ({
      ...value,
      standardWorks: [...(value.standardWorks ?? []), duplicate],
    }))
  }

  const deleteWork = (workId: string) => {
    markDirty()
    setDraft((value) => ({
      ...value,
      standardWorks: (value.standardWorks ?? []).filter((item) => item.id !== workId),
    }))
    setEditingWorkId((current) => (current === workId ? null : current))
    setRulesWorkId((current) => (current === workId ? null : current))
  }

  const addTimePreset = () => {
    const next: StandardWorkTimePreset = {
      id: uid(),
      workId: '',
      workName: '',
      panelName: '',
      variantCycle: '',
      minutes: 30,
      active: true,
      note: '',
    }
    markDirty()
    setDraft((value) => ({
      ...value,
      standardWorkTimePresets: [next, ...(value.standardWorkTimePresets ?? [])],
    }))
    setEditingTimePresetId(next.id)
  }

  const updateTimePreset = (id: string, patch: Partial<StandardWorkTimePreset>) => {
    markDirty()
    setDraft((value) => ({
      ...value,
      standardWorkTimePresets: (value.standardWorkTimePresets ?? []).map((preset) => preset.id === id
        ? {
            ...preset,
            ...patch,
            panelName: patch.panelName == null ? preset.panelName : String(patch.panelName).trim(),
            workName: patch.workName == null ? preset.workName : String(patch.workName).trim(),
            variantCycle: patch.variantCycle == null ? preset.variantCycle : String(patch.variantCycle).trim(),
            minutes: patch.minutes == null ? preset.minutes : Math.max(1, Number(patch.minutes)),
            note: patch.note == null ? preset.note ?? '' : String(patch.note).trim(),
          }
        : preset),
    }))
  }

  const deleteTimePreset = (id: string) => {
    markDirty()
    setDraft((value) => ({
      ...value,
      standardWorkTimePresets: (value.standardWorkTimePresets ?? []).filter((preset) => preset.id !== id),
    }))
    setEditingTimePresetId((current) => current === id ? null : current)
  }

  const persistDraft = async (closeEditorOnSuccess = false) => {
    const problem = !draft.workingDays.length
      ? 'Seleziona almeno un giorno lavorativo.'
      : draft.operators.some((operator) => !operator.name.trim() || operator.dailyHours <= 0 || operator.dailyHours > 24)
        ? 'Completa correttamente nomi e ore degli operatori.'
        : draft.efficiencyPercent <= 0 || draft.efficiencyPercent > 100 || draft.safetyMarginPercent < 0 || draft.safetyMarginPercent >= 100
          ? 'Efficienza e margine di sicurezza non sono validi.'
          : (draft.deliveryBufferMode !== 'hours' && draft.deliveryBufferMode !== 'percent') || Number(draft.deliveryBufferValue ?? 0) < 0
            ? 'Configura correttamente il buffer sicurezza consegna.'
          : (draft.standardWorks ?? []).some((work) => !work.name.trim() || (work.active && work.standardMinutes <= 0) || work.cycleOrder < 0 || (work.calculationType !== 'per-vehicle' && work.calculationType !== 'per-panel'))
            ? 'Completa correttamente i tempi standard lavorazioni.'
            : (draft.standardWorks ?? []).some((work) => (work.rules ?? []).some((rule) => !rule.name.trim() || rule.minutes <= 0))
              ? 'Completa correttamente le regole tempi.'
                : (draft.standardWorkTimePresets ?? []).some((preset) => !preset.workName.trim() || !preset.panelName.trim() || Number(preset.minutes) <= 0)
                  ? 'Completa correttamente i tempi predefiniti per pannello e lavorazione.'
              : draft.absences.some((absence) => !absence.startDate || !absence.endDate || absence.endDate < absence.startDate)
                ? 'Completa correttamente gli intervalli di ferie e assenze.'
                : ''

    if (problem) {
      setValidationError(problem)
      setSaved(false)
      return
    }

    setSaving(true)
    try {
      await onSave(structuredClone(draft))
      setValidationError('')
      setSaved(true)
      setRuleSaved(false)
      setDirty(false)
      setRuleDrafts({})
      if (closeEditorOnSuccess) setEditingWorkId(null)
    } catch {
      setSaved(false)
      setValidationError('Salvataggio non riuscito')
    } finally {
      setSaving(false)
    }
  }

  return <section className="settings-stack">
    <div className="welcome">
      <div>
        <span className="eyebrow">CAPACITA PRODUTTIVA</span>
        <h2>Impostazioni Planner</h2>
        <p>Ogni modifica ricalcola capacita, consegne e obiettivo economico.</p>
      </div>
      <button className="primary" disabled={saving} onClick={() => { void persistDraft(false) }}>{saving ? 'Salvataggio...' : 'Salva impostazioni'}</button>
    </div>

    {saved && <div className="toast success">Modifiche salvate</div>}
    {ruleSaved && <div className="toast success">Regola salvata.</div>}
    {(dirty || hasPendingRuleDrafts) && <div className="toast warning">Modifiche non salvate: prima di uscire usa Salva impostazioni e, per ogni regola modificata, Salva regola.</div>}
    {validationError && <div className="toast warning">{validationError}</div>}

    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">SQUADRA</span>
          <h3>Operatori produttivi</h3>
        </div>
        <button
          className="secondary"
          onClick={() => {
            markDirty()
            setDraft((value) => ({
              ...value,
              operators: [...value.operators, { id: uid(), name: '', dailyHours: 8, active: true }],
            }))
          }}
        >
          + Aggiungi operatore
        </button>
      </div>

      <div className="settings-list">
        {draft.operators.map((operator) => <div className="settings-row" key={operator.id}>
          <input aria-label="Nome operatore" placeholder="Nome operatore" value={operator.name} onChange={(event) => updateOperator(operator.id, { name: event.target.value })} />
          <input aria-label="Ore giornaliere" type="number" min="0.5" max="24" step="0.5" value={operator.dailyHours} onChange={(event) => updateOperator(operator.id, { dailyHours: Number(event.target.value) })} />
          <input aria-label="Competenze" placeholder="Competenze (es. lattoneria, verniciatura)" value={(operator.skills ?? []).join(', ')} onChange={(event) => updateOperator(operator.id, { skills: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
          <label className="check"><input type="checkbox" checked={operator.active} onChange={(event) => updateOperator(operator.id, { active: event.target.checked })} /> Attivo</label>
          <button
            className="danger"
            onClick={() => {
              markDirty()
              setDraft((value) => ({
                ...value,
                operators: value.operators.filter((item) => item.id !== operator.id),
                absences: value.absences.filter((item) => item.operatorId !== operator.id),
              }))
            }}
          >
            Rimuovi
          </button>
        </div>)}
      </div>
      {!draft.operators.length && <p className="settings-note">Aggiungi almeno un operatore per ottenere capacita produttiva.</p>}
    </section>

    <section className="panel form-grid planner-config">
      <fieldset>
        <legend>Giorni lavorativi</legend>
        <div className="day-picker">
          {dayLabels.map((day) => <label className={draft.workingDays.includes(day.value) ? 'selected' : ''} key={day.value}>
            <input
              type="checkbox"
              checked={draft.workingDays.includes(day.value)}
              onChange={() => {
                markDirty()
                setDraft((value) => ({
                  ...value,
                  workingDays: value.workingDays.includes(day.value)
                    ? value.workingDays.filter((item) => item !== day.value)
                    : [...value.workingDays, day.value],
                }))
              }}
            />
            {day.label}
          </label>)}
        </div>
      </fieldset>

      <label>Efficienza programmata (%)<input type="number" min="1" max="100" value={draft.efficiencyPercent} onChange={(event) => { markDirty(); setDraft({ ...draft, efficiencyPercent: Number(event.target.value) }) }} /></label>
      <label>Margine di sicurezza (%)<input type="number" min="0" max="99" value={draft.safetyMarginPercent} onChange={(event) => { markDirty(); setDraft({ ...draft, safetyMarginPercent: Number(event.target.value) }) }} /></label>
      <label>Buffer sicurezza consegna<select value={draft.deliveryBufferMode ?? 'percent'} onChange={(event) => { markDirty(); setDraft({ ...draft, deliveryBufferMode: event.target.value === 'hours' ? 'hours' : 'percent' }) }}><option value="percent">Percentuale</option><option value="hours">Ore</option></select></label>
      <label>Valore buffer sicurezza<input type="number" min="0" step="0.01" value={draft.deliveryBufferValue ?? 10} onChange={(event) => { markDirty(); setDraft({ ...draft, deliveryBufferValue: Number(event.target.value) }) }} /></label>
      <label>Metrica controllo tempi fase<select value={draft.phaseTrackingMetric ?? 'calendar'} onChange={(event) => { markDirty(); setDraft({ ...draft, phaseTrackingMetric: event.target.value === 'man-hours' ? 'man-hours' : 'calendar' }) }}><option value="calendar">Durata calendario fase</option><option value="man-hours">Ore uomo fase</option></select></label>
      <label>Obiettivo fatturato mensile (EUR)<MoneyInput minValue={0} value={draft.monthlyRevenueGoal} onValueChange={(value) => { markDirty(); setDraft({ ...draft, monthlyRevenueGoal: value ?? 0 }) }} /></label>
      <label>Obiettivo margine mensile (EUR)<MoneyInput allowEmpty minValue={0} value={draft.monthlyMarginGoal ?? null} onValueChange={(value) => { markDirty(); setDraft({ ...draft, monthlyMarginGoal: value }) }} /></label>
      <label>Festivita (una data per riga)<textarea value={draft.holidays.join('\n')} onChange={(event) => { markDirty(); setDraft({ ...draft, holidays: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) }) }} placeholder="2026-08-15" /></label>
      <label>Chiusure aziendali (una data per riga)<textarea value={draft.closures.join('\n')} onChange={(event) => { markDirty(); setDraft({ ...draft, closures: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) }) }} placeholder="2026-08-17" /></label>
    </section>

    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">TEMPI STANDARD LAVORAZIONI</span>
          <h3>Vista compatta lavorazioni</h3>
        </div>
        <button
          className="secondary"
          onClick={() => {
            markDirty()
            setDraft((value) => ({
              ...value,
              standardWorks: [
                ...(value.standardWorks ?? []),
                {
                  id: uid(),
                  name: '',
                  calculationType: 'per-vehicle',
                  standardMinutes: 60,
                  categoryOrPhase: '',
                  rules: [],
                  active: true,
                  requiredSkill: '',
                  cycleOrder: 999,
                },
              ],
            }))
          }}
        >
          + Aggiungi lavorazione
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo calcolo</th>
              <th>Tempo standard</th>
              <th>Attesa tecnica</th>
              <th>Ordine</th>
              <th>Attiva</th>
              <th>Regole</th>
              <th>Modifica</th>
            </tr>
          </thead>
          <tbody>
            {(draft.standardWorks ?? [])
              .slice()
              .sort((a, b) => a.cycleOrder - b.cycleOrder || a.name.localeCompare(b.name, 'it-IT'))
              .map((work) => <tr key={work.id}>
                <td><strong>{work.name || 'Nuova lavorazione'}</strong></td>
                <td>{work.calculationType === 'per-panel' ? 'Per pannello' : 'Per vettura'}</td>
                <td>{formatMinutesLabel(work.standardMinutes)}</td>
                <td>{formatMinutesLabel(work.technicalWaitMinutes ?? 0)}</td>
                <td>{work.cycleOrder}</td>
                <td>{work.active ? '✓' : '—'}</td>
                <td>
                  <button className="secondary" onClick={() => setRulesWorkId(work.id)}>
                    Regole ({(work.rules ?? []).length})
                  </button>
                </td>
                <td>
                  <div className="row-actions">
                    <button onClick={() => setEditingWorkId(work.id)}>Modifica</button>
                    <button className="secondary" onClick={() => duplicateWork(work)}>Duplica</button>
                    <button className="secondary" onClick={() => updateStandardWork(work.id, { active: false })}>Disattiva</button>
                  </div>
                </td>
              </tr>)}
          </tbody>
        </table>
      </div>

      {!((draft.standardWorks ?? []).length) && <p className="settings-note">Nessuna lavorazione configurata.</p>}

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-head">
          <div>
            <span className="eyebrow">TEMPI PREDEFINITI</span>
            <h3>Pannello + lavorazione + variante</h3>
          </div>
          <button className="secondary" onClick={addTimePreset}>+ Aggiungi preset tempo</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pannello</th>
                <th>Lavorazione</th>
                <th>Variante</th>
                <th>Minuti</th>
                <th>Attivo</th>
                <th>Modifica</th>
              </tr>
            </thead>
            <tbody>
              {(draft.standardWorkTimePresets ?? []).map((preset) => <tr key={preset.id}>
                <td>{preset.panelName || '—'}</td>
                <td>{preset.workName || '—'}</td>
                <td>{preset.variantCycle || 'Tutte'}</td>
                <td>{formatMinutesLabel(preset.minutes)}</td>
                <td>{preset.active ? '✓' : '—'}</td>
                <td>
                  <div className="row-actions">
                    <button onClick={() => setEditingTimePresetId(preset.id)}>Modifica</button>
                    <button className="secondary" onClick={() => updateTimePreset(preset.id, { active: !preset.active })}>{preset.active ? 'Disattiva' : 'Attiva'}</button>
                  </div>
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {!(draft.standardWorkTimePresets ?? []).length && <small>Nessun preset tempo configurato.</small>}
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-head">
          <div>
            <span className="eyebrow">STORICO REGOLE</span>
            <h3>Ultime modifiche</h3>
          </div>
        </div>
        <div className="settings-list">
          {(draft.standardWorkRuleHistory ?? []).slice(0, 20).map((entry) => <div className="settings-row" key={entry.id}>
            <small>{new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.at))}</small>
            <strong>{entry.workName || 'Lavorazione'}</strong>
            <span>{entry.snapshot.name}</span>
            <span>{entry.action}</span>
            <span>{entry.snapshot.minutes} min</span>
          </div>)}
          {!(draft.standardWorkRuleHistory ?? []).length && <small>Nessuna modifica registrata.</small>}
        </div>
      </div>

    </section>

    {editingWork && <Modal title={`Modifica lavorazione: ${editingWork.name || 'Nuova lavorazione'}`} onClose={() => setEditingWorkId(null)}>
      <div className="form-grid">
        <label>
          Nome lavorazione
          <input value={editingWork.name} onChange={(event) => updateStandardWork(editingWork.id, { name: event.target.value })} />
        </label>
        <label>
          Tipo calcolo
          <select value={editingWork.calculationType ?? 'per-vehicle'} onChange={(event) => updateStandardWork(editingWork.id, { calculationType: event.target.value === 'per-panel' ? 'per-panel' : 'per-vehicle' })}>
            <option value="per-vehicle">Per vettura</option>
            <option value="per-panel">Per pannello</option>
          </select>
        </label>
        <label>
          Tempo standard
          <input type="number" min="1" step="1" value={editingWork.standardMinutes} onChange={(event) => updateStandardWork(editingWork.id, { standardMinutes: Number(event.target.value) })} />
          <small>{formatMinutesLabel(editingWork.standardMinutes)}</small>
        </label>
        <label>
          Tempo tecnico dopo lavorazione (min)
          <input type="number" min="0" step="1" value={editingWork.technicalWaitMinutes ?? 0} onChange={(event) => updateStandardWork(editingWork.id, { technicalWaitMinutes: Number(event.target.value) })} />
        </label>
        <label>
          Fasi bloccate dal tempo tecnico
          <input value={(editingWork.technicalWaitBlocksPhaseNames ?? []).join(', ')} onChange={(event) => updateStandardWork(editingWork.id, { technicalWaitBlocksPhaseNames: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} placeholder="Es. Lucidatura, Rimontaggio" />
        </label>
        <label>
          Fase associata
          <input value={editingWork.categoryOrPhase ?? ''} onChange={(event) => updateStandardWork(editingWork.id, { categoryOrPhase: event.target.value })} />
        </label>
        <label>
          Reparto/competenza
          <input value={editingWork.requiredSkill ?? ''} onChange={(event) => updateStandardWork(editingWork.id, { requiredSkill: event.target.value })} />
        </label>
        <label>
          Ordine ciclo
          <input type="number" min="0" step="1" value={editingWork.cycleOrder} onChange={(event) => updateStandardWork(editingWork.id, { cycleOrder: Number(event.target.value) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={editingWork.active} onChange={(event) => updateStandardWork(editingWork.id, { active: event.target.checked })} /> Attiva
        </label>
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="primary" disabled={saving} onClick={() => { void persistDraft(true) }}>{saving ? 'Salvataggio...' : 'Salva'}</button>
        <button className="secondary" onClick={() => duplicateWork(editingWork)}>Duplica</button>
        <button className="secondary" onClick={() => updateStandardWork(editingWork.id, { active: false })}>Disattiva</button>
        <button className="danger" onClick={() => {
          if (!window.confirm('Eliminare questa lavorazione? L\'operazione rimuovera anche le regole collegate.')) return
          deleteWork(editingWork.id)
        }}>Elimina lavorazione</button>
      </div>
    </Modal>}

    {rulesWork && <Modal title={`Regole tempo: ${rulesWork.name || 'Lavorazione'}`} onClose={() => setRulesWorkId(null)}>
      <div className="panel-head">
        <div>
          <span className="eyebrow">REGOLE TEMPO</span>
          <h3>{rulesWork.name || 'Lavorazione'}</h3>
        </div>
        <button className="secondary" onClick={() => addRule(rulesWork)}>+ Aggiungi regola tempo</button>
      </div>
      <div className="settings-list">
        {(rulesWork.rules ?? [])
          .slice()
          .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, 'it-IT'))
          .map((rule) => {
            const row = resolveRuleDraft(rulesWork.id, rule)
            return <div className="settings-row" key={rule.id}>
              <input aria-label="Nome regola" placeholder="Nome regola" value={row.name} onChange={(event) => patchRuleDraft(rulesWork.id, rule, { name: event.target.value })} />
              <input aria-label="Minuti regola" type="number" min="1" step="1" value={row.minutes} onChange={(event) => patchRuleDraft(rulesWork.id, rule, { minutes: Number(event.target.value) })} />
              <input aria-label="Priorita regola" type="number" min="0" step="1" value={row.priority} onChange={(event) => patchRuleDraft(rulesWork.id, rule, { priority: Number(event.target.value) })} />
              <select aria-label="Dimensione vettura" value={row.conditions?.vehicleSizeClass ?? ''} onChange={(event) => patchRuleDraft(rulesWork.id, rule, { conditions: { ...(row.conditions ?? {}), vehicleSizeClass: (event.target.value as 'piccola' | 'media' | 'grande' | '') } })}><option value="">Tutte le dimensioni</option><option value="piccola">Piccola</option><option value="media">Media</option><option value="grande">Grande</option></select>
              <input aria-label="Famiglia colore" placeholder="Famiglia colore" value={row.conditions?.colorFamily ?? ''} onChange={(event) => patchRuleDraft(rulesWork.id, rule, { conditions: { ...(row.conditions ?? {}), colorFamily: event.target.value } })} />
              <input aria-label="Tipo vernice o ciclo" placeholder="Tipo vernice/ciclo" value={row.conditions?.paintCycle ?? ''} onChange={(event) => patchRuleDraft(rulesWork.id, rule, { conditions: { ...(row.conditions ?? {}), paintCycle: event.target.value } })} />
              <input aria-label="Pannelli minimi" type="number" min="0" step="1" placeholder="Pannelli min" value={row.conditions?.minPanels ?? ''} onChange={(event) => patchRuleDraft(rulesWork.id, rule, { conditions: { ...(row.conditions ?? {}), minPanels: event.target.value ? Number(event.target.value) : null } })} />
              <input aria-label="Pannelli massimi" type="number" min="0" step="1" placeholder="Pannelli max" value={row.conditions?.maxPanels ?? ''} onChange={(event) => patchRuleDraft(rulesWork.id, rule, { conditions: { ...(row.conditions ?? {}), maxPanels: event.target.value ? Number(event.target.value) : null } })} />
              <input aria-label="Attributi extra" placeholder="es. finitura=opaco; strato=triplo" value={stringifyAttributes(row.conditions?.attributes)} onChange={(event) => patchRuleDraft(rulesWork.id, rule, { conditions: { ...(row.conditions ?? {}), attributes: parseAttributes(event.target.value) } })} />
              <label className="check"><input type="checkbox" checked={row.active} onChange={(event) => patchRuleDraft(rulesWork.id, rule, { active: event.target.checked })} /> Attiva</label>
              <button className="primary" onClick={() => saveRule(rulesWork, rule)}>Salva regola</button>
              <button className="secondary" onClick={() => duplicateRule(rulesWork, row)}>Duplica</button>
              <button className="secondary" onClick={() => patchRuleDraft(rulesWork.id, rule, { active: false })}>Disattiva</button>
              <button className="danger" onClick={() => deleteRule(rulesWork, rule)}>Elimina</button>
            </div>
          })}
        {!(rulesWork.rules ?? []).length && <small>Nessuna regola specifica: verra usato il tempo base della lavorazione.</small>}
      </div>
    </Modal>}

    {editingTimePreset && <Modal title={`Preset tempo: ${editingTimePreset.workName || 'Nuovo preset'}`} onClose={() => setEditingTimePresetId(null)}>
      <div className="form-grid">
        <label>Pannello<input value={editingTimePreset.panelName} onChange={(event) => updateTimePreset(editingTimePreset.id, { panelName: event.target.value })} placeholder="Es. Cofano" /></label>
        <label>Lavorazione<select value={editingTimePreset.workId ?? ''} onChange={(event) => {
          const selected = standardWorkById.get(event.target.value)
          updateTimePreset(editingTimePreset.id, { workId: selected?.id ?? '', workName: selected?.name ?? '' })
        }}><option value="">Seleziona lavorazione</option>{(draft.standardWorks ?? []).map((work) => <option key={work.id} value={work.id}>{work.name}</option>)}</select></label>
        <label>Variante/ciclo<input value={editingTimePreset.variantCycle} onChange={(event) => updateTimePreset(editingTimePreset.id, { variantCycle: event.target.value })} placeholder="Es. doppiostrato" /></label>
        <label>Tempo standard (min)<input type="number" min="1" step="1" value={editingTimePreset.minutes} onChange={(event) => updateTimePreset(editingTimePreset.id, { minutes: Number(event.target.value) })} /></label>
        <label>Nota<input value={editingTimePreset.note ?? ''} onChange={(event) => updateTimePreset(editingTimePreset.id, { note: event.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={editingTimePreset.active} onChange={(event) => updateTimePreset(editingTimePreset.id, { active: event.target.checked })} /> Attivo</label>
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="primary" onClick={() => setEditingTimePresetId(null)}>Salva</button>
        <button className="danger" onClick={() => {
          if (!window.confirm('Eliminare questo preset tempi?')) return
          deleteTimePreset(editingTimePreset.id)
        }}>Elimina</button>
      </div>
    </Modal>}

    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">FERIE E ASSENZE</span>
          <h3>Disponibilita operatori</h3>
        </div>
        <button
          className="secondary"
          disabled={!draft.operators.length}
          onClick={() => {
            markDirty()
            setDraft((value) => ({
              ...value,
              absences: [
                ...value.absences,
                {
                  id: uid(),
                  operatorId: value.operators[0].id,
                  startDate: '',
                  endDate: '',
                  hoursPerDay: null,
                  reason: '',
                },
              ],
            }))
          }}
        >
          + Aggiungi assenza
        </button>
      </div>

      <div className="settings-list">
        {draft.absences.map((absence) => <div className="settings-row absence-row" key={absence.id}>
          <select value={absence.operatorId} onChange={(event) => updateAbsence(absence.id, { operatorId: event.target.value })}>
            {draft.operators.map((operator) => <option value={operator.id} key={operator.id}>{operator.name || 'Operatore senza nome'}</option>)}
          </select>
          <input aria-label="Inizio assenza" type="date" value={absence.startDate} onChange={(event) => updateAbsence(absence.id, { startDate: event.target.value })} />
          <input aria-label="Fine assenza" type="date" value={absence.endDate} onChange={(event) => updateAbsence(absence.id, { endDate: event.target.value })} />
          <input aria-label="Ore assenza" type="number" min="0" step="0.5" placeholder="Tutto il giorno" value={absence.hoursPerDay ?? ''} onChange={(event) => updateAbsence(absence.id, { hoursPerDay: event.target.value ? Number(event.target.value) : null })} />
          <input aria-label="Motivo assenza" placeholder="Motivo" value={absence.reason} onChange={(event) => updateAbsence(absence.id, { reason: event.target.value })} />
          <button
            className="danger"
            onClick={() => {
              markDirty()
              setDraft((value) => ({
                ...value,
                absences: value.absences.filter((item) => item.id !== absence.id),
              }))
            }}
          >
            Rimuovi
          </button>
        </div>)}
      </div>
    </section>
  </section>
}
