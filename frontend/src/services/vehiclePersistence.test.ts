import { describe, expect, it } from 'vitest'
import type { ErpData, Vehicle } from '../types'
import { createCustomer, emptyData } from './erp'
import { createEstimate } from './workflow'
import { saveVehicleWithPersistenceCheck, type VehiclePersistenceAdapter } from './vehiclePersistence'

const vehicleInput: Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'> = {
  customerId: 'c1',
  plate: 'AA123BB',
  make: 'Fiat',
  model: 'Panda',
  color: 'Bianco',
  year: '2023',
  vin: '',
  mileage: '10000',
  status: 'Accettata',
  priority: 'Normale',
  deliveryDate: '2026-08-20',
  estimatedHours: 4,
  workedHours: 0,
  plannedEntryDate: '2026-08-18',
  requestedDeliveryDate: '2026-08-20',
  calculatedDeliveryDate: '',
  expectedRevenue: 400,
  expectedMargin: 120,
  partsStatus: 'Disponibili',
  blockReason: '',
  manualPlanningDate: '',
}

function makeData(): ErpData {
  const customer = createCustomer({
    type: 'Privato',
    name: 'Cliente test',
    phone: '3331231234',
    email: 'cliente@example.com',
    taxId: 'RSSMRA80A01H501U',
    address: 'Via Roma 1',
  })
  return {
    ...structuredClone(emptyData),
    customers: [{ ...customer, id: 'c1' }],
  }
}

function createMemoryAdapter(initial: ErpData): VehiclePersistenceAdapter {
  let persisted = structuredClone(initial)
  return {
    save: async (data) => {
      persisted = structuredClone(data)
    },
    load: async () => structuredClone(persisted),
  }
}

describe('vehicle persistence flow', () => {
  it('CREATE VEHICLE PERSISTENCE: PASS', async () => {
    const data = makeData()
    const adapter = createMemoryAdapter(data)

    const result = await saveVehicleWithPersistenceCheck({
      data,
      input: vehicleInput,
      save: adapter.save,
      load: adapter.load,
    })

    expect(result.data.vehicles.some((vehicle) => vehicle.id === result.vehicleId)).toBe(true)
  })

  it('RELOAD PERSISTENCE: PASS', async () => {
    const data = makeData()
    const adapter = createMemoryAdapter(data)

    const result = await saveVehicleWithPersistenceCheck({
      data,
      input: { ...vehicleInput, plate: 'CC123DD' },
      save: adapter.save,
      load: adapter.load,
    })

    const reloaded = await adapter.load!()
    expect(reloaded.vehicles.some((vehicle) => vehicle.id === result.vehicleId && vehicle.plate === 'CC123DD')).toBe(true)
  })

  it('VEHICLE VISIBLE IN PARCO VEICOLI: PASS', async () => {
    const data = makeData()
    const adapter = createMemoryAdapter(data)

    const result = await saveVehicleWithPersistenceCheck({
      data,
      input: { ...vehicleInput, plate: 'EE123FF' },
      save: adapter.save,
      load: adapter.load,
    })

    const vehicles = result.data.vehicles
    expect(vehicles.map((vehicle) => vehicle.plate)).toContain('EE123FF')
  })

  it('VEHICLE SELECTABLE IN PREVENTIVO: PASS', async () => {
    const data = makeData()
    const adapter = createMemoryAdapter(data)

    const saved = await saveVehicleWithPersistenceCheck({
      data,
      input: { ...vehicleInput, plate: 'GG123HH' },
      save: adapter.save,
      load: adapter.load,
    })

    const estimateData = createEstimate(saved.data, {
      customerId: 'c1',
      vehicleId: saved.vehicleId,
      plate: 'GG123HH',
      companyName: '',
      contactName: 'Cliente test',
      date: '2026-08-14',
      notes: 'Preventivo su vettura appena creata',
      lines: [{ description: 'Riparazione', category: 'carrozzeria', quantity: 1, unitPrice: 250, discount: 0, vatRate: 22 }],
    })

    expect(estimateData.estimates?.some((estimate) => estimate.vehicleId === saved.vehicleId)).toBe(true)
  })

  it('salvataggio con errore persistente fallisce', async () => {
    const data = makeData()
    const adapter: VehiclePersistenceAdapter = {
      save: async () => {
        throw new Error('persist fail')
      },
      load: async () => makeData(),
    }

    await expect(saveVehicleWithPersistenceCheck({
      data,
      input: { ...vehicleInput, plate: 'II123LL' },
      save: adapter.save,
      load: adapter.load,
    })).rejects.toThrow('persist fail')
  })
})
