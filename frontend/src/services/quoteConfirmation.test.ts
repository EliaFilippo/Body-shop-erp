import { describe, it, expect } from 'vitest'
import type { Vehicle } from '../types'
import { emptyData } from './erp'
import { createEstimate } from './workflow'
import { confirmQuoteFromCustomerMessage, attachQuotePhotos, createQuoteDocument } from './documents'
import { quotePdfFile } from './quoteShare'
const input={customerId:'c1',vehicleId:'v1',plate:'AA123BB',companyName:'',contactName:'',date:'2026-10-04',notes:'',lines:[{description:'Porta',category:'carrozzeria' as const,quantity:1,unitPrice:150,discount:0,vatRate:22}]}
const confirmation={channel:'whatsapp' as const,message:'Confermo il preventivo PREV-00001',receivedAt:'2026-10-04T10:00:00+02:00',recordedAt:'2026-10-04T09:00:00Z'}
const vehicle = (id: string, customerId: string): Vehicle => ({
  id,
  customerId,
  plate: 'AA123BB',
  make: 'Ford',
  model: 'Focus',
  color: 'Nero',
  year: '2022',
  vin: 'VIN123',
  mileage: '20000',
  status: 'Consegnata',
  coneNumber: null,
  estimatedHours: 10,
  workedHours: 8,
  plannedEntryDate: '2026-01-01',
  requestedDeliveryDate: '2026-01-10',
  calculatedDeliveryDate: '2026-01-10',
  expectedRevenue: 1000,
  expectedMargin: 300,
  partsStatus: 'Disponibili',
  blockReason: '',
  manualPlanningDate: '2026-01-01',
  billingStatus: 'Da fatturare',
  createdAt: '2026-01-01T00:00:00.000Z',
})
const setup=()=>{
 let data=createEstimate({...structuredClone(emptyData),customers:[{id:'c1',type:'Privato',name:'Cliente',phone:'',email:'',taxId:'',address:'',createdAt:'2026-10-04'}],vehicles:[{...vehicle('v1','c1'),status:'in lavorazione'}]},input)
 data=createQuoteDocument(data,{customerId:'c1',vehicleId:'v1',issueDate:'2026-10-04',dueDate:'2026-10-30',notes:'',lines:[{description:'Porta',quantity:1,unitPrice:150,vatRate:22}]})
 data.quotes![0].estimateId=data.estimates![0].id
 return data
}
describe('conferma cliente e allegati',()=>{
 it('crea una sola commessa, conserva la risposta e collega il preventivo',()=>{
  const data=setup();const accepted=confirmQuoteFromCustomerMessage(data,data.quotes![0].id,confirmation)
  expect(accepted.jobs).toHaveLength(1);expect(accepted.estimates![0].convertedJobId).toBe(accepted.jobs![0].id)
  expect(accepted.quotes![0].status).toBe('accettato');expect(accepted.quotes![0].customerConfirmation?.message).toBe(confirmation.message)
  expect(confirmQuoteFromCustomerMessage(accepted,data.quotes![0].id,confirmation).jobs).toHaveLength(1)
 })
 it('non avvia lavori senza risposta, data valida o preventivo operativo',()=>{
  const data=setup();const id=data.quotes![0].id
  expect(()=>confirmQuoteFromCustomerMessage(data,id,{...confirmation,message:''})).toThrow('messaggio')
  expect(()=>confirmQuoteFromCustomerMessage(data,id,{...confirmation,receivedAt:'non valida'})).toThrow('messaggio')
  delete data.quotes![0].estimateId;expect(()=>confirmQuoteFromCustomerMessage(data,id,confirmation)).toThrow('collegato')
  expect(data.jobs ?? []).toHaveLength(0)
 })
 it('protegge foto dopo conferma e genera un vero PDF',()=>{
  const data=setup();const q=data.quotes![0]
  expect(()=>attachQuotePhotos(data,q.id,['https://esterno/foto'])).toThrow('foto')
  const accepted=confirmQuoteFromCustomerMessage(data,q.id,confirmation)
  expect(()=>attachQuotePhotos(accepted,q.id,[])).toThrow('protette')
  const file=quotePdfFile(data,q);expect(file.type).toBe('application/pdf');expect(file.size).toBeGreaterThan(1000)
 })
})
