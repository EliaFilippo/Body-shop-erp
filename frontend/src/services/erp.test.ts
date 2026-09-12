import { describe, expect, it } from 'vitest'
import type { Customer, ErpData, Vehicle } from '../types'
import { addVehicle, addVehicleCostEntry, changeVehicleStatus, createVehicle, defaultPlannerSettings, deleteCustomer, deleteVehicle, moveVehicleCone, normalizePlate, updateCustomer, updateVehicle } from './erp'

const customer: Customer = {
  id: 'customer-1', type: 'Privato', name: 'Mario Rossi', phone: '123',
  email: '', taxId: '', address: '', createdAt: '2026-01-01',
}

const vehicle = (id: string, plate: string, coneNumber: number | null = null): Vehicle => ({
  id, plate, coneNumber, customerId: customer.id, make: 'Fiat', model: '500',
  color: 'Nero', year: '2020', vin: '', mileage: '', status: coneNumber ? 'in-lavorazione' : 'Accettata',
  estimatedHours: 0, workedHours: 0, plannedEntryDate: '', requestedDeliveryDate: '',
  calculatedDeliveryDate: '', expectedRevenue: 0, expectedMargin: 0, partsStatus: 'Disponibili',
  blockReason: '', manualPlanningDate: '',
  createdAt: '2026-01-01',
})

const state = (vehicles: Vehicle[]): ErpData => ({
  customers: [customer], vehicles, coneHistory: [],
  plannerSettings: structuredClone(defaultPlannerSettings), plannerAssignments: [],
  invoices: [], bankAccounts: [], ribaBatches: [], financialEvents: [],
  financeSettings: {
    defaultVatRate: 22,
    defaultPaymentDays: 30,
    minimumProjectedBalance: 0,
    laborHourlyCost: 45,
    laborHoursBase: 'effettive',
    laborOperatorById: {},
    marginThresholds: { positive: 15, low: 5, breakEven: 0 },
  },
})

describe('targhe', () => {
  it('normalizza maiuscole, spazi e trattini', () => {
    expect(normalizePlate(' ab-123 cd ')).toBe('AB123CD')
  })

  it('impedisce una targa duplicata anche se scritta diversamente', () => {
    expect(() => createVehicle({
      ...vehicle('new', 'ab 123-cd'), id: undefined, createdAt: undefined, coneNumber: undefined,
    } as never, [vehicle('old', 'AB123CD')])).toThrow('Esiste già una vettura con questa targa.')
  })

  it('BMW Serie 3 / AB123CD + BMW Serie 3 / EF456GH -> PASS', () => {
    const existing = {
      ...vehicle('old', 'AB123CD'),
      make: 'BMW',
      model: 'Serie 3',
      year: '2021',
      color: 'Nero',
    }
    expect(() => createVehicle({
      ...existing,
      id: undefined,
      createdAt: undefined,
      coneNumber: undefined,
      plate: 'EF456GH',
      vin: '',
    } as never, [existing])).not.toThrow()
  })

  it('BMW Serie 3 / AB123CD + BMW Serie 3 / AB123CD -> BLOCCATO', () => {
    const existing = {
      ...vehicle('old', 'AB123CD'),
      make: 'BMW',
      model: 'Serie 3',
    }
    expect(() => createVehicle({
      ...existing,
      id: undefined,
      createdAt: undefined,
      coneNumber: undefined,
      plate: 'AB123CD',
    } as never, [existing])).toThrow('Esiste già una vettura con questa targa.')
  })

  it('AB123CD + ab 123 cd -> BLOCCATO', () => {
    const existing = vehicle('old', 'AB123CD')
    expect(() => createVehicle({
      ...existing,
      id: undefined,
      createdAt: undefined,
      coneNumber: undefined,
      plate: 'ab 123 cd',
    } as never, [existing])).toThrow('Esiste già una vettura con questa targa.')
  })

  it('stesso VIN con targa diversa -> BLOCCATO', () => {
    const existing = {
      ...vehicle('old', 'AB123CD'),
      vin: 'WBA123VINTEST',
    }
    expect(() => createVehicle({
      ...existing,
      id: undefined,
      createdAt: undefined,
      coneNumber: undefined,
      plate: 'EF456GH',
      vin: 'wba123vintest',
    } as never, [existing])).toThrow('Esiste già una vettura con questo VIN.')
  })

  it('stesso marchio/modello/anno/colore ma targa diversa -> PASS', () => {
    const existing = {
      ...vehicle('old', 'AB123CD'),
      make: 'BMW',
      model: 'Serie 3',
      year: '2021',
      color: 'Blu',
      vin: '',
    }
    expect(() => createVehicle({
      ...existing,
      id: undefined,
      createdAt: undefined,
      coneNumber: undefined,
      plate: 'EF456GH',
    } as never, [existing])).not.toThrow()
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

  it('prima vettura operativa riceve il cono 1', () => {
    const result = changeVehicleStatus(state([
      vehicle('a', 'AA111AA'),
    ]), 'a', 'Confermata')
    expect(result.vehicles.find((item) => item.id === 'a')?.coneNumber).toBe(1)
  })

  it('seconda vettura operativa riceve il cono 2', () => {
    const result = changeVehicleStatus(state([
      vehicle('a', 'AA111AA', 1),
      vehicle('b', 'BB222BB'),
    ]), 'b', 'Confermata')
    expect(result.vehicles.find((item) => item.id === 'b')?.coneNumber).toBe(2)
  })

  it('salta i coni occupati e usa il primo libero', () => {
    const result = changeVehicleStatus(state([
      vehicle('a', 'AA111AA', 1), vehicle('b', 'BB222BB', 3), vehicle('c', 'CC333CC'),
    ]), 'c', 'Confermata')
    expect(result.vehicles.find((item) => item.id === 'c')?.coneNumber).toBe(2)
    expect(result.coneHistory[0].action).toBe('Assegnato')
  })

  it('non riassegna una vettura che ha già cono', () => {
    const result = changeVehicleStatus(state([
      { ...vehicle('a', 'AA111AA', 5), status: 'Confermata' },
    ]), 'a', 'in lavorazione')
    expect(result.vehicles.find((item) => item.id === 'a')?.coneNumber).toBe(5)
  })

  it('libera automaticamente il cono alla consegna e registra lo storico', () => {
    const result = changeVehicleStatus(state([vehicle('a', 'AA111AA', 4)]), 'a', 'Consegnata')
    expect(result.vehicles[0].coneNumber).toBeNull()
    expect(result.coneHistory[0]).toMatchObject({ coneNumber: 4, action: 'Liberato' })
  })

  it('riutilizza automaticamente il cono appena liberato', () => {
    const queued = { ...vehicle('b', 'BB222BB'), status: 'in lavorazione' as const }
    const result = changeVehicleStatus(state([
      vehicle('a', 'AA111AA', 1),
      queued,
    ]), 'a', 'Consegnata')
    expect(result.vehicles.find((item) => item.id === 'a')?.coneNumber).toBeNull()
    expect(result.vehicles.find((item) => item.id === 'b')?.coneNumber).toBe(1)
  })

  it('con tutti i coni occupati mantiene la vettura in attesa cono', () => {
    const vehicles = Array.from({ length: 30 }, (_, index) =>
      vehicle(`v${index}`, `AA${String(index).padStart(3, '0')}AA`, index + 1))
    vehicles.push({ ...vehicle('waiting', 'ZZ999ZZ'), status: 'in lavorazione' })
    const result = changeVehicleStatus(state(vehicles), 'waiting', 'in lavorazione')
    expect(result.vehicles.find((item) => item.id === 'waiting')?.coneNumber).toBeNull()
  })

  it('assegna automaticamente alla prima in attesa quando un cono torna libero', () => {
    const vehicles = Array.from({ length: 30 }, (_, index) =>
      vehicle(`v${index}`, `AA${String(index).padStart(3, '0')}AA`, index + 1))
    vehicles.push({ ...vehicle('waiting', 'ZZ999ZZ'), status: 'in lavorazione' })
    const queuedState = state(vehicles)
    const released = moveVehicleCone(queuedState, 'v0', null)
    expect(released.vehicles.find((item) => item.id === 'v0')?.coneNumber).toBeNull()
    expect(released.vehicles.find((item) => item.id === 'waiting')?.coneNumber).toBe(1)
  })

  it('blocca lo spostamento manuale verso un cono occupato', () => {
    const data = state([vehicle('a', 'AA111AA', 1), vehicle('b', 'BB222BB', 2)])
    expect(() => moveVehicleCone(data, 'a', 2)).toThrow('già occupato')
  })

  it('supporta override manuale: cambio cono, rilascio e riassegnazione', () => {
    const result = moveVehicleCone(state([{ ...vehicle('a', 'AA111AA', 1), status: 'in-lavorazione' }]), 'a', 7)
    const released = moveVehicleCone(result, 'a', null)
    const assigned = moveVehicleCone({ ...released, vehicles: released.vehicles.map((item) => item.id === 'a' ? { ...item, status: 'in-lavorazione' } : item) }, 'a', 4)
    expect(assigned.vehicles[0].coneNumber).toBe(4)
    expect(assigned.coneHistory.map((entry) => entry.action)).toEqual(['Assegnato', 'Liberato', 'Spostato', 'Liberato'])
  })

  it('impedisce la doppia assegnazione dello stesso cono', () => {
    const data = state([vehicle('a', 'AA111AA', 1), { ...vehicle('b', 'BB222BB'), status: 'in lavorazione' }])
    expect(() => moveVehicleCone(data, 'b', 1)).toThrow('già occupato')
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
    } as never)).toThrow('Esiste già una vettura con questa targa.')
  })

  it('modifica veicolo senza cambiare targa -> PASS', () => {
    const data = state([{ ...vehicle('a', 'AA111AA'), vin: 'VIN-AAA' }, vehicle('b', 'BB222BB')])
    expect(() => updateVehicle(data, 'a', {
      ...data.vehicles[0],
      model: '500X',
      plate: 'AA111AA',
      vin: 'vin-aaa',
      id: undefined,
      createdAt: undefined,
      coneNumber: undefined,
    } as never)).not.toThrow()
  })

  it('eliminando una vettura libera il cono e conserva la targa nello storico', () => {
    const result = deleteVehicle(state([vehicle('a', 'AA111AA', 5)]), 'a')
    expect(result.vehicles).toHaveLength(0)
    expect(result.coneHistory[0]).toMatchObject({ vehiclePlate: 'AA111AA', coneNumber: 5, action: 'Liberato' })
  })

  it('aggiunge un costo commessa e aggiorna il margine reale della vettura', () => {
    const result = addVehicleCostEntry(state([vehicle('a', 'AA111AA')]), 'a', {
      usedAt: '2026-08-01',
      category: 'ricambi',
      description: 'Paraurti',
      supplier: 'Fornitore',
      quantity: 1,
      unit: 'pz',
      unitCost: 180,
      discount: 0,
      total: 180,
      vatRate: 22,
      note: 'Nuovo costo',
    })
    const updated = result.vehicles[0]
    expect(updated.costEntries).toHaveLength(1)
    expect(updated.costHistory?.[0]).toMatchObject({ action: 'aggiunta', newValue: expect.stringContaining('Paraurti') })
    expect(updated.actualMargin).toBe(-180)
  })
})

describe('stato vettura libero e separato', () => {
  it('cambio libero tra stati', () => {
    const result = changeVehicleStatus(state([vehicle('a', 'AA111AA')]), 'a', 'consegnata')
    expect(result.vehicles[0].status).toBe('consegnata')
  })

  it('salto di stati intermedi', () => {
    const result = changeVehicleStatus(state([vehicle('a', 'AA111AA')]), 'a', 'verniciatura')
    expect(result.vehicles[0].status).toBe('verniciatura')
  })

  it('stato automatico suggerito', () => {
    const manual = changeVehicleStatus(state([vehicle('a', 'AA111AA')]), 'a', 'pronta', {
      source: 'manual',
      note: 'Override manuale iniziale',
    })
    const automaticSuggestion = changeVehicleStatus(manual, 'a', 'consegnata', {
      source: 'automatic',
      note: 'Suggerimento automatico',
    })

    expect(automaticSuggestion.vehicles[0].status).toBe('pronta')
    expect(automaticSuggestion.vehicles[0].statusMode).toBe('manual')
    expect(automaticSuggestion.vehicles[0].suggestedStatus).toBe('consegnata')
  })

  it('override manuale', () => {
    const manual = changeVehicleStatus(state([vehicle('a', 'AA111AA')]), 'a', 'pronta', { source: 'manual' })
    const automaticSuggestion = changeVehicleStatus(manual, 'a', 'consegnata', { source: 'automatic' })
    const overridden = changeVehicleStatus(automaticSuggestion, 'a', 'consegnata', { source: 'manual' })

    expect(overridden.vehicles[0].status).toBe('consegnata')
    expect(overridden.vehicles[0].statusMode).toBe('manual')
    expect(overridden.vehicles[0].suggestedStatus).toBeNull()
  })

  it('stato personalizzato creato da Impostazioni', () => {
    const base = state([vehicle('a', 'AA111AA')])
    const customData: ErpData = {
      ...base,
      plannerSettings: {
        ...base.plannerSettings,
        vehicleStatuses: [
          ...(base.plannerSettings.vehicleStatuses ?? []),
          {
            id: 'in-attesa-cliente',
            label: 'In attesa cliente',
            color: '#5f6b7a',
            icon: 'clock',
            active: true,
            sortOrder: 999,
            semantic: 'waiting',
          },
        ],
      },
    }

    const result = changeVehicleStatus(customData, 'a', 'In attesa cliente')
    expect(result.vehicles[0].status).toBe('in-attesa-cliente')
  })

  it('storico cambi stato', () => {
    const first = changeVehicleStatus(state([vehicle('a', 'AA111AA')]), 'a', 'in-lavorazione', {
      source: 'manual',
      note: 'Ingresso in produzione',
    })
    const second = changeVehicleStatus(first, 'a', 'pronta', {
      source: 'automatic',
      note: 'Fine lavorazioni',
      forceAutomatic: true,
    })

    const history = second.vehicles[0].statusHistory ?? []
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ from: 'in-lavorazione', to: 'pronta', source: 'automatic', note: 'Fine lavorazioni' })
    expect(history[1]).toMatchObject({ from: 'Accettata', to: 'in-lavorazione', source: 'manual', note: 'Ingresso in produzione' })
  })
})
