import { deliveredWorkPhases } from './deliveredJobReport'
import { recordedPhaseLabor } from './closedJobMargin'
import { historicalRevenues, isRealizedInvoice } from './historicalActuals'
import { receivableFlows, ribaDueAlerts } from './receivableFlows'
import type { ErpData } from '../types'
import { calculateOwnerWithdrawalSnapshot } from './finance'
import { calculateVatQuarterOutflows } from './vatQuarterly'
const round = (n: number) => Math.round(n * 100) / 100
const add = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10) }
export const RIBA_CREDIT_LIMIT = 40000
export const CASH_RESERVE = 5000
const romeDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' })

function ownerEarned(data: ErpData, today: string) {
 const operators = data.plannerSettings.operators
 const ownerIds = new Set(operators.filter(operator => operator.isOwner).map(operator => operator.id))
 if (ownerIds.size !== 1) return null
 let earned = 0
 for (const job of data.jobs ?? []) {
  if (job.status === 'Annullata') continue
  for (const phase of deliveredWorkPhases(job)) {
   const stamp = Date.parse(phase.completedAt ?? phase.endedAt ?? '')
   if (phase.status !== 'Completata' || !Number.isFinite(stamp)) continue
   const day = romeDate.format(new Date(stamp))
   if (day > today || day.slice(0, 7) !== today.slice(0, 7)) continue
   for (const worker of recordedPhaseLabor(phase, operators).workers) {
    if (ownerIds.has(worker.id) && worker.rate !== null) earned += worker.seconds / 3600 * worker.rate
   }
  }
 }
 return round(earned)
}
export function ribaExposure(data: ErpData, bankId?: string) {
 return round(data.ribaBatches.filter(b => (!bankId || b.bankAccountId===bankId) && b.status === 'Anticipata').reduce((sum,b)=>sum+b.advancedAmount,0))
}
export function treasuryPlan(data: ErpData, today: string, horizon = 90) {
 const alerts: { id: string; kind: 'Pagamento'|'R.I.B.A. da presentare'|'R.I.B.A. in scadenza'; date: string; amount: number; title: string }[]=[]
 const flows = new Map<string,number>()
 let committedOutflows = 0
 const end = add(today, horizon)
 const flow = (date: string, amount: number) => {
  if (!date || date > end) return
  const key = date < today ? today : date
  flows.set(key, (flows.get(key) ?? 0) + amount)
  if (amount < 0) committedOutflows += amount
 }
 for (const payable of data.payables??[]) for (const installment of payable.installments) {
  if (installment.status==='Pagato') continue
  flow(installment.dueDate,-installment.amount)
  if (installment.dueDate<=add(today,15)) alerts.push({ id:installment.id,kind:'Pagamento',date:installment.dueDate,amount:installment.amount,title:`${payable.supplierName||payable.description} · ${payable.invoiceNumber||''}` })
 }
 for(const event of data.financialEvents) if(event.type==='Uscita prevista') flow(event.date,-event.amount)
 for(const vat of calculateVatQuarterOutflows(data)) flow(vat.dueDate,-vat.amount)
 const owner=calculateOwnerWithdrawalSnapshot(data,today)
 const candidates: { id:string; kind:'Distinta'|'Fattura'; number:string; date:string; amount:number }[]=[]
 for (const receipt of receivableFlows(data)) if (receipt.kind !== 'forecast' && receipt.dueDate >= today) flow(receipt.dueDate, receipt.amount)
 for(const batch of ribaDueAlerts(data,today))alerts.push({id:`bank-${batch.id}`,kind:'R.I.B.A. in scadenza',date:batch.dueDate,amount:batch.total,title:`Distinta ${batch.number}`})
 for(const invoice of data.invoices) {
  if(!isRealizedInvoice(invoice) || ['Incassata','Insoluta','Contestata'].includes(invoice.status)) continue
  const residual=Math.max(0,invoice.total-invoice.collectedAmount)
  const available=Math.max(0,residual-invoice.ribaAllocatedAmount)
  if(invoice.paymentMethod==='R.I.B.A.' && available>0) {
   if(invoice.dueDate<=add(today,15)) alerts.push({id:invoice.id,kind:'R.I.B.A. da presentare',date:invoice.dueDate,amount:available,title:`Fattura ${invoice.number}: presenta entro ${add(invoice.dueDate,-15)}`})
   if(invoice.dueDate>=today) candidates.push({id:invoice.id,kind:'Fattura',number:invoice.number,date:invoice.dueDate,amount:round(available)})
  }
 }
 for(const batch of data.ribaBatches) if(batch.status==='Presentata' && batch.dueDate>=today) candidates.push({id:batch.id,kind:'Distinta',number:batch.number,date:batch.collectionDate || batch.dueDate,amount:batch.total})
 const recognizedOwnerPay = ownerEarned(data, today)
 const cash = data.bankAccounts.reduce((sum, bank) => sum + bank.currentBalance, 0)
 // A withdrawal today must leave the reserve intact before subsequent receipts.
 const conservativeMinimum = cash + committedOutflows
 const withdrawable = !data.bankAccounts.length || recognizedOwnerPay === null ? null
  : owner.settled ? 0 : round(Math.max(0, Math.min(recognizedOwnerPay, conservativeMinimum - CASH_RESERVE)))
 if (!owner.settled && withdrawable !== null) flow(owner.plannedDate, -Math.min(owner.amount, withdrawable))
 let balance=data.bankAccounts.reduce((sum,b)=>sum+b.currentBalance,0), minimum=balance, criticalDate=today
 for(const [date,delta] of [...flows].sort(([a],[b])=>a.localeCompare(b))) { balance+=delta; if(balance<minimum) {minimum=balance;criticalDate=date} }
 const needed=round(Math.max(0,CASH_RESERVE-minimum))
 const exposure=ribaExposure(data), available=round(Math.max(0,RIBA_CREDIT_LIMIT-exposure))
 // Suggest only receivables due AFTER the shortage; otherwise their maturity is already counted.
 const suitable=candidates.filter(c=>c.date>criticalDate).sort((a,b)=>a.date.localeCompare(b.date))
 const eligible=round(suitable.reduce((sum,c)=>sum+c.amount,0))
 let remaining=Math.min(needed,available,eligible)
 const proposed=suitable.flatMap(c=>{ const amount=round(Math.min(c.amount,remaining)); remaining=round(remaining-amount); return amount>0?[{...c,proposedAmount:amount}]:[] })
 const proposedAmount=round(proposed.reduce((sum,c)=>sum+c.proposedAmount,0))
 const shifted=new Map(flows)
 for(const item of proposed) if(item.date<=add(today,horizon)) shifted.set(item.date,(shifted.get(item.date)??0)-item.proposedAmount)
 let shiftedBalance=cash+proposedAmount,shiftedMinimum=shiftedBalance
 for(const [,delta] of [...shifted].sort(([a],[b])=>a.localeCompare(b))) {shiftedBalance+=delta;shiftedMinimum=Math.min(shiftedMinimum,shiftedBalance)}
 const month = today.slice(0, 7)
 const monthlyRevenue = data.invoices.filter(i => isRealizedInvoice(i) && i.issueDate.startsWith(month))
  .reduce((sum, i) => sum + i.taxableAmount, 0) + historicalRevenues(data).filter(row => row.date.startsWith(month)).reduce((sum, row) => sum + row.amount, 0)
 return {withdrawable, recognizedOwnerPay, reserve: CASH_RESERVE, minimum, alerts:alerts.sort((a,b)=>a.date.localeCompare(b.date)),exposure,available,needed,criticalDate,eligible,proposed,proposedAmount,uncovered:round(Math.max(0,CASH_RESERVE-shiftedMinimum)),revenueGap:round(Math.max(0,data.plannerSettings.monthlyRevenueGoal-monthlyRevenue)),hasBankBalance:data.bankAccounts.length>0}
}
