import {describe,it,expect} from 'vitest'
import {emptyData} from './erp'
import {calculateNightlyEconomics} from './nightlyEconomics'
import type {Invoice} from '../types'
import type {ProductionPlanningState} from './productionPlanningState'
const setup=()=>{
 const data=structuredClone(emptyData)
 data.plannerSettings.monthlyRevenueGoal=10000
 data.plannerSettings.efficiencyPercent=100
 data.plannerSettings.operators=[{id:'a',name:'A',active:true,dailyHours:8,hourlyCost:999}]
 data.plannerSettings.internalCostSettings={...data.plannerSettings.internalCostSettings!,monthlyCostItems:[
  {id:'rent',category:'affitto',description:'Struttura',active:true,monthlyAmount:2000},
  {id:'pay',category:'personale',description:'Personale',active:true,monthlyAmount:1000}],productiveCapacity:undefined}
 data.invoices=[{id:'i',issueDate:'2026-09-10',taxableAmount:4000,total:4880,documentStatus:'emessa',status:'Da incassare'} as Invoice,
 {id:'draft',issueDate:'2026-09-10',taxableAmount:5000,documentStatus:'bozza'} as Invoice,
 {id:'future',issueDate:'2026-09-30',taxableAmount:5000} as Invoice]
 const dates=['01','02','03','04','07','08','09','10','11','14']
 const state:ProductionPlanningState={serverNow:'2026-09-15T01:00:00Z',entries:[],dailyWork:dates.map(day=>({date:'2026-09-'+day,operatorId:'a',productiveSeconds:4*3600,paidSeconds:4.8*3600}))}
 return {data,state}
}
describe('nightly rates from actual work',()=>{
 it('separates accrued operating cost from the remaining revenue target, excludes VAT and does not duplicate payroll',()=>{
  const {data,state}=setup(),before=JSON.stringify(data)
  const result=calculateNightlyEconomics(data,state,'2026-09-15')
  expect(result).toMatchObject({productiveHours:40,paidHours:48,accruedOperatingCosts:1412.5,realHourlyCost:35.31,
   monthlyGoal:10000,realizedNetRevenue:4000,residualRevenue:6000,capacitySource:'observed',utilizationPercent:50,
   remainingProductiveHours:48,targetHourlyRate:125,dailyGoal:500,payrollInMonthlyCosts:true})
  expect(JSON.stringify(data)).toBe(before)
 })
 it('reacts to fewer productive hours and absences while allocating the exact remaining revenue',()=>{
  const {data,state}=setup()
  const baseline=calculateNightlyEconomics(data,state,'2026-09-15')
  const slow=calculateNightlyEconomics(data,{...state,dailyWork:state.dailyWork!.map(e=>({...e,productiveSeconds:e.productiveSeconds/2}))},'2026-09-15')
  expect(slow.targetHourlyRate).toBe(250)
  expect(slow.realHourlyCost).toBeGreaterThan(baseline.realHourlyCost!)
  data.plannerSettings.absences=[{id:'abs',operatorId:'a',startDate:'2026-09-16',endDate:'2026-09-16',hoursPerDay:null,reason:'Ferie'}]
  const absent=calculateNightlyEconomics(data,state,'2026-09-15')
  expect(absent.remainingProductiveHours).toBe(44)
  expect(absent.dailyGoals.some(d=>d.date==='2026-09-16')).toBe(false)
  expect(absent.targetHourlyRate).toBe(136.37)
  expect(Math.round(absent.dailyGoals.reduce((sum,d)=>sum+(d.revenueGoal??0),0)*100)).toBe(600000)
 })
 it('uses registered paid time for labor only when monthly payroll is absent',()=>{
  const {data,state}=setup()
  data.plannerSettings.internalCostSettings!.monthlyCostItems!.pop()
  data.plannerSettings.operators[0].hourlyCost=20
  const result=calculateNightlyEconomics(data,state,'2026-09-15')
  expect(result.accruedOperatingCosts).toBeCloseTo(2000*14.125/30+48*20,2)
  expect(result.payrollInMonthlyCosts).toBe(false)
 })
 it('never invents a cost or infinite rate with missing hours or zero remaining capacity',()=>{
  const {data,state}=setup()
  const empty=calculateNightlyEconomics(data,{...state,dailyWork:[]},'2026-09-15')
  expect(empty.realHourlyCost).toBeNull()
  expect(empty.capacitySource).toBe('configured')
  data.plannerSettings.operators[0].active=false
  const noCapacity=calculateNightlyEconomics(data,state,'2026-09-15')
  expect(noCapacity.targetHourlyRate).toBeNull()
  expect(noCapacity.dailyGoal).toBeNull()
  data.plannerSettings.monthlyRevenueGoal=3000
  expect(calculateNightlyEconomics(data,state,'2026-09-15').targetHourlyRate).toBe(0)
 })
 it('starts a new month without attributing last month’s hours or invoices to it',()=>{
  const {data,state}=setup()
  const next=calculateNightlyEconomics(data,state,'2026-10-01')
  expect(next.productiveHours).toBe(0)
  expect(next.realizedNetRevenue).toBe(0)
  expect(next.accruedOperatingCosts).toBe(0)
  expect(next.realHourlyCost).toBeNull()
  expect(next.capacitySource).toBe('configured')
 })
})

it('keeps an owner goal below configured costs and makes the shortfall visible',()=>{
 const {data,state}=setup()
 data.plannerSettings.internalCostSettings!.monthlyCostItems![0].monthlyAmount=15000
 const result=calculateNightlyEconomics(data,state,'2026-09-15')
 expect(result.monthlyGoal).toBe(10000)
 expect(result.warnings).toContain('L’obiettivo mensile è inferiore ai costi mensili configurati.')
})

it('does not charge costs or zero productivity before recording began',()=>{
 const {data,state}=setup()
 state.serverNow='2026-09-29T01:00:00Z'
 state.dailyWork=['24','25','28'].map(day=>({date:'2026-09-'+day,operatorId:'a',productiveSeconds:4*3600,paidSeconds:8*3600}))
 const result=calculateNightlyEconomics(data,state,'2026-09-29')
 expect(result.observationStart).toBe('2026-09-24')
 expect(result.accruedOperatingCosts).toBe(512.5)
 expect(result.realHourlyCost).toBe(42.71)
 expect(result.capacitySource).toBe('configured')
 expect(result.utilizationPercent).toBe(100)
})
it('uses each operator’s recording start for the observed denominator',()=>{
 const {data,state}=setup()
 data.plannerSettings.operators.push({id:'b',name:'B',active:true,dailyHours:8})
 state.dailyWork!.push({date:'2026-09-14',operatorId:'b',productiveSeconds:4*3600,paidSeconds:8*3600})
 expect(calculateNightlyEconomics(data,state,'2026-09-15').utilizationPercent).toBe(50)
 state.dailyWork=state.dailyWork!.filter(e=>e.operatorId!=='b')
 expect(calculateNightlyEconomics(data,state,'2026-09-15').capacitySource).toBe('configured')
})
