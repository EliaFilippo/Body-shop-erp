import { describe, expect, it } from 'vitest'
import type { Customer, ErpData, Vehicle } from '../types'
import { addVehicle, changeVehicleStatus, createVehicle, defaultPlannerSettings, deleteCustomer, deleteVehicle, moveVehicleCone, normalizePlate, updateCustomer, updateVehicle } from './erp'

const customer: Customer = {
  id: 'customer-1', type: 'Privato', name: 'Mario Rossi', phone: '123',
  email: '', taxId: '', address: '', createdAt: '2026-01-01',
}

const vehicle = (id: string, plate: string, coneNumber: number | null = null): Vehicle => ({
  id, plate, coneNumber, customerId: customer.id, make: 'Fiat', model: '500',
  color: 'Nero', year: '2020', vin: '', mileage: '', status: coneNumber ? 'Confermata' : 'Accettata',
  estimatedHours: 0, workedHours: 0, plannedEntryDate: '', requestedDeliveryDate: '',
  calculatedDeliveryDate: '', expectedRevenue: 0, expectedMargin: 0, partsStatus: 'Disponibili',
  blockReason: '', manualPlanningDate: '',
  createdAt: '2026-01-01',
})

const state = (vehicles: Vehicle[]): ErpData => ({
  customers: [customer], vehicles, coneHistory: [],
  plannerSettings: structuredClone(defaultPlannerSettings), plannerAssignments: [],
})

describe('targhe', () => {
  it('normalizza maiuscole, spazi e trattini', () => {
    expect(normalizePlate(' ab-123 cd ')).toBe('AB123CD')
  })

  it('impedisce una targa duplicata anche se scritta diversamente', () => {
    expect(() => createVehicle({
      ...vehicle('new', 'ab 123-cd'), id: undefined, createdAt: undefined, coneNumber: undefined,
    } as never, [vehicle('old', 'AB123CD')])).toThrow('già presente')
  })
})

describe('gestione coni', () => {
  it('assegna il cono anche salvando una nuova vettura già confermata', () => {
    const result = addVehicle(state([vehicle('a', 'AA111AA', 1)]), {
      ...vehicle('new', 'BB222BB'), status: 'Confermata', id: undefined, createdAt: undefined, coneNumber: undefined,
    } as never)
    expect(result.vehicles[0].coneNumber).toBe(2)
    expect(result.coneHistory[0]).toMatchObject({ vehiclePlate: 'BB222BB', action: 'Assegnato' })
  })

  it('assegna automaticamente il primo cono libero', () => {
    const result = changeVehicleStatus(state([
      vehicle('a', 'AA111AA', 1), vehicle('b', 'BB222BB', 3), vehicle('c', 'CC333CC'),
    ]), 'c', 'Confermata')
    expect(result.vehicles.find((item) => item.id === 'c')?.coneNumber).toBe(2)
    expect(result.coneHistory[0].action).toBe('Assegnato')
  })

  it('libera il cono alla consegna e registra lo storico', () => {
    const result = changeVehicleStatus(state([vehicle('a', 'AA111AA', 4)]), 'a', 'Consegnata')
    expect(result.vehicles[0].coneNumber).toBeNull()
    expect(result.coneHistory[0]).toMatchObject({ coneNumber: 4, action: 'Liberato' })
  })

  it('blocca lo spostamento manuale verso un cono occupato', () => {
    const data = state([vehicle('a', 'AA111AA', 1), vehicle('b', 'BB222BB', 2)])
    expect(() => moveVehicleCone(data, 'a', 2)).toThrow('già occupato')
  })

  it('sposta manualmente e conserva entrambi gli eventi', () => {
    const result = moveVehicleCone(state([vehicle('a', 'AA111AA', 1)]), 'a', 7)
    expect(result.vehicles[0].coneNumber).toBe(7)
    expect(result.coneHistory.map((entry) => entry.action)).toEqual(['Spostato', 'Liberato'])
  })

  it('blocca la conferma quando tutti i 30 coni sono occupati', () => {
    const vehicles = Array.from({ length: 30 }, (_, index) =>
      vehicle(`v${index}`, `AA${String(index).padStart(3, '0')}AA`, index + 1))
    vehicles.push(vehicle('waiting', 'ZZ999ZZ'))
    expect(() => changeVehicleStatus(state(vehicles), 'waiting', 'Confermata')).toThrow('Tutti i 30 coni')
  })
})

describe('anagrafiche operative', () => {
  it('modifica un cliente conservandone identità e data di creazione', () => {
    const [updated] = updateCustomer([customer], customer.id, { ...customer, name: 'Mario Bianchi' })
    expect(updated).toMatchObject({ id: customer.id, createdAt: customer.createdAt, name: 'Mario Bianchi' })
  })

  it('blocca la cancellazione di un cliente con veicoli collegati', () => {
    expect(() => deleteCustomer(state([vehicle('a', 'AA111AA')]), customer.id))
      .toThrow('veicoli collegati')
  })

  it('blocca una targa duplicata anche durante la modifica', () => {
    const data = state([vehicle('a', 'AA111AA'), vehicle('b', 'BB222BB')])
    expect(() => updateVehicle(data, 'b', {
      ...data.vehicles[1], plate: 'aa-111-aa', id: undefined, createdAt: undefined, coneNumber: undefined,
    } as never)).toThrow('già presente')
  })

  it('eliminando una vettura libera il cono e conserva la targa nello storico', () => {
    const result = deleteVehicle(state([vehicle('a', 'AA111AA', 5)]), 'a')
    expect(result.vehicles).toHaveLength(0)
    expect(result.coneHistory[0]).toMatchObject({ vehiclePlate: 'AA111AA', coneNumber: 5, action: 'Liberato' })
  })
})
