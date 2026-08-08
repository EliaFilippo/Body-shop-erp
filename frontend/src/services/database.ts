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
    return structuredClone(emptyData)
  } catch {
    const fallback = readFallback()
    return fallback ? normalizeData(JSON.parse(fallback)) : structuredClone(emptyData)
  }
}

let saveQueue: Promise<void> = Promise.resolve()

async function persistDatabase(data: ErpData): Promise<void> {
  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(data, STATE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  } catch {
    try {
      if (typeof localStorage === 'undefined') throw new Error()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      throw new Error('Impossibile salvare i dati sul dispositivo.')
    }
  }
}

export function saveDatabase(data: ErpData): Promise<void> {
  const snapshot = structuredClone(data)
  saveQueue = saveQueue.then(() => persistDatabase(snapshot))
  return saveQueue
}
