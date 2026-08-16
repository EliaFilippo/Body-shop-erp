import type { ErpData } from '../types'
import { defaultPlannerSettings, emptyData, STORAGE_KEY } from './erp'

const DB_NAME = 'carrozzeria-elias-erp'
const STORE = 'erp-state'
const STATE_KEY = 'current'
const CURRENT_VERSION = 5

const readFallback = () => typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)

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
  const vehicles = Array.isArray(candidate.vehicles) ? candidate.vehicles.map((vehicle) => ({ ...vehicle })) : []
  const coneHistory = Array.isArray(candidate.coneHistory)
    ? candidate.coneHistory.map((entry) => ({
        ...entry,
        vehiclePlate: entry.vehiclePlate || vehicles.find((vehicle) => vehicle.id === entry.vehicleId)?.plate || 'Vettura rimossa',
      }))
    : []
  const plannerSettings = {
    ...structuredClone(defaultPlannerSettings),
    ...(candidate.plannerSettings && typeof candidate.plannerSettings === 'object' ? candidate.plannerSettings : {}),
    monthlyGoalHistory: Array.isArray(candidate.plannerSettings?.monthlyGoalHistory)
      ? candidate.plannerSettings.monthlyGoalHistory.map((entry) => ({ ...entry }))
      : [],
    monthlyRevenueGoalMode: candidate.plannerSettings?.monthlyRevenueGoalMode ?? 'automatic',
    monthlyRevenueGoalSuggested: Number(candidate.plannerSettings?.monthlyRevenueGoalSuggested ?? candidate.plannerSettings?.monthlyRevenueGoal ?? 0),
    monthlyRevenueGoalManual: candidate.plannerSettings?.monthlyRevenueGoalManual ?? null,
    ownerWithdrawalAmount: Number(candidate.plannerSettings?.ownerWithdrawalAmount ?? defaultPlannerSettings.ownerWithdrawalAmount),
    ownerWithdrawalPlannedDate: String(candidate.plannerSettings?.ownerWithdrawalPlannedDate ?? defaultPlannerSettings.ownerWithdrawalPlannedDate),
    ownerWithdrawalSettledMonthKey: candidate.plannerSettings?.ownerWithdrawalSettledMonthKey ?? null,
    ownerWithdrawalSettledAt: candidate.plannerSettings?.ownerWithdrawalSettledAt ?? null,
    economicSafetyMarginPercent: Number(candidate.plannerSettings?.economicSafetyMarginPercent ?? defaultPlannerSettings.economicSafetyMarginPercent),
  }
  const plannerAssignments = Array.isArray(candidate.plannerAssignments) ? candidate.plannerAssignments.map((entry) => ({ ...entry })) : []
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
    financeSettings,
  }
  if (Array.isArray(candidate.acceptances)) normalized.acceptances = candidate.acceptances.map((item) => ({ ...item, quote: item.quote ? { ...item.quote, lines: item.quote.lines.map((line) => ({ ...line })) } : item.quote }))
  return normalized
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
