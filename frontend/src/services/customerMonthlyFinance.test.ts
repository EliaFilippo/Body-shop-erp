import { expect,it } from 'vitest'
import { emptyData } from './erp'
import { customerMonthlyFinance } from './customerMonthlyFinance'
import { createVehicleRiba } from './vehicleRiba'
it('includes unbilled RiBa and separates advances from definitive collections by month and customer',()=>{
 const data=structuredClone(emptyData)
 data.vehicles=[{id:'v',customerId:'c',createdAt:'2026-11-01',expectedRevenue:100,plate:'TEST'}] as typeof data.vehicles
 data.bankAccounts=[{id:'b',currentBalance:0}] as typeof data.bankAccounts
 const next=createVehicleRiba(data,{number:'R',bankAccountId:'b',presentationDate:'2026-11-01',dueDate:'2026-12-01',collectionDate:'2026-12-01',selections:[{key:'vehicle|v',amount:122}],mode:'advance',advanceDate:'2026-11-01',advanceAmount:100,fees:0,interest:0})
 expect(customerMonthlyFinance(next,'c','2026-11')).toMatchObject({loaded:122,advance:100,maturity:22,paid:0,toLoad:0})
 expect(customerMonthlyFinance(next,'other','2026-11').loaded).toBe(0)
 expect(customerMonthlyFinance(next,'c','2026-10').loaded).toBe(0)
})
it('uses invoice issue month for outstanding and collection date for actual payments',()=>{
 const data=structuredClone(emptyData)
 data.invoices=[{number:'F1',dueDate:'2026-12-01',taxableAmount:200,vatAmount:0,notes:'',createdAt:'',updatedAt:'',id:'i',customerId:'c',issueDate:'2026-10-01',paymentMethod:'Bonifico',total:200,collectedAmount:50,ribaAllocatedAmount:0,lines:[],status:'Da incassare'}] as typeof data.invoices
 data.financialEvents=[{id:'e',invoiceId:'i',date:'2026-11-01',type:'Incasso definitivo',amount:50}] as typeof data.financialEvents
 expect(customerMonthlyFinance(data,'c','2026-11')).toMatchObject({paid:50,unpaid:0})
 expect(customerMonthlyFinance(data,'c','2026-10').unpaid).toBe(150)
})
it('splits mixed-client batches without counting an invoice once per vehicle',()=>{
 const data=structuredClone(emptyData)
 data.invoices=[{number:'F1',dueDate:'2026-12-01',taxableAmount:200,vatAmount:0,notes:'',createdAt:'',updatedAt:'',id:'i',customerId:'c',issueDate:'2026-11-01',paymentMethod:'R.I.B.A.',total:200,collectedAmount:200,ribaAllocatedAmount:0,lines:[],status:'Incassata'}] as typeof data.invoices
 data.vehicles=[{id:'v',customerId:'other'}] as typeof data.vehicles
 data.ribaBatches=[{number:'B1',bankAccountId:'bank',dueDate:'2026-12-01',advanceDate:'2026-11-01',fees:0,interest:0,createdAt:'',updatedAt:'',id:'b',presentationDate:'2026-11-01',total:400,advancedAmount:100,status:'Anticipata',allocations:[{id:'a',invoiceId:'i',amount:200}],pendingVehicleLinks:[{plate:'TEST',vehicleId:'v',amount:200}]}] as typeof data.ribaBatches
 const summary=customerMonthlyFinance(data,'c','2026-11')
 expect(summary).toMatchObject({loaded:200,advance:50,maturity:150,paidInvoices:200,unpaid:0})
})
