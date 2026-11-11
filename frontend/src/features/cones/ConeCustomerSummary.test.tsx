import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { RepairJob, Vehicle } from '../../types'
import { addVehicle, emptyData } from '../../services/erp'
import { ConeCustomerSummary } from './ConeCustomerSummary'

it('raggruppa le vetture presenti e distingue il timer attivo dall’attesa ricambi', () => {
  let data = structuredClone(emptyData)
  data.customers = [{ id: 'c1', name: 'Cliente Uno', phone: '', type: 'Privato', email: '', taxId: '', address: '', createdAt: '' }]
  for (const plate of ['AA111AA', 'BB222BB', 'CC333CC']) {
    data = addVehicle(data, {
      plate, customerId: 'c1', status: 'Accettata', make: '', model: '', color: '', year: '', vin: '', mileage: '',
      estimatedHours: 0, workedHours: 0, plannedEntryDate: '', requestedDeliveryDate: '', calculatedDeliveryDate: '',
      expectedRevenue: 0, expectedMargin: 0, partsStatus: 'Disponibili', blockReason: '', manualPlanningDate: '',
    })
  }
  const updateVehicle = (plate: string, fields: Partial<Vehicle>) => {
    data.vehicles = data.vehicles.map(vehicle => vehicle.plate === plate ? { ...vehicle, ...fields } : vehicle)
  }
  updateVehicle('AA111AA', { coneNumber: 4, status: 'in-lavorazione' })
  updateVehicle('BB222BB', { coneNumber: 9, status: 'in-attesa-ricambi', partsStatus: 'Ordinati' })
  updateVehicle('CC333CC', { status: 'consegnata' })
  data.production!.workLogs = [{
    id: 'timer', vehicleId: data.vehicles.find(vehicle => vehicle.plate === 'AA111AA')!.id,
    phase: 'Lavaggio/Controllo', operatorId: 'op', operatorName: 'Stefania',
    startedAt: '2026-11-09T08:00:00Z', totalMinutes: 0, status: 'running',
  }]

  render(<ConeCustomerSummary data={data} />)
  const row = within(screen.getByRole('rowheader', { name: 'Cliente Uno' }).closest('tr')!)
  expect(row.getByRole('cell', { name: '2' })).toBeInTheDocument()
  expect(row.getByText('AA111AA')).toBeInTheDocument()
  expect(row.getByText('Cono 4')).toBeInTheDocument()
  expect(row.getByText('Stefania · Lavaggio/Controllo')).toBeInTheDocument()
  expect(row.getByText('Inizio effettivo').parentElement).toHaveTextContent('09/11/2026')
  expect(row.getByText('In attesa ricambi').closest('li')).toHaveClass('waiting-parts')
  expect(row.getByText('Cono 9')).toBeInTheDocument()
  expect(screen.queryByText('CC333CC')).not.toBeInTheDocument()
})


it('shows the ready vehicle status when its job still says in progress', () => {
  const data = structuredClone(emptyData)
  data.vehicles = [{ id: 'v20', customerId: 'c1', plate: 'GR246SS', coneNumber: 20, status: 'pronta',
    partsStatus: 'Disponibili' } as Vehicle]
  data.jobs = [{ id: 'j20', vehicleId: 'v20', status: 'In lavorazione', phases: [] } as unknown as RepairJob]
  render(<ConeCustomerSummary data={data} />)
  const vehicle = within(screen.getByText('GR246SS').closest('li')!)
  expect(vehicle.getByText('Pronta')).toBeInTheDocument()
  expect(vehicle.getByText('Cono 20')).toBeInTheDocument()
  expect(vehicle.queryByText('In lavorazione')).not.toBeInTheDocument()
})
