import { expect, it } from 'vitest'
import { emptyData } from './erp'
import { cancelVehicleRibaBatch, createVehicleRiba, vehicleRibaBatches, ribaVehicleOptions } from './vehicleRiba'
const fixture = () => {
 const data = structuredClone(emptyData)
 data.vehicles = [{id:'v',plate:'TEST'}] as typeof data.vehicles
 data.bankAccounts = [{id:'bank',currentBalance:1000}] as typeof data.bankAccounts
 return createVehicleRiba(data,{number:'R1',bankAccountId:'bank',presentationDate:'2026-11-01',dueDate:'2026-12-01',collectionDate:'2026-12-01',selections:[{key:'vehicle|v',amount:100}],mode:'maturity',advanceDate:'2026-11-01',fees:0,interest:0})
}
it('offers existing batches and releases pending vehicles without removing history or changing bank balance',()=>{
 const data=fixture(), batch=data.ribaBatches[0]
 expect(vehicleRibaBatches(data,'v')).toHaveLength(1)
 const next=cancelVehicleRibaBatch(data,batch.id)
 expect(next.ribaBatches[0].status).toBe('Stornata')
 expect(next.financialEvents[0].type).toBe('Storno')
 expect(next.bankAccounts).toEqual(data.bankAccounts)
 expect(vehicleRibaBatches(next,'v')).toHaveLength(0)
 expect(ribaVehicleOptions(next).some(o=>o.vehicleId==='v')).toBe(true)
 expect(()=>cancelVehicleRibaBatch(next,batch.id)).toThrow()
})
it('protects advanced and settled batches',()=>{
 for(const status of ['Anticipata','Chiusa'] as const){const data=fixture();data.ribaBatches[0].status=status;expect(()=>cancelVehicleRibaBatch(data,data.ribaBatches[0].id)).toThrow()}
 const data=fixture();data.ribaBatches[0].advancedAmount=20;expect(()=>cancelVehicleRibaBatch(data,data.ribaBatches[0].id)).toThrow()
})
it('releases only the cancelled allocations and preserves collections',()=>{
 const data=fixture(),batch=data.ribaBatches[0]
 batch.allocations=[{id:'a',invoiceId:'i',amount:100}]
 data.invoices=[{id:'i',total:300,collectedAmount:50,ribaAllocatedAmount:150,status:'Parzialmente inserita in R.I.B.A.'}] as typeof data.invoices
 const next=cancelVehicleRibaBatch(data,batch.id)
 expect(next.invoices[0]).toMatchObject({collectedAmount:50,ribaAllocatedAmount:50,status:'Parzialmente inserita in R.I.B.A.'})
})
