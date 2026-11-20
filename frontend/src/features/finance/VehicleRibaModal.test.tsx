import { useState } from 'react'
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
  render(<VehicleRibaModal data={data} vehicleId="first" onClose={vi.fn()} onSave={save} onAddBank={vi.fn()} />)
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


it('adds and selects a bank without clearing the draft', () => {
  function TestModal() {
    const [data, setData] = useState(() => structuredClone(emptyData))
    return <VehicleRibaModal data={data} onClose={vi.fn()} onSave={vi.fn()}
      onAddBank={bank => setData({ ...data, bankAccounts: [...data.bankAccounts, bank] })} />
  }
  render(<TestModal />)
  fireEvent.change(screen.getByLabelText('Numero distinta'), { target: { value: 'DIST-2' } })
  fireEvent.change(screen.getByLabelText('Nome banca'), { target: { value: 'Banca di prova' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salva banca' }))
  expect(screen.getByRole('option', { name: 'Banca di prova' })).toHaveProperty('selected', true)
  expect(screen.getByLabelText('Numero distinta')).toHaveValue('DIST-2')
})

it('asks for confirmation before cancelling an existing RIBA', async () => {
 const { createVehicleRiba } = await import('../../services/vehicleRiba')
 const initial=structuredClone(emptyData)
 initial.vehicles=[{id:'v',plate:'TEST'}] as typeof initial.vehicles
 initial.bankAccounts=[{id:'bank',name:'Banca',currentBalance:1000}] as typeof initial.bankAccounts
 const data=createVehicleRiba(initial,{number:'R1',bankAccountId:'bank',presentationDate:'2026-11-01',dueDate:'2026-12-01',collectionDate:'2026-12-01',selections:[{key:'vehicle|v',amount:100}],mode:'maturity',advanceDate:'2026-11-01',fees:0,interest:0})
 const save=vi.fn(), confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 render(<VehicleRibaModal data={data} vehicleId="v" onClose={vi.fn()} onSave={save} onAddBank={vi.fn()}/>)
 fireEvent.click(screen.getByRole('button',{name:'Annulla distinta R1'}))
 expect(save).not.toHaveBeenCalled()
 confirm.mockReturnValue(true)
 fireEvent.click(screen.getByRole('button',{name:'Annulla distinta R1'}))
 expect(save.mock.calls[0][0].ribaBatches[0].status).toBe('Stornata')
 confirm.mockRestore()
})

it('allows loading unbilled vehicles for only the selected customer',()=>{
 const data=structuredClone(emptyData)
 data.vehicles=[{id:'v1',plate:'AAA',customerId:'c1',expectedRevenue:100},{id:'v2',plate:'BBB',customerId:'c2',expectedRevenue:100}] as typeof data.vehicles
 data.bankAccounts=[{id:'bank',name:'Bank',currentBalance:0}] as typeof data.bankAccounts
 const save=vi.fn()
 render(<VehicleRibaModal data={data} customerId="c1" onSave={save} onClose={vi.fn()} onAddBank={vi.fn()} />)
 expect(screen.queryByRole('checkbox',{name:'BBB'})).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('checkbox',{name:'AAA'}))
 fireEvent.change(screen.getByLabelText('Numero distinta'),{target:{value:'R-NO-INVOICE'}})
 fireEvent.change(screen.getByLabelText('Scadenza bancaria RIBA'),{target:{value:'2026-12-01'}})
 fireEvent.click(screen.getByRole('button',{name:'Registra RIBA'}))
 expect(save).toHaveBeenCalledOnce()
 expect(save.mock.calls[0][0].invoices).toHaveLength(0)
 expect(save.mock.calls[0][0].ribaBatches[0].pendingVehicleLinks[0].vehicleId).toBe('v1')
})
