import { describe, expect, it } from 'vitest'
import { emptyData } from './erp'
import { createEstimate, updateEstimate } from './workflow'
import { calculateCashFlowSnapshot } from './cashflow'

const input = { customerId:'c1', vehicleId:'v1', plate:'AA123BB', companyName:'',contactName:'',date:'2026-10-04',notes:'',paymentTerms:{method:'Bonifico' as const,days:30,endOfMonth:false,expectedInvoiceDate:'2026-10-10'},lines:[{description:'Porta',category:'carrozzeria' as const,quantity:1,unitPrice:150,discount:0,vatRate:22}] }
const quoteData = () => createEstimate(structuredClone(emptyData),input)
describe('pagamenti preventivi confermati',()=>{
 it('include solo confermati, distribuisce 30/60/90 giorni e non inventa incassi',()=>{
  const data=quoteData()
  expect(calculateCashFlowSnapshot(data,'2026-10-04').windows.map(w=>w.inflow)).toEqual([0,0,0])
  data.estimates![0].status='Approvato'
  expect(calculateCashFlowSnapshot(data,'2026-10-04').windows.map(w=>w.inflow)).toEqual([0,183,183])
  expect(calculateCashFlowSnapshot(data,'2026-10-04').collected).toBe(0)
  data.estimates![0].paymentTerms!.days=60
  expect(calculateCashFlowSnapshot(data,'2026-10-04').windows.map(w=>w.inflow)).toEqual([0,0,183])
 })
 it('gestisce fine mese, esclude fatturati e preventivi senza data',()=>{
  const data=quoteData();data.estimates![0].status='Approvato';data.estimates![0].paymentTerms!.endOfMonth=true
  expect(calculateCashFlowSnapshot(data,'2026-10-04').windows.map(w=>w.inflow)).toEqual([0,183,183])
  data.invoices=[{ id:'i1', customerId:'c1',number:'1',issueDate:'2026-10-10',dueDate:'2026-11-09',paymentMethod:'Bonifico',quoteId:data.estimates![0].id, status:'Incassata', lines:[],taxableAmount:150,vatAmount:33,total:183,collectedAmount:183,ribaAllocatedAmount:0,notes:'',createdAt:'2026-10-10',updatedAt:'2026-10-10' }]
  expect(calculateCashFlowSnapshot(data,'2026-10-04').windows.map(w=>w.inflow)).toEqual([0,0,0])
  data.invoices=[];data.estimates![0].paymentTerms!.expectedInvoiceDate=''
  expect(calculateCashFlowSnapshot(data,'2026-10-04').windows.map(w=>w.inflow)).toEqual([0,0,0])
 })
 it('richiede revisione titolare sui confermati e mantiene il collegamento commessa',()=>{
  const data=quoteData();const original=data.estimates![0];original.status='Approvato';original.convertedJobId='j1'
  const payload={...input,lines:original.lines.map(line=>({...line,unitPrice:200}))}
  expect(()=>updateEstimate(data,original.id,payload)).toThrow('Solo il titolare')
  const revised=updateEstimate(data,original.id,payload,true).estimates![0]
  expect(revised.convertedJobId).toBe('j1');expect(revised.total).toBe(244)
  expect(revised.history[0].actor).toBe('Titolare')
 })
 it('rifiuta termini invalidi',()=>{
  expect(()=>createEstimate(structuredClone(emptyData),{...input,paymentTerms:{...input.paymentTerms,days:-1}})).toThrow('condizioni di pagamento')
 })
})
