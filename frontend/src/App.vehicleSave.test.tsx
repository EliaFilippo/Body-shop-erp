import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ErpData } from './types'
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
    fireEvent.click(screen.getByRole('button', { name: 'Veicoli' }))
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

  it('VEHICLE VISIBLE IN PARCO VEICOLI: PASS', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Veicoli' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Veicoli' }))
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

  it('conteggio iniziale 3 -> nuova vettura -> repository/state/VehiclesPage 4 senza refresh', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Veicoli' }))
    await screen.findByText('3 vetture')
    fireEvent.click(screen.getByRole('button', { name: /Nuova vettura/i }))

    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'c-ui-1' } })
    fireEvent.change(screen.getByLabelText('Targa'), { target: { value: 'DD444DD' } })
    fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Renault' } })
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'Clio' } })

    fireEvent.click(screen.getByRole('button', { name: 'Salva vettura' }))

    expect(screen.getByRole('button', { name: 'Salvataggio...' })).toBeDisabled()

    await waitFor(() => {
      expect(screen.getByText('Vettura salvata')).toBeInTheDocument()
      expect(screen.getByText('4 vetture')).toBeInTheDocument()
      expect(persistedData.vehicles).toHaveLength(4)
      expect(persistedData.vehicles.some((vehicle) => vehicle.plate === 'DD444DD')).toBe(true)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicoli' }))

    await waitFor(() => {
      expect(screen.getByText('4 vetture')).toBeInTheDocument()
      expect(screen.getByText('DD444DD')).toBeInTheDocument()
    })
  })

  it('doppio click Salva -> 1 solo record', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Veicoli' }))
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

  it('historical storage con 3 occorrenze stessa targa -> VehiclesPage mostra solo lo snapshot corrente', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Veicoli' }))

    await waitFor(() => {
      expect(screen.getByText('1 vetture')).toBeInTheDocument()
      expect(screen.getAllByText('HGJFU8547')).toHaveLength(1)
    })
  })
})
