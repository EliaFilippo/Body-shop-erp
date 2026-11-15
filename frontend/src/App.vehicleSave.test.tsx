import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ErpData, RepairJob } from './types'
import { createCustomer, emptyData, STORAGE_KEY } from './services/erp'

let persistedData: ErpData

vi.mock('./services/database', () => ({
  loadDatabase: vi.fn(async () => structuredClone(persistedData)),
  saveDatabase: vi.fn(async (data: ErpData) => {
    persistedData = structuredClone(data)
  }),
}))

import App from './App'

const existingVehicle = {
  customerId: 'c-ui-1',
  plate: 'AB123CD',
  make: 'BMW',
  model: 'Serie 3',
  color: 'Nero',
  year: '2021',
  vin: '',
  mileage: '',
  status: 'accettata' as const,
  priority: 'Normale' as const,
  deliveryDate: '',
  estimatedHours: 0,
  workedHours: 0,
  plannedEntryDate: '',
  requestedDeliveryDate: '',
  calculatedDeliveryDate: '',
  expectedRevenue: 0,
  expectedMargin: 0,
  partsStatus: 'Disponibili' as const,
  blockReason: '',
  manualPlanningDate: '',
}

const baseData = (): ErpData => {
  const customer = createCustomer({
    type: 'Privato',
    name: 'Cliente UI',
    phone: '3331231234',
    email: 'cliente-ui@example.com',
    taxId: 'RSSMRA80A01H501U',
    address: 'Via Milano 10',
  })
  return {
    ...structuredClone(emptyData),
    customers: [{ ...customer, id: 'c-ui-1' }],
    vehicles: [],
  }
}

const vehicleFixture = (id: string, plate: string): NonNullable<ErpData['vehicles']>[number] => ({
  customerId: 'c-ui-1',
  plate,
  make: 'Fiat',
  model: `Model ${id}`,
  color: 'Bianco',
  year: '2024',
  vin: '',
  mileage: '',
  status: 'accettata',
  priority: 'Normale',
  deliveryDate: '',
  estimatedHours: 0,
  workedHours: 0,
  plannedEntryDate: '',
  requestedDeliveryDate: '',
  calculatedDeliveryDate: '',
  expectedRevenue: 0,
  expectedMargin: 0,
  partsStatus: 'Disponibili',
  blockReason: '',
  manualPlanningDate: '',
  id,
  coneNumber: null,
  statusMode: 'automatic',
  suggestedStatus: null,
  createdAt: `2026-08-15T00:00:0${id}.000Z`,
  statusHistory: [],
})

describe('vehicle save UI flow', () => {
  beforeEach(() => {
    persistedData = baseData()
  })

  it('NO ECONOMIC TOAST ON VEHICLE SAVE: PASS', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: /Gestione coni/ }))
    const scope = await screen.findByRole('combobox', { name: 'Vetture da mostrare' }, { timeout: 4000 })
    fireEvent.change(scope, { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: /Nuova vettura/i }))

    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'c-ui-1' } })
    fireEvent.change(screen.getByLabelText('Targa'), { target: { value: 'UI123AA' } })
    fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Fiat' } })
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'Panda' } })

    fireEvent.click(screen.getByRole('button', { name: 'Salva vettura' }))

    await screen.findByText('Vettura salvata')
    expect(screen.queryByText(/Fatturato aggiunto/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/margine aggiunto/i)).not.toBeInTheDocument()
  })

  it('VEHICLE VISIBLE IN GESTIONE CONI: PASS', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: /Gestione coni/ }))
    const scope = await screen.findByRole('combobox', { name: 'Vetture da mostrare' }, { timeout: 4000 })
    fireEvent.change(scope, { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: /Nuova vettura/i }))

    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'c-ui-1' } })
    fireEvent.change(screen.getByLabelText('Targa'), { target: { value: 'UI456BB' } })
    fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Ford' } })
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'Focus' } })

    fireEvent.click(screen.getByRole('button', { name: 'Salva vettura' }))

    await waitFor(() => {
      expect(screen.getByText('UI456BB')).toBeInTheDocument()
    })
  })

  it('normalized plate search keeps vehicle visible and duplicate action opens existing record', async () => {
    persistedData = {
      ...baseData(),
      vehicles: [{ ...existingVehicle, id: 'v-existing', createdAt: '2026-08-15T00:00:00.000Z', coneNumber: null, statusMode: 'automatic', suggestedStatus: null }],
    }

    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: /Gestione coni/ }))
    const scope = await screen.findByRole('combobox', { name: 'Vetture da mostrare' }, { timeout: 4000 })
    fireEvent.change(scope, { target: { value: 'all' } })
    fireEvent.change(screen.getByPlaceholderText('Cerca targa, cliente...'), { target: { value: 'ab 123 cd' } })

    await waitFor(() => {
      expect(screen.getByText('AB123CD')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Nuova vettura/i }))
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'c-ui-1' } })
    fireEvent.change(screen.getByLabelText('Targa'), { target: { value: 'ab 123 cd' } })
    fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'BMW' } })
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'Serie 3' } })

    fireEvent.click(screen.getByRole('button', { name: 'Salva vettura' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apri vettura' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Apri vettura' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('AB123CD')).toBeInTheDocument()
    })
  })

  it('conteggio iniziale 3 -> nuova vettura -> repository/state/Gestione coni 4 senza refresh', async () => {
    persistedData = {
      ...baseData(),
      vehicles: [
        vehicleFixture('1', 'AA111AA'),
        vehicleFixture('2', 'BB222BB'),
        vehicleFixture('3', 'CC333CC'),
      ],
    }

    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: /Gestione coni/ }))
    const scope = await screen.findByRole('combobox', { name: 'Vetture da mostrare' }, { timeout: 4000 })
    fireEvent.change(scope, { target: { value: 'all' } })
    await screen.findByText(/· 3 vetture/)
    fireEvent.click(screen.getByRole('button', { name: /Nuova vettura/i }))

    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'c-ui-1' } })
    fireEvent.change(screen.getByLabelText('Targa'), { target: { value: 'DD444DD' } })
    fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Renault' } })
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'Clio' } })

    fireEvent.click(screen.getByRole('button', { name: 'Salva vettura' }))

    expect(screen.getByRole('button', { name: 'Salvataggio...' })).toBeDisabled()

    await waitFor(() => {
      expect(screen.getByText('Vettura salvata')).toBeInTheDocument()
      expect(screen.getByText(/· 4 vetture/)).toBeInTheDocument()
      expect(persistedData.vehicles).toHaveLength(4)
      expect(persistedData.vehicles.some((vehicle) => vehicle.plate === 'DD444DD')).toBe(true)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    fireEvent.click(screen.getByRole('button', { name: /Gestione coni/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Vetture da mostrare' }, { timeout: 4000 }), { target: { value: 'all' } })

    await waitFor(() => {
      expect(screen.getByText(/· 4 vetture/)).toBeInTheDocument()
      expect(screen.getByText('DD444DD')).toBeInTheDocument()
    })
  })

  it('doppio click Salva -> 1 solo record', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: /Gestione coni/ }))
    const scope = await screen.findByRole('combobox', { name: 'Vetture da mostrare' }, { timeout: 4000 })
    fireEvent.change(scope, { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: /Nuova vettura/i }))

    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'c-ui-1' } })
    fireEvent.change(screen.getByLabelText('Targa'), { target: { value: 'HGJFU8547' } })
    fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Audi' } })
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'A3' } })

    const saveButton = screen.getByRole('button', { name: 'Salva vettura' })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('Vettura salvata')).toBeInTheDocument()
      expect(persistedData.vehicles.filter((vehicle) => vehicle.plate === 'HGJFU8547')).toHaveLength(1)
    })
  })

  it('historical storage con 3 occorrenze stessa targa -> Gestione coni mostra solo lo snapshot corrente', async () => {
    persistedData = {
      ...baseData(),
      vehicles: [{ ...vehicleFixture('1', 'HGJFU8547') }],
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...baseData(),
      vehicles: [
        { ...vehicleFixture('legacy-1', 'HGJFU8547') },
        { ...vehicleFixture('legacy-2', 'hg jfu 8547') },
        { ...vehicleFixture('legacy-3', 'HG JFU 8547') },
      ],
    }))

    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: /Gestione coni/ }))
    const scope = await screen.findByRole('combobox', { name: 'Vetture da mostrare' }, { timeout: 4000 })
    fireEvent.change(scope, { target: { value: 'all' } })

    await waitFor(() => {
      expect(screen.getByText(/· 1 vetture/)).toBeInTheDocument()
      expect(screen.getAllByText('HGJFU8547')).toHaveLength(1)
    })
  })

  it('mostra solo le vetture consegnate nello storico e le raggruppa per mese della consegna in Italia', async () => {
    persistedData.vehicles = [
      { ...vehicleFixture('1', 'AA111AA'), status: 'consegnata', deliveredAt: '2026-10-31T23:30:00Z',
        costEntries: [{ id: 'part', category: 'ricambi', description: 'Fanale posteriore', quantity: 1, unit: 'pz',
          usedAt: '2026-10-30', unitCost: 125.55, total: 125.55, discount: 0, vatRate: 22, createdAt: '', updatedAt: '' }] },
      { ...vehicleFixture('2', 'BB222BB'), status: 'consegnata', deliveredAt: '2026-10-21T10:30:00Z' },
      { ...vehicleFixture('3', 'CC333CC'), status: 'consegnata', requestedDeliveryDate: '2026-10-28' },
      vehicleFixture('4', 'DD444DD'),
    ]
    persistedData.jobs = [{
      id: 'j1', number: 'COMM-00001', vehicleId: '1', customerId: 'c-ui-1', plate: 'AA111AA', status: 'Consegnata',
      createdAt: '2026-10-30T08:00:00Z', updatedAt: '2026-10-31T23:30:00Z', deliveredAt: '2026-10-31T23:30:00Z',
      entryDate: '2026-10-30', expectedDeliveryDate: '', coneNumber: null, priority: 'Normale', responsible: '', companyName: '',
      contactName: '', notes: '', blocks: [], history: [], lines: [], qualityChecklist: [], taxableAmount: 500,
      vatAmount: 110, total: 610, progressPercent: 100,
      materialActualCost: { amount: 54.2, at: '2026-10-30T14:00:00Z', note: 'Vernice e trasparente' },
      phases: [{
        id: 'p1', name: 'Verniciatura', status: 'Completata', estimatedMinutes: 40, actualMinutes: 30, notes: '', blockedReason: '',
        startedAt: '2026-10-30T10:00:00Z', endedAt: '2026-10-30T10:30:00Z',
        operatorAssignments: [{ id: 'a1', operatorName: 'Martin', workedMinutes: 30, activityStatus: 'Concluso',
          startedAt: '2026-10-30T10:00:00Z', endedAt: '2026-10-30T10:30:00Z' }],
      }],
    } satisfies RepairJob]
    render(<App />)
    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Storico veicoli' }))

    expect(within(screen.getByRole('region', { name: 'novembre 2026' })).getByText('01/11/2026')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'ottobre 2026' })).getByText('BB222BB')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Data di consegna non registrata' })).getByText('CC333CC')).toBeInTheDocument()
    expect(screen.queryByText('DD444DD')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Mese di consegna' }), { target: { value: '2026-11' } })
    expect(screen.getByText('AA111AA')).toBeInTheDocument()
    expect(screen.queryByText('BB222BB')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Lavorazioni e materiali' }))
    expect(screen.getByRole('heading', { name: 'Lavorazioni e materiali · AA111AA' })).toBeInTheDocument()
    expect(screen.getByText('Martin · 0 h 30 min')).toBeInTheDocument()
    expect(screen.getByText('Vernice e trasparente')).toBeInTheDocument()
    expect(screen.getByText('Fanale posteriore')).toBeInTheDocument()
  })
})
