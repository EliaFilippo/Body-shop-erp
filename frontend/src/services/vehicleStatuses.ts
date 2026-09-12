import type { PlannerSettings, Vehicle, VehicleStatus, VehicleStatusDefinition, VehicleStatusSemantic } from '../types'

const normalize = (value: string) => value.trim().toLowerCase()

const slugify = (value: string) => value
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

export const DEFAULT_VEHICLE_STATUSES: VehicleStatusDefinition[] = [
  { id: 'accettata', label: 'Accettata', color: '#4a5d7a', icon: 'clipboard', active: true, sortOrder: 10, semantic: 'accepted' },
  { id: 'da-pianificare', label: 'Da pianificare', color: '#5a4f7a', icon: 'calendar', active: true, sortOrder: 20, semantic: 'planning' },
  { id: 'in-attesa', label: 'In attesa', color: '#8a6e3d', icon: 'pause', active: true, sortOrder: 30, semantic: 'waiting' },
  { id: 'in-attesa-ricambi', label: 'In attesa ricambi', color: '#8a5a3d', icon: 'box', active: true, sortOrder: 40, semantic: 'waiting-parts' },
  { id: 'smontaggio', label: 'Smontaggio', color: '#41595f', icon: 'wrench', active: true, sortOrder: 50, semantic: 'phase' },
  { id: 'lattoneria', label: 'Lattoneria', color: '#35666d', icon: 'hammer', active: true, sortOrder: 60, semantic: 'phase' },
  { id: 'preparazione', label: 'Preparazione', color: '#3a6a60', icon: 'brush', active: true, sortOrder: 70, semantic: 'phase' },
  { id: 'verniciatura', label: 'Verniciatura', color: '#2f6b74', icon: 'spray', active: true, sortOrder: 80, semantic: 'phase' },
  { id: 'essiccazione', label: 'Essiccazione', color: '#5d6f80', icon: 'sun', active: true, sortOrder: 90, semantic: 'phase' },
  { id: 'rimontaggio', label: 'Rimontaggio', color: '#4b6470', icon: 'toolbox', active: true, sortOrder: 100, semantic: 'phase' },
  { id: 'lucidatura', label: 'Lucidatura', color: '#5a6d5a', icon: 'spark', active: true, sortOrder: 110, semantic: 'phase' },
  { id: 'controllo-qualita', label: 'Controllo qualità', color: '#4a6d8a', icon: 'checklist', active: true, sortOrder: 120, semantic: 'phase' },
  { id: 'in-lavorazione', label: 'In lavorazione', color: '#2f7a5a', icon: 'play', active: true, sortOrder: 130, semantic: 'in-work' },
  { id: 'pronta', label: 'Pronta', color: '#2d7d63', icon: 'flag', active: true, sortOrder: 140, semantic: 'ready' },
  { id: 'consegnata', label: 'Consegnata', color: '#2d7a3f', icon: 'truck', active: true, sortOrder: 150, semantic: 'delivered' },
  { id: 'bloccata', label: 'Bloccata', color: '#8a3d3d', icon: 'block', active: true, sortOrder: 160, semantic: 'blocked' },
  { id: 'annullata', label: 'Annullata', color: '#6b6b6b', icon: 'x', active: true, sortOrder: 170, semantic: 'cancelled' },
]

const LEGACY_TO_ID: Record<string, string> = {
  'accettata': 'accettata',
  'confermata': 'da-pianificare',
  'in lavorazione': 'in-lavorazione',
  'preparazione': 'preparazione',
  'verniciatura': 'verniciatura',
  'rimontaggio': 'rimontaggio',
  'lucidatura': 'lucidatura',
  'lavaggio': 'controllo-qualita',
  'controllo qualità': 'controllo-qualita',
  'pronta': 'pronta',
  'consegnata': 'consegnata',
  'sospesa': 'in-attesa',
  'annullata': 'annullata',
}

function ensureUniqueStatuses(items: VehicleStatusDefinition[]) {
  const byId = new Map<string, VehicleStatusDefinition>()
  for (const item of items) {
    const id = slugify(item.id || item.label) || `stato-${crypto.randomUUID().slice(0, 8)}`
    if (byId.has(id)) continue
    byId.set(id, {
      ...item,
      id,
      label: item.label.trim() || id,
      color: item.color || '#5a5a5a',
      icon: item.icon || 'dot',
      active: Boolean(item.active),
      sortOrder: Number(item.sortOrder ?? 999),
      semantic: item.semantic ?? 'custom',
    })
  }
  return Array.from(byId.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'it-IT'))
}

export function normalizeVehicleStatuses(settings: PlannerSettings) {
  const defaults = DEFAULT_VEHICLE_STATUSES
  const custom = Array.isArray(settings.vehicleStatuses) ? settings.vehicleStatuses : defaults
  const normalized = ensureUniqueStatuses(custom)
  if (!normalized.length) return [...defaults]
  return normalized
}

export function statusById(settings: PlannerSettings, id: string) {
  const normalizedId = slugify(id)
  return normalizeVehicleStatuses(settings).find((item) => item.id === normalizedId) ?? null
}

export function resolveVehicleStatusId(settings: PlannerSettings, value?: string | null): VehicleStatus {
  const fallback = settings.defaultVehicleStatus || DEFAULT_VEHICLE_STATUSES[0].id
  const input = String(value ?? '').trim()
  if (!input) return fallback
  const statuses = normalizeVehicleStatuses(settings)
  const direct = statuses.find((item) => item.id === input)
  if (direct) return direct.id
  const byLabel = statuses.find((item) => normalize(item.label) === normalize(input))
  if (byLabel) return byLabel.id
  const legacy = LEGACY_TO_ID[normalize(input)]
  if (legacy) {
    const legacyStatus = statuses.find((item) => item.id === legacy)
    if (legacyStatus) return legacyStatus.id
  }
  const generated = slugify(input)
  return generated || fallback
}

export function resolveVehicleStatusLabel(settings: PlannerSettings, status: VehicleStatus) {
  const found = statusById(settings, status)
  return found?.label ?? status
}

export function listSelectableVehicleStatuses(settings: PlannerSettings, includeStatus?: VehicleStatus) {
  const statuses = normalizeVehicleStatuses(settings).filter((item) => item.active)
  if (!includeStatus) return statuses
  if (statuses.some((item) => item.id === includeStatus)) return statuses
  const hidden = statusById(settings, includeStatus)
  return hidden ? [...statuses, hidden] : statuses
}

export function isVehicleStatusSemantic(settings: PlannerSettings, status: VehicleStatus, semantic: VehicleStatusSemantic) {
  const found = statusById(settings, status)
  if (found) return found.semantic === semantic
  const legacy = LEGACY_TO_ID[normalize(status)]
  if (!legacy) return false
  const legacyFound = statusById(settings, legacy)
  return legacyFound?.semantic === semantic
}

export function isVehicleDeliveredStatus(settings: PlannerSettings, status: VehicleStatus) {
  return isVehicleStatusSemantic(settings, status, 'delivered')
}

export function isVehicleConeRequiredStatus(settings: PlannerSettings, status: VehicleStatus) {
  const found = statusById(settings, status)
  const semantic = found?.semantic
  return semantic === 'planning' || semantic === 'in-work' || semantic === 'phase' || semantic === 'ready'
}

export function defaultVehicleStatus(settings: PlannerSettings) {
  const statuses = normalizeVehicleStatuses(settings)
  const configured = statusById(settings, settings.defaultVehicleStatus || '')
  if (configured?.active) return configured.id
  return statuses.find((item) => item.active)?.id ?? DEFAULT_VEHICLE_STATUSES[0].id
}

function statusIdBySemantic(settings: PlannerSettings, semantic: VehicleStatusSemantic) {
  return normalizeVehicleStatuses(settings).find((item) => item.active && item.semantic === semantic)?.id
    ?? normalizeVehicleStatuses(settings).find((item) => item.semantic === semantic)?.id
    ?? null
}

export function suggestVehicleStatus(settings: PlannerSettings, vehicle: Vehicle, jobStatus?: string) {
  if (vehicle.partsStatus === 'Mancanti') {
    const waitingParts = statusIdBySemantic(settings, 'waiting-parts')
    if (waitingParts) return waitingParts
  }
  if (vehicle.blockReason.trim()) {
    const blocked = statusIdBySemantic(settings, 'blocked')
    if (blocked) return blocked
  }
  if (jobStatus === 'Consegnata') {
    const delivered = statusIdBySemantic(settings, 'delivered')
    if (delivered) return delivered
  }
  if (jobStatus === 'Pronta consegna') {
    const ready = statusIdBySemantic(settings, 'ready')
    if (ready) return ready
  }
  if (jobStatus === 'In lavorazione' || jobStatus === 'In attesa' || jobStatus === 'Controllo qualità') {
    const inWork = statusIdBySemantic(settings, 'in-work')
    if (inWork) return inWork
  }
  if (jobStatus === 'Pianificata' || jobStatus === 'Da pianificare') {
    const planning = statusIdBySemantic(settings, 'planning')
    if (planning) return planning
  }
  return null
}

export function canDeleteVehicleStatus(settings: PlannerSettings, vehicles: Vehicle[], statusId: string) {
  const current = resolveVehicleStatusId(settings, statusId)
  return !vehicles.some((vehicle) => resolveVehicleStatusId(settings, vehicle.status) === current)
}
