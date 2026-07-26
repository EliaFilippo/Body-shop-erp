import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ErpData } from '../types'
import { loadDatabase, saveDatabase } from './database'

const data: ErpData = {
  customers: [{
    id: 'customer-1', type: 'Privato', name: 'Cliente reale', phone: '123',
    email: '', taxId: '', address: '', createdAt: '2026-07-26T00:00:00.000Z',
  }],
  vehicles: [],
  coneHistory: [],
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
    await expect(loadDatabase()).resolves.toEqual({
      customers: [], vehicles: [], coneHistory: [],
    })
  })
})
