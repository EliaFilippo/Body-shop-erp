import { createVehicleRiba,ribaVehicleOptions } from './vehicleRiba'
import { receivableFlows,ribaDueAlerts } from './receivableFlows'
import { describe, expect, it } from 'vitest'
import type { ErpData, Vehicle } from '../types'
import {
  calculateDueDate,
  createInvoice,
  createRibaBatch,
  invoiceResidual,
  markRibaInsolvent,
  registerRibaAdvance,
  settleRibaBatch,
} from './finance'
import { emptyData } from './erp'

const vehicle = (id: string, customerId: string): Vehicle => ({
  id,
  customerId,
  plate: `AA${id}BB`,
  make: 'Alfa Romeo',
  model: 'Giulia',
  color: 'Nero',
  year: '2024',
  vin: `VIN${id}`,
  mileage: '10000',
  status: 'Consegnata',
  coneNumber: null,
  estimatedHours: 10,
  workedHours: 8,
  plannedEntryDate: '2026-03-01',
  requestedDeliveryDate: '2026-03-10',
  calculatedDeliveryDate: '2026-03-10',
  expectedRevenue: 1000,
  expectedMargin: 300,
  partsStatus: 'Disponibili',
  blockReason: '',
  manualPlanningDate: '2026-03-01',
  billingStatus: 'Da fatturare',
  createdAt: '2026-03-01T00:00:00.000Z',
})

const makeData = (): ErpData => ({
  ...structuredClone(emptyData),
  customers: [{
    id: 'c1',
    type: 'Privato',
    name: 'Cliente',
    phone: '',
    email: '',
    taxId: '',
    address: '',
    usualPaymentMethod: 'R.I.B.A.',
    paymentDays: 30,
    createdAt: '2026-03-01T00:00:00.000Z',
  }],
  vehicles: [vehicle('1', 'c1')],
  bankAccounts: [{
    id: 'b1',
    name: 'Banca Test',
    iban: 'IT00X',
    creditLimit: 5000,
    blockOverLimit: true,
    minimumBalanceAlert: 0,
    currentBalance: 1000,
    createdAt: '2026-03-01T00:00:00.000Z',
  }],
})

describe('finance core rules', () => {
  it('calcola scadenze a 30/60/90 giorni', () => {
    expect(calculateDueDate('2026-03-01', 30)).toBe('2026-03-31')
    expect(calculateDueDate('2026-03-01', 60)).toBe('2026-04-30')
    expect(calculateDueDate('2026-03-01', 90)).toBe('2026-05-30')
  })

  it('crea fattura e mantiene residuo corretto prima e dopo RIBA', () => {
    const data = createInvoice(makeData(), {
      customerId: 'c1',
      vehicleIds: ['1'],
      number: 'FAT-001',
      issueDate: '2026-03-01',
    })
    const invoice = data.invoices[0]
    expect(invoiceResidual(invoice)).toBe(invoice.total)

    const withRiba = createRibaBatch(data, {
      number: 'RIBA-001',
      bankAccountId: 'b1',
      presentationDate: '2026-03-02',
      dueDate: invoice.dueDate,
      allocations: [{ invoiceId: invoice.id, amount: invoice.total }],
    })

    expect(withRiba.invoices[0].status).toBe('Inserita in R.I.B.A.')
    expect(invoiceResidual(withRiba.invoices[0])).toBe(0)
  })

  it('registra anticipo e poi incasso definitivo della distinta RIBA', () => {
    const data = createInvoice(makeData(), {
      customerId: 'c1',
      vehicleIds: ['1'],
      number: 'FAT-002',
      issueDate: '2026-03-01',
    })
    const withRiba = createRibaBatch(data, {
      number: 'RIBA-002',
      bankAccountId: 'b1',
      presentationDate: '2026-03-02',
      dueDate: data.invoices[0]?.dueDate ?? '2026-03-31',
      allocations: [{ invoiceId: data.invoices[0].id, amount: data.invoices[0].total }],
    })
    const batch = withRiba.ribaBatches[0]

    const advanced = registerRibaAdvance(withRiba, batch.id, batch.total, '2026-03-03', 20, 10)
    expect(advanced.ribaBatches[0].status).toBe('Anticipata')
    expect(advanced.invoices[0].status).toBe('Anticipata')

    const settled = settleRibaBatch(advanced, batch.id, '2026-03-31')
    expect(settled.ribaBatches[0].status).toBe('Chiusa')
    expect(settled.invoices[0].status).toBe('Incassata')
    expect(settled.invoices[0].collectedAmount).toBe(settled.invoices[0].total)
  })

  it('riapre il credito in caso di insoluto', () => {
    const data = createInvoice(makeData(), {
      customerId: 'c1',
      vehicleIds: ['1'],
      number: 'FAT-003',
      issueDate: '2026-03-01',
    })
    const withRiba = createRibaBatch(data, {
      number: 'RIBA-003',
      bankAccountId: 'b1',
      presentationDate: '2026-03-02',
      dueDate: data.invoices[0]?.dueDate ?? '2026-03-31',
      allocations: [{ invoiceId: data.invoices[0].id, amount: 600 }],
    })
    const insolvent = markRibaInsolvent(withRiba, withRiba.ribaBatches[0].id, '2026-04-01')

    expect(insolvent.ribaBatches[0].status).toBe('Insoluta')
    expect(insolvent.invoices[0].status).toBe('Insoluta')
    expect(insolvent.invoices[0].ribaAllocatedAmount).toBe(0)
  })
})

describe('RIBA per vetture e liquidità senza duplicazioni',()=>{
 const source=()=>{
  const base=makeData();base.vehicles.push(vehicle('2','c1'))
  return createInvoice(base,{customerId:'c1',vehicleIds:['1','2'],number:'FAT-VEHICLES',issueDate:'2026-03-01'})
 }
 const input=(data:ErpData)=>({number:'RIBA-CARS',bankAccountId:'b1',presentationDate:'2026-03-02',dueDate:'2026-03-31',collectionDate:'2026-04-02',selections:ribaVehicleOptions(data).map(row=>({key:row.key,amount:row.amount})),mode:'maturity' as const,advanceDate:'2026-03-03',fees:0,interest:0})
 it('collega più vetture e raggruppa gli importi della stessa fattura una sola volta',()=>{
  const data=source(),next=createVehicleRiba(data,input(data))
  expect(next.ribaBatches[0].vehicleLinks).toHaveLength(2)
  expect(next.ribaBatches[0].allocations).toHaveLength(1)
  expect(next.ribaBatches[0].total).toBe(2440)
  expect(next.ribaBatches[0].collectionDate).toBe('2026-04-02')
  expect(receivableFlows(next)).toEqual([{dueDate:'2026-04-02',amount:2440,kind:'riba'}])
  expect(ribaVehicleOptions(next)).toHaveLength(0)
  expect(data.ribaBatches).toHaveLength(0)
 })
 it('l’anticipo incrementa il saldo netto e a maturazione rimane soltanto il residuo',()=>{
  const data=source()
  const next=createVehicleRiba(data,{...input(data),mode:'advance',advanceAmount:1000,fees:20,interest:10})
  expect(next.bankAccounts[0].currentBalance).toBe(1970)
  expect(receivableFlows(next)).toEqual([{dueDate:'2026-04-02',amount:1440,kind:'riba'}])
  const settled=settleRibaBatch(next,next.ribaBatches[0].id,'2026-04-02')
  expect(settled.bankAccounts[0].currentBalance).toBe(3410)
  expect(receivableFlows(settled)).toEqual([])
  expect(()=>settleRibaBatch(settled,settled.ribaBatches[0].id,'2026-04-02')).toThrow('già chiusa')
 })
 it('avvisa da 15 giorni prima soltanto per distinte caricate e mantiene i costi dopo insoluto',()=>{
  const data=source()
  expect(ribaDueAlerts(data,'2026-03-16')).toHaveLength(0)
  const next=createVehicleRiba(data,{...input(data),mode:'advance',advanceAmount:1000,fees:20,interest:10})
  expect(ribaDueAlerts(next,'2026-03-15')).toHaveLength(0)
  expect(ribaDueAlerts(next,'2026-03-16')).toHaveLength(1)
  const failed=markRibaInsolvent(next,next.ribaBatches[0].id,'2026-04-02')
  expect(failed.bankAccounts[0].currentBalance).toBe(970)
  expect(failed.invoices[0].ribaAllocatedAmount).toBe(0)
  expect(ribaDueAlerts(failed,'2026-04-02')).toHaveLength(0)
 })
 it('una RIBA a maturazione non consuma il castelletto dell’anticipo',()=>{
  const data=source();data.bankAccounts[0].creditLimit=500
  expect(createVehicleRiba(data,input(data)).ribaBatches[0].total).toBe(2440)
  expect(()=>createVehicleRiba(data,{...input(data),mode:'advance',advanceAmount:1000})).toThrow('castelletto')
 })
})
