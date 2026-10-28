import type {ErpData,NightlyEconomicSnapshot} from '../types'
import type {ProductionPlanningState} from './productionPlanningState'
import {addDays,isWorkingDate,workingMinutesForDate} from './workCalendar'
const safe=(v:unknown)=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0
const round=(v:number)=>Math.round(v*100)/100
const ceil=(v:number)=>Math.ceil(v*100-1e-8)/100
/** Financial indicators, never a rewrite of quoted prices or frozen timer budgets. */
export function calculateNightlyEconomics(data:ErpData,state:ProductionPlanningState,plannedFor:string):NightlyEconomicSnapshot {
 const settings=data.plannerSettings,monthKey=plannedFor.slice(0,7),start=monthKey+'-01'
 const [year,month]=monthKey.split('-').map(Number)
 const end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)
 const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(state.serverNow))
 const asOfDay=parts.slice(0,10),fraction=(Number(parts.slice(11,13))*60+Number(parts.slice(14,16)))/1440
 const daysInMonth=Number(end.slice(-2))
 const elapsedFraction=asOfDay<start?0:asOfDay>end?1:(Number(asOfDay.slice(-2))-1+fraction)/daysInMonth
 const work=(state.dailyWork??[]).filter(e=>e.date>=start&&e.date<=end&&e.date<=asOfDay)
 const productiveHours=work.reduce((sum,e)=>sum+safe(e.productiveSeconds)/3600,0)
 const paidHours=work.reduce((sum,e)=>sum+safe(e.paidSeconds)/3600,0)
 const items=(settings.internalCostSettings?.monthlyCostItems??[]).filter(i=>i.active)
 const monthlyFixedCosts=items.reduce((sum,i)=>sum+safe(i.monthlyAmount),0)
 const payrollInMonthlyCosts=items.some(i=>(i.category==='personale'||i.coveredByOperatorRates===true)&&safe(i.monthlyAmount)>0)
 let laborCosts=0,missingLaborCost=false
 for(const entry of work){
  const op=settings.operators.find(o=>o.id===entry.operatorId)
  if(payrollInMonthlyCosts&&op?.costMode!=='external-extra')continue
  const rate=op?.costMode==='external-extra'?safe(op.externalHourlyCost??op.hourlyCost):safe(op?.hourlyCost)
  if(safe(entry.paidSeconds)>0&&rate<=0)missingLaborCost=true
  laborCosts+=safe(entry.paidSeconds)/3600*rate
 }
 const accruedCosts=monthlyFixedCosts*elapsedFraction+laborCosts
 const operators=settings.operators.filter(o=>o.active)
 const manual=settings.internalCostSettings?.productiveCapacity
 const calendarDates:string[]=[]
 for(let d=start;d<=end;d=addDays(d,1))if(isWorkingDate(d,settings))calendarDates.push(d)
 const theoretical=(date:string)=>operators.length?operators.reduce((sum,op)=>sum+workingMinutesForDate(date,settings,op)/60,0):
  isWorkingDate(date,settings)&&calendarDates.length?safe(manual?.productiveOperators)*safe(manual?.hoursPerOperatorPerDay)*safe(manual?.workingDaysPerMonth)/calendarDates.length:0
 const dates:Array<{date:string;hours:number}>=[]
 let elapsedScheduledHours=0,elapsedProductiveHours=0
 for(let d=start;d<=end;d=addDays(d,1)){
  const hours=theoretical(d)
  if(d<plannedFor&&d<asOfDay)elapsedScheduledHours+=hours
  if(d>=plannedFor&&hours>0)dates.push({date:d,hours})
 }
 for(const e of work)if(e.date<plannedFor&&e.date<asOfDay)elapsedProductiveHours+=safe(e.productiveSeconds)/3600
 const measured=elapsedScheduledHours>0&&elapsedProductiveHours>0
 const utilization=measured?Math.min(1,elapsedProductiveHours/elapsedScheduledHours):Math.min(1,safe(manual?.efficiencyPercent??settings.efficiencyPercent)/100)
 const forecast=dates.map(d=>({date:d.date,hours:Math.max(0,d.hours*utilization-work.filter(e=>e.date===d.date).reduce((sum,e)=>sum+safe(e.productiveSeconds)/3600,0))}))
 const remainingProductiveHours=forecast.reduce((sum,d)=>sum+d.hours,0)
 const monthlyGoal=safe(settings.monthlyRevenueGoal)
 const realizedNetRevenue=round((data.invoices??[]).filter(i=>i.issueDate>=start&&i.issueDate<=end&&i.issueDate<=asOfDay&&i.documentStatus!=='bozza'&&i.status!=='Stornata')
  .reduce((sum,i)=>sum+(Number.isFinite(i.taxableAmount)?i.taxableAmount:0),0))
 const residualRevenue=Math.max(0,monthlyGoal-realizedNetRevenue)
 const targetHourlyRate=monthlyGoal<=0?null:residualRevenue===0?0:remainingProductiveHours>0?ceil(residualRevenue/remainingProductiveHours):null
 let allocatedCents=0,cumulativeHours=0
 const dailyGoals=forecast.map(d=>{
  cumulativeHours+=d.hours
  const cumulativeCents=remainingProductiveHours>0?Math.round(residualRevenue*100*cumulativeHours/remainingProductiveHours):0
  const revenueGoal=targetHourlyRate===null?null:(cumulativeCents-allocatedCents)/100
  allocatedCents=cumulativeCents
  return {date:d.date,productiveHours:round(d.hours),revenueGoal}
 })
 const warnings:string[]=[]
 if(!state.dailyWork)warnings.push('Ore giornaliere dal server non ancora disponibili.')
 if(productiveHours<=0)warnings.push('Nessuna ora produttiva registrata nel mese: costo orario consuntivo non disponibile.')
 if(monthlyFixedCosts<=0)warnings.push('Configura i costi mensili aziendali per il costo orario consuntivo.')
 if(missingLaborCost)warnings.push('Manca il costo del personale per alcune ore registrate.')
 if(!measured)warnings.push('Capacità residua stimata con l’efficienza configurata: storico produttivo insufficiente.')
 if(monthlyGoal<=0)warnings.push('Imposta l’obiettivo di fatturato mensile.')
 if(monthlyGoal>0&&monthlyFixedCosts>monthlyGoal)warnings.push('L’obiettivo mensile è inferiore ai costi mensili configurati.')
 if(remainingProductiveHours<=0&&residualRevenue>0)warnings.push('Nessuna capacità produttiva residua nel mese: obiettivo da ripianificare.')
 return {monthKey,plannedFor,asOf:state.serverNow,monthlyGoal,realizedNetRevenue,residualRevenue:round(residualRevenue),
  productiveHours:round(productiveHours),paidHours:round(paidHours),accruedOperatingCosts:round(accruedCosts),payrollInMonthlyCosts,
  realHourlyCost:productiveHours>0&&monthlyFixedCosts>0&&!missingLaborCost?round(accruedCosts/productiveHours):null,
  targetHourlyRate,remainingProductiveHours:round(remainingProductiveHours),utilizationPercent:round(utilization*100),capacitySource:measured?'observed':'configured',
  dailyGoal:targetHourlyRate===null?null:dailyGoals.find(d=>d.date===plannedFor)?.revenueGoal??0,dailyGoals,warnings}
}
