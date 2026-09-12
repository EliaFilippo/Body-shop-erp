import type { ErpData, JobPhaseOperatorAssignment, PlannerSettings } from '../types'
import { defaultPlannerSettings, emptyData, normalizePlate, normalizeVin, STORAGE_KEY } from './erp'
import { EXPECTED_APP_ORIGIN, currentOriginLabel, isAllowedPersistenceOrigin } from './originGuard'
import { defaultVehicleStatus, normalizeVehicleStatuses, resolveVehicleStatusId } from './vehicleStatuses'
import { DEFAULT_WEEKLY_WORK_SCHEDULE, normalizeWeeklyWorkSchedule } from './workCalendar'

export const DB_NAME = 'carrozzeria-elias-erp'
export const STORE = 'erp-state'
export const STATE_KEY = 'current'
export const CURRENT_VERSION = 5
export const REVISION_PING_KEY = `${DB_NAME}:revision-ping`

export interface IntegritySnapshot {
  customers: number
  vehicles: number
  estimates: number
  jobs: number
}

export interface SaveDatabaseOptions {
  allowCountReduction?: boolean
  mergeOnConflict?: boolean
}

export interface OrphanReference {
  source: string
  vehicleId: string
}

export interface DuplicateVehicleEntry {
  vehicleId: string
  plate: string
  normalizedPlate: string
  customerId: string
  customerName: string
  createdAt: string
  updatedAt: string
  references: number
}

export interface DuplicatePlateGroup {
  normalizedPlate: string
  vehicles: DuplicateVehicleEntry[]
}

export interface DatabaseIntegrityReport {
  dbId: string
  revision: number
  origin: string
  customers: number
  vehicles: number
  estimates: number
  jobs: number
  duplicatePlates: DuplicatePlateGroup[]
  orphanReferences: OrphanReference[]
}

export interface DuplicateResolutionPlan {
  normalizedPlate: string
  canonicalVehicleId: string
  consolidatedVehicleIds: string[]
  relationsToTransfer: number
}

export interface DuplicateResolutionResult {
  plan: DuplicateResolutionPlan
  backupKey: string
  revisionBefore: number
  revisionAfter: number
  duplicateCountAfter: number
  orphanCountAfter: number
}

const readFallback = () => typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)

export function buildIntegritySnapshot(data: ErpData): IntegritySnapshot {
  return {
    customers: data.customers.length,
    vehicles: data.vehicles.length,
    estimates: (data.estimates ?? []).length,
    jobs: (data.jobs ?? []).length,
  }
}

const formatIntegritySnapshot = (snapshot: IntegritySnapshot) =>
  `clienti=${snapshot.customers}, veicoli=${snapshot.vehicles}, preventivi=${snapshot.estimates}, commesse=${snapshot.jobs}`

function buildNormalizedPlateMap(vehicles: ErpData['vehicles']) {
  const map = new Map<string, Set<string>>()
  for (const vehicle of vehicles) {
    const plate = normalizePlate(vehicle.plate)
    if (!plate) continue
    const ids = map.get(plate) ?? new Set<string>()
    ids.add(vehicle.id)
    map.set(plate, ids)
  }
  return map
}

function assertUniqueNormalizedPlates(data: ErpData, context: string) {
  const plateMap = buildNormalizedPlateMap(data.vehicles)
  for (const [plate, ids] of plateMap) {
    if (ids.size > 1) {
      const rawSamples = data.vehicles
        .filter((vehicle) => normalizePlate(vehicle.plate) === plate)
        .map((vehicle) => vehicle.plate)
      throw new Error(
        `Salvataggio bloccato: targa duplicata rilevata. source=snapshot/persistence/cross-tab; context=${context}; targaInserita=${rawSamples[0] ?? '-'}; targaNormalizzata=${plate}; conflictVehicleIds=${[...ids].join('|')}; rev=${Math.max(0, Number(data.dbRevision ?? 0))}.`,
      )
    }
  }
}

function assertPlateAvailability(latest: ErpData, candidate: ErpData) {
  const latestMap = buildNormalizedPlateMap(latest.vehicles)
  const candidateMap = buildNormalizedPlateMap(candidate.vehicles)
  for (const [plate, candidateIds] of candidateMap) {
    const latestIds = latestMap.get(plate)
    if (!latestIds) continue
    const sameSingleRecord = candidateIds.size === 1 && latestIds.size === 1 && candidateIds.values().next().value === latestIds.values().next().value
    if (!sameSingleRecord) {
      const candidateRawPlate = candidate.vehicles.find((vehicle) => normalizePlate(vehicle.plate) === plate)?.plate ?? '-'
      throw new Error(
        `Salvataggio bloccato: targa duplicata rilevata. source=snapshot/persistence/cross-tab; context=assertPlateAvailability; targaInserita=${candidateRawPlate}; targaNormalizzata=${plate}; conflictVehicleIdCandidate=${candidateIds.values().next().value ?? '-'}; conflictVehicleIdPersisted=${latestIds.values().next().value ?? '-'}; candidateIds=${[...candidateIds].join('|')}; persistedIds=${[...latestIds].join('|')}; revRichiesta=${Math.max(0, Number(candidate.dbRevision ?? 0))}; revPersistita=${Math.max(0, Number(latest.dbRevision ?? 0))}.`,
      )
    }
  }
}

async function withCrossTabSaveLock<T>(task: () => Promise<T>): Promise<T> {
  const lockName = `${DB_NAME}:save-lock`
  const hasNavigatorLocks = typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { locks?: LockManager }).locks?.request)
  if (hasNavigatorLocks) {
    return (navigator as Navigator & { locks: LockManager }).locks.request(lockName, { mode: 'exclusive' }, task)
  }

  if (typeof localStorage === 'undefined') return task()

  const storageKey = `${lockName}:lease`
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const leaseMs = 5000
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  while (true) {
    const now = Date.now()
    const raw = localStorage.getItem(storageKey)
    const current = raw ? (() => { try { return JSON.parse(raw) as { token: string; expiresAt: number } } catch { return null } })() : null
    if (!current || current.expiresAt <= now) {
      localStorage.setItem(storageKey, JSON.stringify({ token, expiresAt: now + leaseMs }))
      const confirmed = (() => { try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { token?: string } | null } catch { return null } })()
      if (confirmed?.token === token) break
    }
    await delay(25)
  }

  try {
    return await task()
  } finally {
    const current = (() => { try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { token?: string } | null } catch { return null } })()
    if (current?.token === token) localStorage.removeItem(storageKey)
  }
}

function mergeById<T extends { id: string }>(latest: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>()
  latest.forEach((item) => byId.set(item.id, item))
  incoming.forEach((item) => byId.set(item.id, item))
  return [...byId.values()]
}

function mergeForStaleSave(latest: ErpData, incoming: ErpData): ErpData {
  return {
    ...incoming,
    customers: mergeById(latest.customers, incoming.customers),
    vehicles: mergeById(latest.vehicles, incoming.vehicles),
    estimates: mergeById(latest.estimates ?? [], incoming.estimates ?? []),
    jobs: mergeById(latest.jobs ?? [], incoming.jobs ?? []),
  }
}

function assertIntegrityReductionAllowed(previous: ErpData, next: ErpData, allowCountReduction: boolean) {
  if (allowCountReduction) return
  const before = buildIntegritySnapshot(previous)
  const after = buildIntegritySnapshot(next)
  if (
    after.customers < before.customers
    || after.vehicles < before.vehicles
    || after.estimates < before.estimates
    || after.jobs < before.jobs
  ) {
    throw new Error(
      `Salvataggio bloccato: riduzione anagrafica rilevata (${formatIntegritySnapshot(before)} -> ${formatIntegritySnapshot(after)}).`,
    )
  }
}

function collectVehicleReferences(data: ErpData): Array<{ source: string; vehicleId: string }> {
  const refs: Array<{ source: string; vehicleId: string }> = []

  const visit = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}[${index}]`))
      return
    }
    if (!node || typeof node !== 'object') return

    const record = node as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      const nextPath = `${path}.${key}`
      if ((key === 'vehicleId' || key === 'vehicleIdBefore' || key === 'vehicleIdAfter') && typeof value === 'string' && value.trim()) {
        refs.push({ source: nextPath, vehicleId: value })
      }
      visit(value, nextPath)
    }
  }

  visit(data, 'erp')
  return refs
}

function buildDuplicatePlateGroups(data: ErpData): DuplicatePlateGroup[] {
  const customerNameById = new Map(data.customers.map((customer) => [customer.id, customer.name]))
  const refs = collectVehicleReferences(data)
  const refsByVehicleId = new Map<string, number>()
  for (const ref of refs) refsByVehicleId.set(ref.vehicleId, (refsByVehicleId.get(ref.vehicleId) ?? 0) + 1)

  const byPlate = new Map<string, ErpData['vehicles']>()
  for (const vehicle of data.vehicles) {
    const normalized = normalizePlate(vehicle.plate)
    if (!normalized) continue
    const list = byPlate.get(normalized) ?? []
    list.push(vehicle)
    byPlate.set(normalized, list)
  }

  const duplicates: DuplicatePlateGroup[] = []
  for (const [normalizedPlate, vehicles] of byPlate) {
    if (vehicles.length < 2) continue
    duplicates.push({
      normalizedPlate,
      vehicles: vehicles.map((vehicle) => ({
        vehicleId: vehicle.id,
        plate: vehicle.plate,
        normalizedPlate,
        customerId: vehicle.customerId,
        customerName: customerNameById.get(vehicle.customerId) ?? '',
        createdAt: vehicle.createdAt ?? '',
        updatedAt: (vehicle as { updatedAt?: string }).updatedAt ?? '',
        references: refsByVehicleId.get(vehicle.id) ?? 0,
      })),
    })
  }

  return duplicates.sort((a, b) => b.vehicles.length - a.vehicles.length || a.normalizedPlate.localeCompare(b.normalizedPlate))
}

function buildOrphanReferences(data: ErpData): OrphanReference[] {
  const knownIds = new Set(data.vehicles.map((vehicle) => vehicle.id))
  return collectVehicleReferences(data)
    .filter((ref) => !knownIds.has(ref.vehicleId))
}

function countRelationsForVehicleIds(data: ErpData, vehicleIds: Set<string>): number {
  const refs = collectVehicleReferences(data)
  const direct = refs.reduce((total, ref) => total + (vehicleIds.has(ref.vehicleId) ? 1 : 0), 0)
  const history = data.vehicles.reduce((total, vehicle) => total + (vehicleIds.has(vehicle.id) ? (vehicle.statusHistory?.length ?? 0) : 0), 0)
  return direct + history
}

function pickCanonicalVehicle(vehicles: ErpData['vehicles'], data: ErpData): ErpData['vehicles'][number] {
  const refs = collectVehicleReferences(data)
  const refsByVehicleId = new Map<string, number>()
  for (const ref of refs) refsByVehicleId.set(ref.vehicleId, (refsByVehicleId.get(ref.vehicleId) ?? 0) + 1)

  const score = (vehicle: ErpData['vehicles'][number]) => {
    const value = vehicle as unknown as Record<string, unknown>
    const filledFields = [
      'plate', 'customerId', 'make', 'model', 'color', 'year', 'vin', 'mileage', 'status',
      'priority', 'deliveryDate', 'plannedEntryDate', 'requestedDeliveryDate', 'calculatedDeliveryDate',
      'partsStatus', 'blockReason', 'manualPlanningDate',
    ].reduce((total, key) => total + (value[key] ? 1 : 0), 0)
    const numerics = [vehicle.estimatedHours, vehicle.workedHours, vehicle.expectedRevenue, vehicle.expectedMargin]
      .reduce((total, numberValue) => total + (Number(numberValue ?? 0) !== 0 ? 1 : 0), 0)
    const references = refsByVehicleId.get(vehicle.id) ?? 0
    const history = vehicle.statusHistory?.length ?? 0
    return filledFields + numerics + references + history
  }

  return [...vehicles].sort((left, right) => {
    const byScore = score(right) - score(left)
    if (byScore !== 0) return byScore
    return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  })[0]
}

function mergeVehicleDetails(canonical: ErpData['vehicles'][number], duplicate: ErpData['vehicles'][number]): ErpData['vehicles'][number] {
  const merged = { ...canonical } as unknown as Record<string, unknown>
  const duplicateAsRecord = duplicate as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(duplicateAsRecord)) {
    if (key === 'id' || key === 'statusHistory') continue
    if (!merged[key] && value) merged[key] = value
  }

  const duplicateHistory = (duplicate.statusHistory ?? []).map((entry) => ({ ...entry, vehicleId: canonical.id }))
  const mergedHistory = [...(canonical.statusHistory ?? []), ...duplicateHistory]
  const dedup = new Map<string, (typeof mergedHistory)[number]>()
  for (const entry of mergedHistory) {
    const signature = JSON.stringify([entry.at, entry.from, entry.to, entry.note, entry.source])
    if (!dedup.has(signature)) dedup.set(signature, entry)
  }
  merged.statusHistory = [...dedup.values()]
  return merged as unknown as ErpData['vehicles'][number]
}

function remapVehicleReferences(data: ErpData, duplicateIds: Set<string>, canonicalVehicleId: string): ErpData {
  const remapNode = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map((entry) => remapNode(entry))
    if (!node || typeof node !== 'object') return node

    const record = node as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if ((key === 'vehicleId' || key === 'vehicleIdBefore' || key === 'vehicleIdAfter') && typeof value === 'string' && duplicateIds.has(value)) {
        next[key] = canonicalVehicleId
      } else {
        next[key] = remapNode(value)
      }
    }
    return next
  }

  return remapNode(data) as ErpData
}

async function readAuthoritativeSnapshot(): Promise<ErpData> {
  const database = await openDatabase()
  try {
    const stored = await new Promise<ErpData | undefined>((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(STATE_KEY)
      request.onsuccess = () => resolve(request.result as ErpData | undefined)
      request.onerror = () => reject(request.error)
    })
    return normalizeData(stored ?? emptyData)
  } finally {
    database.close()
  }
}

export async function analyzeDatabaseIntegrity(): Promise<DatabaseIntegrityReport> {
  const snapshot = await readAuthoritativeSnapshot()
  return {
    dbId: DB_NAME,
    revision: Math.max(0, Number(snapshot.dbRevision ?? 0)),
    origin: currentOriginLabel(),
    customers: snapshot.customers.length,
    vehicles: snapshot.vehicles.length,
    estimates: (snapshot.estimates ?? []).length,
    jobs: (snapshot.jobs ?? []).length,
    duplicatePlates: buildDuplicatePlateGroups(snapshot),
    orphanReferences: buildOrphanReferences(snapshot),
  }
}

export async function prepareDuplicateResolution(normalizedPlateInput: string): Promise<DuplicateResolutionPlan> {
  const normalizedPlate = normalizePlate(normalizedPlateInput)
  if (!normalizedPlate) throw new Error('Targa normalizzata non valida.')
  const snapshot = await readAuthoritativeSnapshot()
  const duplicates = snapshot.vehicles.filter((vehicle) => normalizePlate(vehicle.plate) === normalizedPlate)
  if (duplicates.length < 2) {
    throw new Error(`Nessun duplicato da risolvere per ${normalizedPlate}.`)
  }

  const canonical = pickCanonicalVehicle(duplicates, snapshot)
  const consolidatedVehicleIds = duplicates.filter((vehicle) => vehicle.id !== canonical.id).map((vehicle) => vehicle.id)
  const relationsToTransfer = countRelationsForVehicleIds(snapshot, new Set(consolidatedVehicleIds))
  return {
    normalizedPlate,
    canonicalVehicleId: canonical.id,
    consolidatedVehicleIds,
    relationsToTransfer,
  }
}

export async function resolveDuplicatePlate(normalizedPlateInput: string): Promise<DuplicateResolutionResult> {
  if (!isAllowedPersistenceOrigin()) {
    throw new Error(`Operazione bloccata: origin non consentito (${currentOriginLabel()}). Apri il gestionale da ${EXPECTED_APP_ORIGIN}`)
  }

  const plan = await prepareDuplicateResolution(normalizedPlateInput)

  return withCrossTabSaveLock(async () => {
    const before = await readAuthoritativeSnapshot()
    const revisionBefore = Math.max(0, Number(before.dbRevision ?? 0))

    const duplicates = before.vehicles.filter((vehicle) => normalizePlate(vehicle.plate) === plan.normalizedPlate)
    const canonical = duplicates.find((vehicle) => vehicle.id === plan.canonicalVehicleId)
    if (!canonical) throw new Error('Record canonico non trovato nello snapshot corrente.')

    const duplicateIds = new Set(plan.consolidatedVehicleIds)
    let next = remapVehicleReferences(before, duplicateIds, canonical.id)
    const duplicateVehicles = duplicates.filter((vehicle) => duplicateIds.has(vehicle.id))
    const mergedCanonical = duplicateVehicles.reduce((current, duplicate) => mergeVehicleDetails(current, duplicate), canonical)

    next = {
      ...next,
      vehicles: next.vehicles
        .filter((vehicle) => !duplicateIds.has(vehicle.id))
        .map((vehicle) => vehicle.id === canonical.id ? mergedCanonical : vehicle),
      dbRevision: revisionBefore + 1,
      dbUpdatedAt: new Date().toISOString(),
    }

    const orphanAfterCandidate = buildOrphanReferences(next)
    if (orphanAfterCandidate.length > 0) {
      throw new Error(`Bonifica bloccata: riferimenti orfani rilevati (${orphanAfterCandidate.length}).`)
    }
    assertUniqueNormalizedPlates(next, 'bonifica duplicati')

    const backupKey = `backup:integrity:${new Date().toISOString()}`
    const database = await openDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite')
        const objectStore = transaction.objectStore(STORE)
        objectStore.put(before, backupKey)
        objectStore.put(next, STATE_KEY)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }

    const after = await readAuthoritativeSnapshot()
    const afterDuplicates = buildDuplicatePlateGroups(after)
    const afterOrphans = buildOrphanReferences(after)

    return {
      plan,
      backupKey,
      revisionBefore,
      revisionAfter: Math.max(0, Number(after.dbRevision ?? 0)),
      duplicateCountAfter: afterDuplicates.length,
      orphanCountAfter: afterOrphans.length,
    }
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, CURRENT_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function normalizeData(value: unknown): ErpData {
  if (!value || typeof value !== 'object') return structuredClone(emptyData)
  const candidate = value as Partial<ErpData>
  const customers = Array.isArray(candidate.customers) ? candidate.customers.map((customer) => ({ ...customer })) : []
  const rawVehicles = Array.isArray(candidate.vehicles) ? candidate.vehicles.map((vehicle) => ({ ...vehicle })) : []
  const sourceStandardWorks = Array.isArray(candidate.plannerSettings?.standardWorks)
    ? candidate.plannerSettings.standardWorks
    : structuredClone(defaultPlannerSettings.standardWorks ?? [])
  const workIdByName = new Map(sourceStandardWorks.map((work) => [String(work.name ?? '').trim().toLowerCase(), String(work.id ?? '').trim()] as const).filter(([name, id]) => Boolean(name) && Boolean(id)))
  const plannerSettings: PlannerSettings = {
    ...structuredClone(defaultPlannerSettings),
    ...(candidate.plannerSettings && typeof candidate.plannerSettings === 'object' ? candidate.plannerSettings : {}),
    operators: Array.isArray(candidate.plannerSettings?.operators)
      ? candidate.plannerSettings.operators.map((operator) => ({
          ...operator,
          skills: Array.isArray(operator.skills) ? operator.skills.map((skill) => String(skill).trim()).filter(Boolean) : [],
          weeklySchedule: normalizeWeeklyWorkSchedule(operator.weeklySchedule),
        }))
      : [],
    standardWorks: sourceStandardWorks.map((item) => {
          const calculationType: 'per-vehicle' | 'per-panel' = item.calculationType === 'per-panel' ? 'per-panel' : 'per-vehicle'
          return {
            id: String(item.id ?? crypto.randomUUID()),
            name: String(item.name ?? '').trim(),
            calculationType,
            standardMinutes: Math.max(0, Number(item.standardMinutes ?? 0)),
            technicalWaitMinutes: Math.max(0, Number(item.technicalWaitMinutes ?? 0)),
            technicalWaitBlocksPhaseNames: Array.isArray(item.technicalWaitBlocksPhaseNames) ? item.technicalWaitBlocksPhaseNames.map((name) => String(name).trim()).filter(Boolean) : [],
            categoryOrPhase: String(item.categoryOrPhase ?? '').trim(),
            rules: Array.isArray(item.rules)
              ? item.rules.map((rule) => {
                  const vehicleSizeClass: '' | 'piccola' | 'media' | 'grande' = rule.conditions?.vehicleSizeClass === 'piccola' || rule.conditions?.vehicleSizeClass === 'media' || rule.conditions?.vehicleSizeClass === 'grande'
                    ? rule.conditions.vehicleSizeClass
                    : ''
                  return {
                    id: String(rule.id ?? crypto.randomUUID()),
                    name: String(rule.name ?? '').trim(),
                    minutes: Math.max(1, Number(rule.minutes ?? item.standardMinutes ?? 1)),
                    priority: Number(rule.priority ?? 0),
                    active: Boolean(rule.active),
                    conditions: {
                      vehicleSizeClass,
                      colorFamily: String(rule.conditions?.colorFamily ?? '').trim(),
                      paintCycle: String(rule.conditions?.paintCycle ?? '').trim(),
                      minPanels: rule.conditions?.minPanels == null ? null : Number(rule.conditions.minPanels),
                      maxPanels: rule.conditions?.maxPanels == null ? null : Number(rule.conditions.maxPanels),
                      attributes: rule.conditions?.attributes && typeof rule.conditions.attributes === 'object'
                        ? Object.fromEntries(Object.entries(rule.conditions.attributes).map(([key, value]) => [String(key).trim(), String(value).trim()]).filter(([key, value]) => key && value))
                        : {},
                    },
                  }
                }).filter((rule) => Boolean(rule.name))
              : [],
            active: Boolean(item.active),
            requiredSkill: String(item.requiredSkill ?? '').trim(),
            cycleOrder: Number(item.cycleOrder ?? 999),
          }
        }),
    standardWorkRuleHistory: Array.isArray(candidate.plannerSettings?.standardWorkRuleHistory)
      ? candidate.plannerSettings.standardWorkRuleHistory.map((entry) => ({
          id: String(entry.id ?? crypto.randomUUID()),
          at: String(entry.at ?? new Date().toISOString()),
          workId: String(entry.workId ?? ''),
          workName: String(entry.workName ?? '').trim(),
          ruleId: String(entry.ruleId ?? ''),
          action: entry.action === 'create' || entry.action === 'update' || entry.action === 'duplicate' || entry.action === 'deactivate' || entry.action === 'delete'
            ? entry.action
            : 'update',
          snapshot: {
            id: String(entry.snapshot?.id ?? crypto.randomUUID()),
            name: String(entry.snapshot?.name ?? '').trim(),
            minutes: Math.max(1, Number(entry.snapshot?.minutes ?? 1)),
            priority: Number(entry.snapshot?.priority ?? 0),
            active: Boolean(entry.snapshot?.active),
            conditions: {
              vehicleSizeClass: (entry.snapshot?.conditions?.vehicleSizeClass === 'piccola' || entry.snapshot?.conditions?.vehicleSizeClass === 'media' || entry.snapshot?.conditions?.vehicleSizeClass === 'grande'
                ? entry.snapshot.conditions.vehicleSizeClass
                : '') as '' | 'piccola' | 'media' | 'grande',
              colorFamily: String(entry.snapshot?.conditions?.colorFamily ?? '').trim(),
              paintCycle: String(entry.snapshot?.conditions?.paintCycle ?? '').trim(),
              minPanels: entry.snapshot?.conditions?.minPanels == null ? null : Number(entry.snapshot.conditions.minPanels),
              maxPanels: entry.snapshot?.conditions?.maxPanels == null ? null : Number(entry.snapshot.conditions.maxPanels),
              attributes: entry.snapshot?.conditions?.attributes && typeof entry.snapshot.conditions.attributes === 'object'
                ? Object.fromEntries(Object.entries(entry.snapshot.conditions.attributes).map(([key, value]) => [String(key).trim(), String(value).trim()]).filter(([key, value]) => key && value))
                : {},
            },
          },
        }))
      : [],
    standardWorkPriceList: Array.isArray(candidate.plannerSettings?.standardWorkPriceList)
      ? candidate.plannerSettings.standardWorkPriceList.map((item) => {
          const repairExtent: '' | 'intero' | 'mezzo' = item.repairExtent === 'mezzo' || item.repairExtent === 'intero'
            ? item.repairExtent
            : ''
          const workName = String(item.workName ?? '').trim()
          return {
            id: String(item.id ?? crypto.randomUUID()),
            panelName: String(item.panelName ?? '').trim(),
            workId: String(item.workId ?? '').trim() || workIdByName.get(workName.toLowerCase()),
            workName,
            repairExtent,
            variantCycle: String(item.variantCycle ?? '').trim(),
            vatRate: Math.max(0, Number(item.vatRate ?? 22)),
            unitPrice: Math.max(0, Number(item.unitPrice ?? 0)),
            active: Boolean(item.active),
            note: String(item.note ?? '').trim(),
          }
        }).filter((item) => Boolean(item.workName))
      : [],
    standardWorkPriceHistory: Array.isArray(candidate.plannerSettings?.standardWorkPriceHistory)
      ? candidate.plannerSettings.standardWorkPriceHistory.map((entry) => {
          const previousRepairExtent: '' | 'intero' | 'mezzo' = entry.previousValue?.repairExtent === 'mezzo' || entry.previousValue?.repairExtent === 'intero'
            ? entry.previousValue.repairExtent
            : ''
          const newRepairExtent: '' | 'intero' | 'mezzo' = entry.newValue?.repairExtent === 'mezzo' || entry.newValue?.repairExtent === 'intero'
            ? entry.newValue.repairExtent
            : ''
          return {
            id: String(entry.id ?? crypto.randomUUID()),
            at: String(entry.at ?? new Date().toISOString()),
            itemId: String(entry.itemId ?? ''),
            previousValue: {
              id: String(entry.previousValue?.id ?? crypto.randomUUID()),
              panelName: String(entry.previousValue?.panelName ?? '').trim(),
              workName: String(entry.previousValue?.workName ?? '').trim(),
              repairExtent: previousRepairExtent,
              variantCycle: String(entry.previousValue?.variantCycle ?? '').trim(),
              vatRate: Math.max(0, Number(entry.previousValue?.vatRate ?? 22)),
              unitPrice: Math.max(0, Number(entry.previousValue?.unitPrice ?? 0)),
              active: Boolean(entry.previousValue?.active),
              note: String(entry.previousValue?.note ?? '').trim(),
            },
            newValue: {
              id: String(entry.newValue?.id ?? crypto.randomUUID()),
              panelName: String(entry.newValue?.panelName ?? '').trim(),
              workName: String(entry.newValue?.workName ?? '').trim(),
              repairExtent: newRepairExtent,
              variantCycle: String(entry.newValue?.variantCycle ?? '').trim(),
              vatRate: Math.max(0, Number(entry.newValue?.vatRate ?? 22)),
              unitPrice: Math.max(0, Number(entry.newValue?.unitPrice ?? 0)),
              active: Boolean(entry.newValue?.active),
              note: String(entry.newValue?.note ?? '').trim(),
            },
          }
        })
      : [],
    monthlyGoalHistory: Array.isArray(candidate.plannerSettings?.monthlyGoalHistory)
      ? candidate.plannerSettings.monthlyGoalHistory.map((entry) => ({ ...entry }))
      : [],
    weeklyWorkSchedule: normalizeWeeklyWorkSchedule(candidate.plannerSettings?.weeklyWorkSchedule ?? defaultPlannerSettings.weeklyWorkSchedule ?? DEFAULT_WEEKLY_WORK_SCHEDULE),
    monthlyRevenueGoalMode: candidate.plannerSettings?.monthlyRevenueGoalMode ?? 'automatic',
    monthlyRevenueGoalSuggested: Number(candidate.plannerSettings?.monthlyRevenueGoalSuggested ?? candidate.plannerSettings?.monthlyRevenueGoal ?? 0),
    monthlyRevenueGoalManual: candidate.plannerSettings?.monthlyRevenueGoalManual ?? null,
    ownerWithdrawalAmount: Number(candidate.plannerSettings?.ownerWithdrawalAmount ?? defaultPlannerSettings.ownerWithdrawalAmount),
    ownerWithdrawalPlannedDate: String(candidate.plannerSettings?.ownerWithdrawalPlannedDate ?? defaultPlannerSettings.ownerWithdrawalPlannedDate),
    ownerWithdrawalSettledMonthKey: candidate.plannerSettings?.ownerWithdrawalSettledMonthKey ?? null,
    ownerWithdrawalSettledAt: candidate.plannerSettings?.ownerWithdrawalSettledAt ?? null,
    economicSafetyMarginPercent: Number(candidate.plannerSettings?.economicSafetyMarginPercent ?? defaultPlannerSettings.economicSafetyMarginPercent),
    phaseTrackingMetric: (candidate.plannerSettings?.phaseTrackingMetric === 'man-hours' ? 'man-hours' : 'calendar') as 'calendar' | 'man-hours',
    deliveryBufferMode: candidate.plannerSettings?.deliveryBufferMode === 'hours' ? 'hours' : 'percent',
    deliveryBufferValue: Math.max(0, Number(candidate.plannerSettings?.deliveryBufferValue ?? defaultPlannerSettings.deliveryBufferValue ?? 10)),
    vehicleStatuses: normalizeVehicleStatuses({
      ...structuredClone(defaultPlannerSettings),
      ...(candidate.plannerSettings && typeof candidate.plannerSettings === 'object' ? candidate.plannerSettings : {}),
    }),
    defaultVehicleStatus: String(candidate.plannerSettings?.defaultVehicleStatus ?? defaultPlannerSettings.defaultVehicleStatus ?? 'accettata'),
    companyClosures: Array.isArray(candidate.plannerSettings?.companyClosures)
      ? candidate.plannerSettings.companyClosures.map((entry) => ({
          id: String(entry.id ?? crypto.randomUUID()),
          type: entry.type === 'festivita' || entry.type === 'ferie' || entry.type === 'chiusura-straordinaria' || entry.type === 'mezza-giornata' || entry.type === 'indisponibilita' ? entry.type : 'chiusura-straordinaria',
          startDate: String(entry.startDate ?? '').trim(),
          endDate: String(entry.endDate ?? entry.startDate ?? '').trim(),
          startTime: String(entry.startTime ?? '').trim() || undefined,
          endTime: String(entry.endTime ?? '').trim() || undefined,
          note: String(entry.note ?? '').trim(),
        })).filter((entry) => Boolean(entry.startDate) && Boolean(entry.endDate))
      : [],
  }
  plannerSettings.defaultVehicleStatus = resolveVehicleStatusId(plannerSettings, plannerSettings.defaultVehicleStatus || defaultVehicleStatus(plannerSettings))
  const vehicles: ErpData['vehicles'] = rawVehicles.map((vehicle): ErpData['vehicles'][number] => {
    const status = resolveVehicleStatusId(plannerSettings, vehicle.status || plannerSettings.defaultVehicleStatus || defaultVehicleStatus(plannerSettings))
    const statusHistory = Array.isArray(vehicle.statusHistory)
      ? vehicle.statusHistory.map((entry) => ({
          ...entry,
          from: resolveVehicleStatusId(plannerSettings, entry.from || plannerSettings.defaultVehicleStatus),
          to: resolveVehicleStatusId(plannerSettings, entry.to || plannerSettings.defaultVehicleStatus),
          source: (entry.source === 'automatic' ? 'automatic' : 'manual') as 'manual' | 'automatic',
        }))
      : []
    return {
      ...vehicle,
      plate: normalizePlate(vehicle.plate),
      vin: normalizeVin(String(vehicle.vin ?? '')),
      status,
      statusMode: (vehicle.statusMode === 'manual' ? 'manual' : 'automatic') as 'manual' | 'automatic',
      suggestedStatus: vehicle.suggestedStatus ? resolveVehicleStatusId(plannerSettings, vehicle.suggestedStatus) : null,
      statusHistory,
    }
  })
  const coneHistory = Array.isArray(candidate.coneHistory)
    ? candidate.coneHistory.map((entry) => ({
        ...entry,
        vehiclePlate: entry.vehiclePlate || vehicles.find((vehicle) => vehicle.id === entry.vehicleId)?.plate || 'Vettura rimossa',
      }))
    : []
  const plannerAssignments = Array.isArray(candidate.plannerAssignments) ? candidate.plannerAssignments.map((entry) => ({ ...entry })) : []
  const historyByWorkId = new Map((plannerSettings.standardWorkRuleHistory ?? [])
    .filter((entry) => entry.workId && entry.workName)
    .map((entry) => [entry.workId, entry.workName.trim()]))
  plannerSettings.standardWorks = (plannerSettings.standardWorks ?? []).map((work) => {
    if (work.name.trim()) return work
    const recoveredName = historyByWorkId.get(work.id)
    return recoveredName ? { ...work, name: recoveredName } : work
  })
  const hasLucidatura = (plannerSettings.standardWorks ?? []).some((work) => work.name.trim().toLowerCase() === 'lucidatura')
  if (!hasLucidatura) {
    const fromHistory = (plannerSettings.standardWorkRuleHistory ?? [])
      .find((entry) => entry.workName.trim().toLowerCase() === 'lucidatura')
    if (fromHistory && !(plannerSettings.standardWorks ?? []).some((work) => work.id === fromHistory.workId)) {
      plannerSettings.standardWorks = [
        ...(plannerSettings.standardWorks ?? []),
        {
          id: fromHistory.workId,
          name: fromHistory.workName.trim() || 'Lucidatura',
          calculationType: 'per-vehicle',
          standardMinutes: Math.max(1, Number(fromHistory.snapshot.minutes ?? 90)),
          categoryOrPhase: 'Lucidatura',
          rules: [structuredClone(fromHistory.snapshot)],
          active: true,
          requiredSkill: 'lucidatura',
          cycleOrder: 70,
        },
      ]
    }
  }
  const invoices = Array.isArray(candidate.invoices) ? candidate.invoices.map((invoice) => ({ ...invoice })) : []
  const bankAccounts = Array.isArray(candidate.bankAccounts) ? candidate.bankAccounts.map((item) => ({ ...item })) : []
  const ribaBatches = Array.isArray(candidate.ribaBatches) ? candidate.ribaBatches.map((item) => ({ ...item })) : []
  const financialEvents = Array.isArray(candidate.financialEvents) ? candidate.financialEvents.map((item) => ({ ...item })) : []
  const payables = Array.isArray(candidate.payables)
    ? candidate.payables.map((item) => ({
        ...item,
        vatDeductibilityMode: item.vatDeductibilityMode ?? 'full',
        vatDeductibilityPercent: item.vatDeductibilityMode === 'none'
          ? 0
          : item.vatDeductibilityMode === 'partial'
            ? Number(item.vatDeductibilityPercent ?? 0)
            : Number(item.vatDeductibilityPercent ?? 100),
        installments: Array.isArray(item.installments) ? item.installments.map((installment) => ({ ...installment })) : [],
      }))
    : []
  const vatQuarterlyRecords = Array.isArray(candidate.vatQuarterlyRecords)
    ? candidate.vatQuarterlyRecords.map((record) => ({
        quarterKey: String(record.quarterKey ?? ''),
        status: record.status ?? 'In corso',
        confirmedAmount: record.confirmedAmount == null ? null : Number(record.confirmedAmount),
        confirmedAt: record.confirmedAt ?? null,
        accountantNote: record.accountantNote ?? '',
        linkedPayableId: record.linkedPayableId ?? null,
        dueDate: record.dueDate,
        adjustments: Array.isArray(record.adjustments)
          ? record.adjustments.map((adjustment) => ({
              ...adjustment,
              amount: Number(adjustment.amount ?? 0),
            }))
          : [],
      })).filter((record) => record.quarterKey)
    : []
  const quotes = Array.isArray(candidate.quotes) ? candidate.quotes.map((item) => ({ ...item, lines: Array.isArray(item.lines) ? item.lines.map((line) => ({ ...line })) : [] })) : []
  const communications = Array.isArray(candidate.communications) ? candidate.communications.map((item) => ({ ...item })) : []
  const documentCounters = {
    quote: Number(candidate.documentCounters?.quote ?? 0),
    invoice: Number(candidate.documentCounters?.invoice ?? 0),
  }
  const companyProfile = {
    ...structuredClone(emptyData.companyProfile),
    ...(candidate.companyProfile && typeof candidate.companyProfile === 'object' ? candidate.companyProfile : {}),
  } as ErpData['companyProfile']
  const production = {
    ...structuredClone(emptyData.production),
    ...(candidate.production && typeof candidate.production === 'object' ? candidate.production : {}),
    jobs: Array.isArray(candidate.production?.jobs) ? candidate.production.jobs.map((item) => ({ ...item, assignedWorks: Array.isArray(item.assignedWorks) ? [...item.assignedWorks] : [] })) : [],
    phaseHistory: Array.isArray(candidate.production?.phaseHistory) ? candidate.production.phaseHistory.map((item) => ({ ...item })) : [],
    workLogs: Array.isArray(candidate.production?.workLogs) ? candidate.production.workLogs.map((item) => ({ ...item })) : [],
    reports: Array.isArray(candidate.production?.reports) ? candidate.production.reports.map((item) => ({ ...item })) : [],
    paceStates: Array.isArray(candidate.production?.paceStates) ? candidate.production.paceStates.map((item) => ({ ...item, operators: Array.isArray(item.operators) ? item.operators.map((name) => String(name)) : [] })) : [],
    paceHistory: Array.isArray(candidate.production?.paceHistory) ? candidate.production.paceHistory.map((item) => ({ ...item, operators: Array.isArray(item.operators) ? item.operators.map((name) => String(name)) : [] })) : [],
    identities: Array.isArray(candidate.production?.identities) ? candidate.production.identities.map((item) => ({ ...item })) : structuredClone(emptyData.production?.identities ?? []),
  } as ErpData['production']
  const financeSettings = {
    ...structuredClone(emptyData.financeSettings),
    ...(candidate.financeSettings && typeof candidate.financeSettings === 'object' ? candidate.financeSettings : {}),
    marginThresholds: {
      ...structuredClone(emptyData.financeSettings.marginThresholds),
      ...(candidate.financeSettings && typeof candidate.financeSettings === 'object' && candidate.financeSettings.marginThresholds && typeof candidate.financeSettings.marginThresholds === 'object' ? candidate.financeSettings.marginThresholds : {}),
    },
  } as ErpData['financeSettings']
  const estimates = Array.isArray(candidate.estimates)
    ? candidate.estimates.map((item) => ({
        ...item,
        convertedJobId: item.convertedJobId ?? null,
        lines: Array.isArray(item.lines) ? item.lines.map((line) => {
          const calculationType: 'per-vehicle' | 'per-panel' = line.calculationType === 'per-panel' ? 'per-panel' : 'per-vehicle'
          const vehicleSizeClass: '' | 'piccola' | 'media' | 'grande' = line.vehicleSizeClass === 'piccola' || line.vehicleSizeClass === 'media' || line.vehicleSizeClass === 'grande' ? line.vehicleSizeClass : ''
          const panelSide: '' | 'sx' | 'dx' | 'center' = line.panelSide === 'sx' || line.panelSide === 'dx' || line.panelSide === 'center' ? line.panelSide : ''
          const repairExtent: 'intero' | 'mezzo' = line.repairExtent === 'mezzo' ? 'mezzo' : 'intero'
          return {
            ...line,
            panelId: String(line.panelId ?? '').trim(),
            panelName: String(line.panelName ?? '').trim(),
            panelSide,
            repairExtent,
            panelWorkNote: String(line.panelWorkNote ?? '').trim(),
            vehicleSizeClass,
            colorFamily: String(line.colorFamily ?? '').trim(),
            paintCycle: String(line.paintCycle ?? '').trim(),
            standardWorkId: String(line.standardWorkId ?? '').trim(),
            standardWorkName: String(line.standardWorkName ?? line.description ?? '').trim(),
            categoryOrPhase: String(line.categoryOrPhase ?? '').trim(),
            calculationType,
            standardMinutes: Number(line.standardMinutes ?? 0),
            estimatedMinutes: Number(line.estimatedMinutes ?? line.standardMinutes ?? 0),
            lineTotalMinutes: Number(line.lineTotalMinutes ?? line.estimatedMinutes ?? line.standardMinutes ?? 0),
            manualTimeOverride: Boolean(line.manualTimeOverride),
            appliedRuleId: String(line.appliedRuleId ?? '').trim(),
            appliedRuleName: String(line.appliedRuleName ?? '').trim(),
            appliedRuleSummary: String(line.appliedRuleSummary ?? '').trim(),
            requiredSkill: String(line.requiredSkill ?? '').trim(),
            cycleOrder: Number(line.cycleOrder ?? 999),
            technicalWaitMinutes: Math.max(0, Number(line.technicalWaitMinutes ?? 0)),
            technicalWaitBlocksPhaseNames: Array.isArray(line.technicalWaitBlocksPhaseNames) ? line.technicalWaitBlocksPhaseNames.map((name) => String(name).trim()).filter(Boolean) : [],
          }
        }) : [],
        history: Array.isArray(item.history) ? item.history.map((entry) => ({ ...entry })) : [],
      }))
    : []
  const jobs = Array.isArray(candidate.jobs)
    ? candidate.jobs.map((item) => ({
        ...item,
        estimateId: item.estimateId ?? null,
        coneNumber: item.coneNumber ?? null,
        lines: Array.isArray(item.lines) ? item.lines.map((line) => {
          const calculationType: 'per-vehicle' | 'per-panel' = line.calculationType === 'per-panel' ? 'per-panel' : 'per-vehicle'
          const vehicleSizeClass: '' | 'piccola' | 'media' | 'grande' = line.vehicleSizeClass === 'piccola' || line.vehicleSizeClass === 'media' || line.vehicleSizeClass === 'grande' ? line.vehicleSizeClass : ''
          const panelSide: '' | 'sx' | 'dx' | 'center' = line.panelSide === 'sx' || line.panelSide === 'dx' || line.panelSide === 'center' ? line.panelSide : ''
          const repairExtent: 'intero' | 'mezzo' = line.repairExtent === 'mezzo' ? 'mezzo' : 'intero'
          return {
            ...line,
            panelId: String(line.panelId ?? '').trim(),
            panelName: String(line.panelName ?? '').trim(),
            panelSide,
            repairExtent,
            panelWorkNote: String(line.panelWorkNote ?? '').trim(),
            vehicleSizeClass,
            colorFamily: String(line.colorFamily ?? '').trim(),
            paintCycle: String(line.paintCycle ?? '').trim(),
            standardWorkId: String(line.standardWorkId ?? '').trim(),
            standardWorkName: String(line.standardWorkName ?? line.description ?? '').trim(),
            categoryOrPhase: String(line.categoryOrPhase ?? '').trim(),
            calculationType,
            standardMinutes: Number(line.standardMinutes ?? 0),
            estimatedMinutes: Number(line.estimatedMinutes ?? line.standardMinutes ?? 0),
            lineTotalMinutes: Number(line.lineTotalMinutes ?? line.estimatedMinutes ?? line.standardMinutes ?? 0),
            manualTimeOverride: Boolean(line.manualTimeOverride),
            appliedRuleId: String(line.appliedRuleId ?? '').trim(),
            appliedRuleName: String(line.appliedRuleName ?? '').trim(),
            appliedRuleSummary: String(line.appliedRuleSummary ?? '').trim(),
            requiredSkill: String(line.requiredSkill ?? '').trim(),
            cycleOrder: Number(line.cycleOrder ?? 999),
            technicalWaitMinutes: Math.max(0, Number(line.technicalWaitMinutes ?? 0)),
            technicalWaitBlocksPhaseNames: Array.isArray(line.technicalWaitBlocksPhaseNames) ? line.technicalWaitBlocksPhaseNames.map((name) => String(name).trim()).filter(Boolean) : [],
          }
        }) : [],
        phases: Array.isArray(item.phases)
          ? item.phases.map((phase) => {
              const operatorAssignments: JobPhaseOperatorAssignment[] = Array.isArray(phase.operatorAssignments)
                ? phase.operatorAssignments
                    .map((entry): JobPhaseOperatorAssignment => ({
                      id: entry.id ?? crypto.randomUUID(),
                      operatorName: String(entry.operatorName ?? '').trim(),
                      startedAt: entry.startedAt ?? phase.startedAt ?? item.updatedAt ?? new Date().toISOString(),
                      endedAt: entry.endedAt ?? undefined,
                      workedMinutes: Number(entry.workedMinutes ?? 0),
                      activityStatus: entry.activityStatus === 'Attivo' || entry.activityStatus === 'Concluso' || entry.activityStatus === 'Rimosso'
                        ? entry.activityStatus
                        : (entry.endedAt ? 'Concluso' : 'Attivo'),
                    }))
                    .filter((entry) => Boolean(entry.operatorName))
                : (phase.operatorName
                    ? [{
                        id: crypto.randomUUID(),
                        operatorName: String(phase.operatorName).trim(),
                        startedAt: phase.startedAt ?? item.updatedAt ?? new Date().toISOString(),
                        endedAt: phase.endedAt ?? undefined,
                        workedMinutes: Number(phase.actualMinutes ?? 0),
                        activityStatus: (phase.endedAt ? 'Concluso' : 'Attivo') as 'Concluso' | 'Attivo',
                      }]
                    : [])
              return {
                ...phase,
                notRequired: Boolean(phase.notRequired),
                cycleOrder: Number(phase.cycleOrder ?? 999),
                requiredSkill: String(phase.requiredSkill ?? '').trim(),
                technicalWaitMinutes: Math.max(0, Number(phase.technicalWaitMinutes ?? 0)),
                technicalWaitBlocksPhaseNames: Array.isArray(phase.technicalWaitBlocksPhaseNames) ? phase.technicalWaitBlocksPhaseNames.map((name) => String(name).trim()).filter(Boolean) : [],
                operatorName: typeof phase.operatorName === 'string' ? phase.operatorName : '',
                operatorAssignments,
                timeAdjustments: Array.isArray(phase.timeAdjustments)
                  ? phase.timeAdjustments.map((entry) => ({
                      id: String(entry.id ?? crypto.randomUUID()),
                      at: String(entry.at ?? new Date().toISOString()),
                      reason: String(entry.reason ?? '').trim(),
                      fromMinutes: Number(entry.fromMinutes ?? phase.estimatedMinutes ?? 0),
                      toMinutes: Number(entry.toMinutes ?? phase.estimatedMinutes ?? 0),
                    }))
                  : [],
              }
            })
          : [],
        qualityChecklist: Array.isArray(item.qualityChecklist) ? item.qualityChecklist.map((row) => ({ ...row })) : [],
        blocks: Array.isArray(item.blocks) ? [...item.blocks] : [],
        history: Array.isArray(item.history) ? item.history.map((entry) => ({ ...entry })) : [],
      }))
    : []
  const workflowCounters = {
    estimate: Number(candidate.workflowCounters?.estimate ?? 0),
    job: Number(candidate.workflowCounters?.job ?? 0),
  }
  const qualityChecklistTemplates = Array.isArray(candidate.qualityChecklistTemplates)
    ? candidate.qualityChecklistTemplates.map((label) => String(label).trim()).filter(Boolean)
    : []
  const operatorPrograms = Array.isArray(candidate.operatorPrograms)
    ? candidate.operatorPrograms.map((program) => ({
        ...program,
        tasks: Array.isArray(program.tasks) ? program.tasks.map((task) => ({ ...task })) : [],
        summary: program.summary ? { ...program.summary } : undefined,
      }))
    : []
  const operatorProgramHistory = Array.isArray(candidate.operatorProgramHistory)
    ? candidate.operatorProgramHistory.map((entry) => ({
        ...entry,
        previousPrograms: Array.isArray(entry.previousPrograms)
          ? entry.previousPrograms.map((program) => ({
              ...program,
              tasks: Array.isArray(program.tasks) ? program.tasks.map((task) => ({ ...task })) : [],
              summary: program.summary ? { ...program.summary } : undefined,
            }))
          : [],
        programs: Array.isArray(entry.programs)
          ? entry.programs.map((program) => ({
              ...program,
              tasks: Array.isArray(program.tasks) ? program.tasks.map((task) => ({ ...task })) : [],
              summary: program.summary ? { ...program.summary } : undefined,
            }))
          : [],
      }))
    : []
  const operatorProgramRevision = Number(candidate.operatorProgramRevision ?? 0)
  const dbRevision = Math.max(0, Number(candidate.dbRevision ?? 0))
  const dbUpdatedAt = String(candidate.dbUpdatedAt ?? '')
  const normalized: ErpData = {
    customers,
    vehicles,
    coneHistory,
    plannerSettings,
    plannerAssignments,
    invoices,
    bankAccounts,
    ribaBatches,
    financialEvents,
    payables,
    vatQuarterlyRecords,
    quotes,
    communications,
    documentCounters,
    companyProfile,
    production,
    estimates,
    jobs,
    workflowCounters,
    qualityChecklistTemplates,
    operatorPrograms,
    operatorProgramHistory,
    operatorProgramRevision,
    dbRevision,
    dbUpdatedAt,
    financeSettings,
  }
  if (Array.isArray(candidate.acceptances)) normalized.acceptances = candidate.acceptances.map((item) => ({ ...item, quote: item.quote ? { ...item.quote, lines: item.quote.lines.map((line) => ({ ...line })) } : item.quote }))
  return normalized
}

async function readCurrentPersistedSnapshot(): Promise<ErpData | null> {
  try {
    const database = await openDatabase()
    const stored = await new Promise<ErpData | undefined>((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(STATE_KEY)
      request.onsuccess = () => resolve(request.result as ErpData | undefined)
      request.onerror = () => reject(request.error)
    })
    database.close()
    if (stored) return normalizeData(stored)
  } catch {
    // Fall back to legacy storage read below.
  }

  const fallback = readFallback()
  if (!fallback) return null
  try {
    return normalizeData(JSON.parse(fallback))
  } catch {
    return null
  }
}

export async function loadDatabase(): Promise<ErpData> {
  try {
    const database = await openDatabase()
    const stored = await new Promise<ErpData | undefined>((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(STATE_KEY)
      request.onsuccess = () => resolve(request.result as ErpData | undefined)
      request.onerror = () => reject(request.error)
    })
    database.close()
    if (stored) return normalizeData(stored)

    const legacy = readFallback()
    if (legacy) {
      const migrated = normalizeData(JSON.parse(legacy))
      await saveDatabase(migrated)
      localStorage.removeItem(STORAGE_KEY)
      return migrated
    }
    return normalizeData(emptyData)
  } catch {
    const fallback = readFallback()
    if (fallback) return normalizeData(JSON.parse(fallback))
    throw new Error('Impossibile caricare il database locale. Nessun fallback disponibile.')
  }
}

let saveQueue: Promise<void> = Promise.resolve()

async function persistDatabase(data: ErpData, options: SaveDatabaseOptions, sourceData?: ErpData): Promise<void> {
  if (!isAllowedPersistenceOrigin()) {
    throw new Error(`Salvataggio bloccato: origin non consentito (${currentOriginLabel()}). Apri il gestionale da ${EXPECTED_APP_ORIGIN}`)
  }

  return withCrossTabSaveLock(async () => {
    const latest = await readCurrentPersistedSnapshot()
    const currentRevision = Math.max(0, Number(latest?.dbRevision ?? 0))
    const incomingRevision = Math.max(0, Number(data.dbRevision ?? 0))
    let candidate = structuredClone(data)
    const revisionAwareSnapshot = incomingRevision > 0

    assertUniqueNormalizedPlates(candidate, 'snapshot candidato')
    if (latest) assertUniqueNormalizedPlates(latest, 'snapshot persistito')

    if (latest && revisionAwareSnapshot && incomingRevision < currentRevision) {
      if (options.mergeOnConflict === false) {
        throw new Error(
          `Salvataggio bloccato: conflitto revisione. source=snapshot/persistence/cross-tab; revPersistita=${currentRevision}; revRichiesta=${incomingRevision}.`,
        )
      }
      candidate = mergeForStaleSave(latest, candidate)
      assertUniqueNormalizedPlates(candidate, 'merge da stato obsoleto')
    }

    if (latest && revisionAwareSnapshot) {
      assertIntegrityReductionAllowed(latest, candidate, Boolean(options.allowCountReduction))
      assertPlateAvailability(latest, candidate)
    }

    candidate.dbRevision = Math.max(currentRevision, incomingRevision) + 1
    candidate.dbUpdatedAt = new Date().toISOString()

    try {
      const database = await openDatabase()
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite')
        transaction.objectStore(STORE).put(candidate, STATE_KEY)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      database.close()
      if (sourceData) {
        sourceData.dbRevision = candidate.dbRevision
        sourceData.dbUpdatedAt = candidate.dbUpdatedAt
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(REVISION_PING_KEY, JSON.stringify({ rev: candidate.dbRevision, at: candidate.dbUpdatedAt }))
      }
    } catch (error) {
      try {
        if (typeof localStorage === 'undefined') throw new Error('localStorage non disponibile')
        localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate))
        console.error('IndexedDB persistence failed, fallback localStorage used', error)
        if (sourceData) {
          sourceData.dbRevision = candidate.dbRevision
          sourceData.dbUpdatedAt = candidate.dbUpdatedAt
        }
        localStorage.setItem(REVISION_PING_KEY, JSON.stringify({ rev: candidate.dbRevision, at: candidate.dbUpdatedAt }))
      } catch (fallbackError) {
        console.error('Database persistence failed', error, fallbackError)
        throw new Error(
          fallbackError instanceof Error && fallbackError.message
            ? `Impossibile salvare i dati sul dispositivo. Dettaglio: ${fallbackError.message}`
            : 'Impossibile salvare i dati sul dispositivo.',
        )
      }
    }
  })
}

export function saveDatabase(data: ErpData, options: SaveDatabaseOptions = {}): Promise<void> {
  const snapshot = structuredClone(data)
  saveQueue = saveQueue.then(
    () => persistDatabase(snapshot, options, data),
    () => persistDatabase(snapshot, options, data),
  )
  return saveQueue
}
