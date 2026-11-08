import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { emptyData } from '../../services/erp'
import { VehicleRibaModal } from './VehicleRibaModal'

it('preselects only the requested vehicle and creates the corresponding bank batch', () => {
  const data = structuredClone(emptyData)
  data.vehicles = [{ id: 'first', plate: 'AA123BB' }, { id: 'second', plate: 'CC456DD' }] as typeof data.vehicles
  data.bankAccounts = [{
    id: 'bank', name: 'Banca', iban: '', creditLimit: 5000, blockOverLimit: true,
    minimumBalanceAlert: 0, currentBalance: 1000, createdAt: '',
  }]
  data.invoices = [{
    id: 'invoice', customerId: 'customer', number: 'FAT-1', issueDate: '2026-11-08', dueDate: '2026-12-08',
    paymentMethod: 'R.I.B.A.', taxableAmount: 200, vatAmount: 44, total: 244,
    collectedAmount: 0, ribaAllocatedAmount: 0, status: 'Da incassare', notes: '', createdAt: '', updatedAt: '',
    lines: [{vehicleId:'first', total:122}, {vehicleId:'second', total:122}] as typeof data.invoices[number]['lines'],
  }]
  const save = vi.fn()
  render(<VehicleRibaModal data={data} vehicleId="first" onClose={vi.fn()} onSave={save} />)
  expect(screen.getByRole('checkbox', {name:'AA123BB'})).toBeChecked()
  expect(screen.queryByRole('checkbox', {name:'CC456DD'})).not.toBeInTheDocument()
  expect(screen.getByLabelText('Scadenza bancaria RIBA')).toHaveValue('2026-12-08')
  expect(screen.getByLabelText('Banca RIBA')).toHaveValue('bank')
  fireEvent.change(screen.getByLabelText('Numero distinta'), {target:{value:'DIST-1'}})
  fireEvent.click(screen.getByRole('button', {name:'Registra RIBA'}))
  expect(save).toHaveBeenCalledOnce()
  expect(save.mock.calls[0][0].ribaBatches[0]).toMatchObject({
    number:'DIST-1', total:122, vehicleLinks:[{vehicleId:'first', invoiceId:'invoice', plate:'AA123BB', amount:122}],
  })
})
