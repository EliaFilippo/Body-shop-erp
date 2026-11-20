import { expect,it } from 'vitest'
import { emptyData } from './erp'
import { ribaCustomerIds,setRibaInvoiceReference } from './ribaManagement'
import { createVehicleRiba } from './vehicleRiba'
import { settleRibaBatch } from './finance'
function fixture(){
 const data=structuredClone(emptyData)
 data.vehicles=[{id:'v',customerId:'c',plate:'TEST',expectedRevenue:100}] as typeof data.vehicles
 data.bankAccounts=[{id:'b',currentBalance:1000}] as typeof data.bankAccounts
 return createVehicleRiba(data,{number:'R',bankAccountId:'b',presentationDate:'2026-11-01',dueDate:'2026-12-01',collectionDate:'2026-12-01',selections:[{key:'vehicle|v',amount:122}],mode:'maturity',advanceDate:'2026-11-01',fees:0,interest:0})
}
it('lists loaded customers and saves invoice references without issuing a new invoice',()=>{
 const data=fixture(),batch=data.ribaBatches[0]
 expect(ribaCustomerIds(data).has('c')).toBe(true)
 const next=setRibaInvoiceReference(data,batch.id,'v',' F123 ')
 expect(next.ribaBatches[0].invoiceReferences).toEqual([{vehicleId:'v',number:'F123'}])
 expect(next.invoices).toEqual(data.invoices)
 expect(next.bankAccounts).toEqual(data.bankAccounts)
 expect(()=>setRibaInvoiceReference(data,batch.id,'other','F123')).toThrow()
})
it('registers settlement once, including before invoice creation',()=>{
 const data=fixture(),batch=data.ribaBatches[0]
 const next=settleRibaBatch(data,batch.id,'2026-11-01')
 expect(next.ribaBatches[0].status).toBe('Chiusa')
 expect(next.bankAccounts[0].currentBalance).toBe(1122)
 expect(()=>settleRibaBatch(next,batch.id,'2026-11-01')).toThrow()
 expect(ribaCustomerIds(next).has('c')).toBe(true)
})
