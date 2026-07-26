import type { ErpData } from '../types'
import { emptyData, STORAGE_KEY } from './erp'

const DB_NAME = 'carrozzeria-elias-erp'
const STORE = 'erp-state'
const STATE_KEY = 'current'
const CURRENT_VERSION = 2

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
  const customers = Array.isArray(candidate.customers) ? candidate.customers : []
  const vehicles = Array.isArray(candidate.vehicles) ? candidate.vehicles : []
  const coneHistory = Array.isArray(candidate.coneHistory)
    ? candidate.coneHistory.map((entry) => ({
        ...entry,
        vehiclePlate: entry.vehiclePlate
          || vehicles.find((vehicle) => vehicle.id === entry.vehicleId)?.plate
          || 'Vettura rimossa',
      }))
    : []
  return { customers, vehicles, coneHistory }
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
