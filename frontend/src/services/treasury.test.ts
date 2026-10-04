import { describe, expect, it } from 'vitest'
import { emptyData } from './erp'
import { createPayableEntry, registerRibaAdvance } from './finance'
import { treasuryPlan } from './treasury'
import type { Invoice, RibaBatch } from '../types'
const invoice=(id:string,total:number,dueDate:string):Invoice=>({id,customerId:'c1',number:id,issueDate:'2026-10-01',dueDate,paymentMethod:'R.I.B.A.',lines:[],taxableAmount:total,vatAmount:0,total,collectedAmount:0,ribaAllocatedAmount:0,status:'Da incassare',notes:'',createdAt:'2026-10-01',updatedAt:'2026-10-01'})
const batch=(amount=10000):RibaBatch=>({id:'b1',number:'b1',bankAccountId:'bank1',presentationDate:'2026-10-01',dueDate:'2026-11-30',allocations:[{id:'a1',invoiceId:'i1',amount}],total:amount,advancedAmount:0,advanceDate:'',fees:0,interest:0,status:'Presentata',createdAt:'2026-10-01',updatedAt:'2026-10-01'})
const data=()=>({...structuredClone(emptyData),plannerSettings:{...structuredClone(emptyData.plannerSettings),ownerWithdrawalAmount:0},bankAccounts:[{id:'bank1',name:'Banca',iban:'',creditLimit:40000,blockOverLimit:true,minimumBalanceAlert:0,currentBalance:0,createdAt:'2026-10-01'}]})
const bill=(amount:number,date:string)=>createPayableEntry(data(),{kind:'supplier-invoice',category:'fornitori',description:'Fornitore',totalAmount:amount,paymentMethod:'Bonifico',dueDate:date,installments:[{installmentNo:1,amount,dueDate:date}]})
describe('tesoreria e avvisi 15 giorni',()=>{
 it('propone il fabbisogno prima del pagamento senza contare due volte la RIBA',()=>{
  const d=bill(10000,'2026-10-15');d.invoices=[invoice('i1',15000,'2026-11-30')]
  const p=treasuryPlan(d,'2026-10-04');expect(p.needed).toBe(10000);expect(p.proposedAmount).toBe(10000);expect(p.uncovered).toBe(0)
  expect(p.proposed[0].proposedAmount).toBe(10000)
 })
 it('limita la proposta al castelletto e non usa anticipi come fatturato',()=>{
  const d=bill(50000,'2026-10-15');d.invoices=[invoice('i1',70000,'2027-02-01')];d.plannerSettings.monthlyRevenueGoal=80000
  const p=treasuryPlan(d,'2026-10-04');expect(p.proposedAmount).toBe(40000);expect(p.uncovered).toBe(10000);expect(p.revenueGap).toBe(10000)
 })
 it('esclude dalla scadenza la parte già anticipata e avvisa soltanto RIBA non presentate',()=>{
  const d=bill(10000,'2026-10-15');d.bankAccounts[0].currentBalance=5000;d.invoices=[{...invoice('i1',10000,'2026-10-19'),ribaAllocatedAmount:10000,status:'Anticipata'}];d.ribaBatches=[{...batch(),status:'Anticipata',advancedAmount:10000}]
  const p=treasuryPlan(d,'2026-10-04');expect(p.needed).toBe(5000);expect(p.proposed.length).toBe(0);expect(p.alerts.filter(a=>a.kind==='R.I.B.A. da presentare')).toHaveLength(0)
 })
 it('avvisa al giorno 15 e rimuove le fatture pagate',()=>{
  const d=bill(200,'2026-10-19');d.invoices=[invoice('i1',100,'2026-10-19'),invoice('i2',100,'2026-10-20')]
  expect(treasuryPlan(d,'2026-10-04').alerts).toHaveLength(2)
  d.payables![0].installments[0].status='Pagato';d.invoices[0].ribaAllocatedAmount=100
  expect(treasuryPlan(d,'2026-10-04').alerts).toHaveLength(0)
 })
 it('blocca anticipi duplicati e oltre il castelletto',()=>{
  const d=data();d.ribaBatches=[batch(50000)]
  expect(()=>registerRibaAdvance(d,'b1',45000,'2026-10-04')).toThrow('castelletto')
  const once=registerRibaAdvance(d,'b1',10000,'2026-10-04');expect(()=>registerRibaAdvance(once,'b1',10000,'2026-10-04')).toThrow('una sola volta')
 })
})
