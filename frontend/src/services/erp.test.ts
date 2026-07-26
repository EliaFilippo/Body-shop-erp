import { describe, expect, it } from 'vitest'
import type { Customer, ErpData, Vehicle } from '../types'
import { changeVehicleStatus, createVehicle, moveVehicleCone, normalizePlate } from './erp'

const customer: Customer = {
  id: 'customer-1', type: 'Privato', name: 'Mario Rossi', phone: '123',
  email: '', taxId: '', address: '', createdAt: '2026-01-01',
}

const vehicle = (id: string, plate: string, coneNumber: number | null = null): Vehicle => ({
  id, plate, coneNumber, customerId: customer.id, make: 'Fiat', model: '500',
  color: 'Nero', year: '2020', vin: '', mileage: '', status: coneNumber ? 'Confermata' : 'Accettata',
  createdAt: '2026-01-01',
})

const state = (vehicles: Vehicle[]): ErpData => ({ customers: [customer], vehicles, coneHistory: [] })

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
