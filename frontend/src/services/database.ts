import type { ErpData } from '../types'
import { emptyData, STORAGE_KEY } from './erp'

const DB_NAME = 'carrozzeria-elias-erp'
const STORE = 'erp-state'
const STATE_KEY = 'current'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadDatabase(): Promise<ErpData> {
  try {
    const database = await openDatabase()
    const stored = await new Promise<ErpData | undefined>((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(STATE_KEY)
      request.onsuccess = () => resolve(request.result as ErpData | undefined)
      request.onerror = () => reject(request.error)
    })
    if (stored) return stored

    const legacy = localStorage.getItem(STORAGE_KEY)
    if (legacy) {
      const migrated = JSON.parse(legacy) as ErpData
      await saveDatabase(migrated)
      localStorage.removeItem(STORAGE_KEY)
      return migrated
    }
    return emptyData
  } catch {
    const fallback = localStorage.getItem(STORAGE_KEY)
    return fallback ? JSON.parse(fallback) as ErpData : emptyData
  }
}

export async function saveDatabase(data: ErpData): Promise<void> {
  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(data, STATE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}
