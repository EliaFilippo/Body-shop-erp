import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ErpData } from '../types'
import { loadDatabase, saveDatabase } from './database'
import { defaultPlannerSettings, emptyData } from './erp'

const data: ErpData = {
  customers: [{
    id: 'customer-1', type: 'Privato', name: 'Cliente reale', phone: '123',
    email: '', taxId: '', address: '', createdAt: '2026-07-26T00:00:00.000Z',
  }],
  vehicles: [],
  coneHistory: [],
  plannerSettings: { ...structuredClone(defaultPlannerSettings), monthlyRevenueGoal: 45000 },
  plannerAssignments: [],
  invoices: [],
  bankAccounts: [],
  ribaBatches: [],
  financialEvents: [],
  quotes: [],
  communications: [],
  documentCounters: { quote: 0, invoice: 0 },
  companyProfile: {
    name: 'ELIAS BODY SHOP',
    vatId: '',
    taxCode: '',
    address: '',
    phone: '',
    email: '',
    logoText: 'ELIAS',
  },
  financeSettings: structuredClone(emptyData.financeSettings),
}

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('carrozzeria-elias-erp')
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
  })
})

describe('database persistente', () => {
  it('salva e ricarica lo stato completo da IndexedDB', async () => {
    await saveDatabase(data)
    await expect(loadDatabase()).resolves.toEqual(data)
  })

  it('inizializza un database vuoto senza dati dimostrativi', async () => {
    await expect(loadDatabase()).resolves.toEqual(emptyData)
  })

  it('migra i dati Sprint 1 aggiungendo impostazioni e campi Planner senza perdere anagrafiche', async () => {
    const legacy = { customers: data.customers, vehicles: [], coneHistory: [] }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('carrozzeria-elias-erp', 2)
      request.onupgradeneeded = () => request.result.createObjectStore('erp-state')
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('erp-state', 'readwrite')
        transaction.objectStore('erp-state').put(legacy, 'current')
        transaction.oncomplete = () => { database.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
      request.onerror = () => reject(request.error)
    })
    const migrated = await loadDatabase()
    expect(migrated.customers[0].name).toBe('Cliente reale')
    expect(migrated.plannerSettings.workingDays).toEqual([1, 2, 3, 4, 5])
    expect(migrated.plannerAssignments).toEqual([])
  })
})
