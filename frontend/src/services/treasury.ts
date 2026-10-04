import type { ErpData } from '../types'
import { calculateOwnerWithdrawalSnapshot } from './finance'
import { calculateVatQuarterOutflows } from './vatQuarterly'
const round = (n: number) => Math.round(n * 100) / 100
const add = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10) }
export const RIBA_CREDIT_LIMIT = 40000
export function ribaExposure(data: ErpData, bankId?: string) {
 return round(data.ribaBatches.filter(b => (!bankId || b.bankAccountId===bankId) && !['Chiusa','Stornata'].includes(b.status)).reduce((sum,b)=>sum+b.advancedAmount,0))
}
export function treasuryPlan(data: ErpData, today: string, horizon = 90) {
 const alerts: { id: string; kind: 'Pagamento'|'R.I.B.A. da presentare'; date: string; amount: number; title: string }[]=[]
 const flows = new Map<string,number>()
 const flow = (date: string, amount: number) => { if (date <= add(today,horizon)) { const key=date<today?today:date; flows.set(key,(flows.get(key)??0)+amount) } }
 for (const payable of data.payables??[]) for (const installment of payable.installments) {
  if (installment.status==='Pagato') continue
  flow(installment.dueDate,-installment.amount)
  if (installment.dueDate<=add(today,15)) alerts.push({ id:installment.id,kind:'Pagamento',date:installment.dueDate,amount:installment.amount,title:`${payable.supplierName||payable.description} · ${payable.invoiceNumber||''}` })
 }
 for(const event of data.financialEvents) if(event.type==='Uscita prevista') flow(event.date,-event.amount)
 for(const vat of calculateVatQuarterOutflows(data)) flow(vat.dueDate,-vat.amount)
 const owner=calculateOwnerWithdrawalSnapshot(data,today); if(!owner.settled) flow(owner.plannedDate,-owner.amount)
 const candidates: { id:string; kind:'Distinta'|'Fattura'; number:string; date:string; amount:number }[]=[]
 for(const invoice of data.invoices) {
  if(['Incassata','Stornata','Insoluta','Contestata'].includes(invoice.status)) continue
  const residual=Math.max(0,invoice.total-invoice.collectedAmount)
  // Already advanced cash is in the bank balance: exclude that portion at maturity.
  const advanced=data.ribaBatches.filter(b=>b.status==='Anticipata').reduce((sum,b)=>sum+b.allocations.filter(a=>a.invoiceId===invoice.id).reduce((s,a)=>s+a.amount,0)*Math.min(1,b.advancedAmount/Math.max(.01,b.total)),0)
  if(invoice.dueDate>=today) flow(invoice.dueDate,Math.max(0,residual-advanced))
  const available=Math.max(0,residual-invoice.ribaAllocatedAmount)
  if(invoice.paymentMethod==='R.I.B.A.' && available>0) {
   if(invoice.dueDate<=add(today,15)) alerts.push({id:invoice.id,kind:'R.I.B.A. da presentare',date:invoice.dueDate,amount:available,title:`Fattura ${invoice.number}: presenta entro ${add(invoice.dueDate,-15)}`})
   if(invoice.dueDate>=today) candidates.push({id:invoice.id,kind:'Fattura',number:invoice.number,date:invoice.dueDate,amount:round(available)})
  }
 }
 for(const batch of data.ribaBatches) if(batch.status==='Presentata' && batch.dueDate>=today) candidates.push({id:batch.id,kind:'Distinta',number:batch.number,date:batch.dueDate,amount:batch.total})
 let balance=data.bankAccounts.reduce((sum,b)=>sum+b.currentBalance,0), minimum=balance, criticalDate=today
 for(const [date,delta] of [...flows].sort(([a],[b])=>a.localeCompare(b))) { balance+=delta; if(balance<minimum) {minimum=balance;criticalDate=date} }
 const needed=round(Math.max(0,-minimum))
 const exposure=ribaExposure(data), available=round(Math.max(0,RIBA_CREDIT_LIMIT-exposure))
 // Suggest only receivables due AFTER the shortage; otherwise their maturity is already counted.
 const suitable=candidates.filter(c=>c.date>criticalDate).sort((a,b)=>a.date.localeCompare(b.date))
 const eligible=round(suitable.reduce((sum,c)=>sum+c.amount,0))
 let remaining=Math.min(needed,available,eligible)
 const proposed=suitable.flatMap(c=>{ const amount=round(Math.min(c.amount,remaining)); remaining=round(remaining-amount); return amount>0?[{...c,proposedAmount:amount}]:[] })
 const proposedAmount=round(proposed.reduce((sum,c)=>sum+c.proposedAmount,0))
 const shifted=new Map(flows);shifted.set(today,(shifted.get(today)??0)+proposedAmount)
 for(const item of proposed) if(item.date<=add(today,horizon)) shifted.set(item.date,(shifted.get(item.date)??0)-item.proposedAmount)
 let shiftedBalance=data.bankAccounts.reduce((sum,b)=>sum+b.currentBalance,0),shiftedMinimum=shiftedBalance
 for(const [,delta] of [...shifted].sort(([a],[b])=>a.localeCompare(b))) {shiftedBalance+=delta;shiftedMinimum=Math.min(shiftedMinimum,shiftedBalance)}
 const monthlyRevenue=data.invoices.filter(i=>i.status!=='Stornata'&&i.issueDate.slice(0,7)===today.slice(0,7)).reduce((sum,i)=>sum+i.taxableAmount,0)
 return {alerts:alerts.sort((a,b)=>a.date.localeCompare(b.date)),exposure,available,needed,criticalDate,eligible,proposed,proposedAmount,uncovered:round(Math.max(0,-shiftedMinimum)),revenueGap:round(Math.max(0,data.plannerSettings.monthlyRevenueGoal-monthlyRevenue)),hasBankBalance:data.bankAccounts.length>0}
}
