import { useEffect, useMemo, useState } from 'react'
import type { PlannerSettings, Vehicle, VehicleStatusDefinition, VehicleStatusSemantic } from '../../types'
import { canDeleteVehicleStatus, defaultVehicleStatus, normalizeVehicleStatuses, resolveVehicleStatusId } from '../../services/vehicleStatuses'

const ICON_OPTIONS = ['dot', 'play', 'pause', 'flag', 'check', 'wrench', 'hammer', 'brush', 'spray', 'box', 'truck', 'block', 'calendar', 'clipboard', 'sun', 'toolbox', 'spark', 'x']
const SEMANTIC_OPTIONS: VehicleStatusSemantic[] = ['custom', 'accepted', 'planning', 'waiting', 'waiting-parts', 'in-work', 'phase', 'ready', 'delivered', 'blocked', 'cancelled']

const slugify = (value: string) => value
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

export function VehicleStatusesSettingsPage({
  settings,
  vehicles,
  onSave,
}: {
  settings: PlannerSettings
  vehicles: Vehicle[]
  onSave: (settings: PlannerSettings) => Promise<void>
}) {
  const [draftStatuses, setDraftStatuses] = useState<VehicleStatusDefinition[]>(() => normalizeVehicleStatuses(settings))
  const [draftDefault, setDraftDefault] = useState<string>(() => resolveVehicleStatusId(settings, settings.defaultVehicleStatus || defaultVehicleStatus(settings)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraftStatuses(normalizeVehicleStatuses(settings))
    setDraftDefault(resolveVehicleStatusId(settings, settings.defaultVehicleStatus || defaultVehicleStatus(settings)))
    setError('')
    setSaved(false)
  }, [settings])

  const sortedStatuses = useMemo(() => [...draftStatuses].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'it-IT')), [draftStatuses])

  const reorder = (id: string, delta: -1 | 1) => {
    setSaved(false)
    setDraftStatuses((current) => {
      const ordered = [...current].sort((a, b) => a.sortOrder - b.sortOrder)
      const index = ordered.findIndex((item) => item.id === id)
      const targetIndex = index + delta
      if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return current
      const target = ordered[targetIndex]
      const active = ordered[index]
      ordered[index] = target
      ordered[targetIndex] = active
      return ordered.map((item, itemIndex) => ({ ...item, sortOrder: (itemIndex + 1) * 10 }))
    })
  }

  const addStatus = () => {
    setSaved(false)
    setDraftStatuses((current) => {
      const max = current.reduce((acc, item) => Math.max(acc, item.sortOrder), 0)
      return [
        ...current,
        {
          id: `custom-${crypto.randomUUID().slice(0, 8)}`,
          label: 'Nuovo stato',
          color: '#6a6a6a',
          icon: 'dot',
          active: true,
          sortOrder: max + 10,
          semantic: 'custom',
        },
      ]
    })
  }

  const updateStatus = (id: string, patch: Partial<VehicleStatusDefinition>) => {
    setSaved(false)
    setDraftStatuses((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const removeStatus = (id: string) => {
    const nextSettings: PlannerSettings = {
      ...settings,
      vehicleStatuses: draftStatuses,
      defaultVehicleStatus: draftDefault,
    }
    if (!canDeleteVehicleStatus(nextSettings, vehicles, id)) {
      setError('Non puoi eliminare uno stato attualmente usato da almeno una vettura.')
      return
    }
    setSaved(false)
    setError('')
    setDraftStatuses((current) => current.filter((item) => item.id !== id))
    setDraftDefault((current) => current === id ? defaultVehicleStatus(nextSettings) : current)
  }

  const save = async () => {
    const normalized = sortedStatuses.map((item, index) => {
      const label = item.label.trim()
      const id = slugify(item.id || label)
      return {
        ...item,
        id: id || `status-${index + 1}`,
        label: label || `Stato ${index + 1}`,
        sortOrder: (index + 1) * 10,
      }
    })

    if (!normalized.some((item) => item.active)) {
      setError('Mantieni almeno uno stato attivo.')
      return
    }

    const resolvedDefault = normalized.some((item) => item.id === draftDefault && item.active)
      ? draftDefault
      : normalized.find((item) => item.active)?.id

    if (!resolvedDefault) {
      setError('Definisci uno stato predefinito valido.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSave({
        ...settings,
        vehicleStatuses: normalized,
        defaultVehicleStatus: resolvedDefault,
      })
      setSaved(true)
    } catch {
      setError('Salvataggio non riuscito.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="settings-stack">
    <div className="welcome">
      <div>
        <span className="eyebrow">STATI VETTURA</span>
        <h2>Stato libero, non progressivo</h2>
        <p>Lo stato e suggerito automaticamente ma resta modificabile manualmente in qualsiasi momento.</p>
      </div>
      <div className="planner-actions">
        <button className="secondary" onClick={addStatus}>Nuovo stato</button>
        <button className="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Salvataggio...' : 'Salva stati vettura'}</button>
      </div>
    </div>

    {error && <div className="toast error">{error}</div>}
    {saved && <div className="toast success">Stati vettura salvati.</div>}

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">CATALOGO</span><h3>{sortedStatuses.length} stati</h3></div></div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ordine</th>
              <th>Stato</th>
              <th>Colore</th>
              <th>Icona</th>
              <th>Semantica</th>
              <th>Attivo</th>
              <th>Predefinito</th>
              <th>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {sortedStatuses.map((status, index) => <tr key={status.id}>
              <td>
                <div className="row-actions">
                  <button type="button" onClick={() => reorder(status.id, -1)} disabled={index === 0}>↑</button>
                  <button type="button" onClick={() => reorder(status.id, 1)} disabled={index === sortedStatuses.length - 1}>↓</button>
                </div>
              </td>
              <td>
                <input value={status.label} onChange={(event) => updateStatus(status.id, { label: event.target.value })} />
              </td>
              <td>
                <input type="color" value={status.color || '#6a6a6a'} onChange={(event) => updateStatus(status.id, { color: event.target.value })} />
              </td>
              <td>
                <select value={status.icon} onChange={(event) => updateStatus(status.id, { icon: event.target.value })}>
                  {ICON_OPTIONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
                </select>
              </td>
              <td>
                <select value={status.semantic} onChange={(event) => updateStatus(status.id, { semantic: event.target.value as VehicleStatusSemantic })}>
                  {SEMANTIC_OPTIONS.map((semantic) => <option key={semantic} value={semantic}>{semantic}</option>)}
                </select>
              </td>
              <td>
                <label className="check"><input type="checkbox" checked={status.active} onChange={(event) => updateStatus(status.id, { active: event.target.checked })} /> Attivo</label>
              </td>
              <td>
                <label className="check"><input type="radio" name="vehicle-default-status" checked={draftDefault === status.id} onChange={() => setDraftDefault(status.id)} /> Default</label>
              </td>
              <td>
                <button className="danger" onClick={() => removeStatus(status.id)}>Elimina</button>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </section>
}
