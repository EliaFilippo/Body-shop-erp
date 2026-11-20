import { expect,it } from 'vitest'
import type {RepairJob,Vehicle} from '../types'
import {emptyData} from './erp'
import {vehicleOperatingProfit} from './vehicleOperatingProfit'
function fixture(){
 const settings=structuredClone(emptyData.plannerSettings)
 settings.operators=[{id:'a',name:'Anna',dailyHours:8,active:true,hourlyCost:20}]
 settings.internalCostSettings={internalHourlyRate:0,minimumMarginPercent:0,usePlannerCapacity:false,productiveCapacity:{productiveOperators:1,hoursPerOperatorPerDay:10,workingDaysPerMonth:20,efficiencyPercent:100},monthlyCostItems:[{id:'pay',category:'personale',description:'Stipendi',monthlyAmount:4000,active:true},{id:'rent',category:'affitto',description:'Affitto',monthlyAmount:2000,active:true}]}
 const job={id:'j',vehicleId:'v',plate:'TEST',entryDate:'2026-11-10',deliveredAt:'2026-11-18T16:00:00Z',taxableAmount:500,lines:[],phases:[{id:'p',name:'Lucidatura',estimatedMinutes:60,tabletWorkedSeconds:7200,operatorAssignments:[{id:'tablet:a',operatorName:'Anna',workedMinutes:120,endedAt:'2026-11-18T15:00:00Z'}]}]} as unknown as RepairJob
 const vehicle={id:'v',plate:'TEST',status:'In lavorazione',costEntries:[{category:'vernice',usedAt:'2026-11-18',total:80},{category:'ricambi',usedAt:'2026-11-18',total:50},{category:'trasporto',usedAt:'2026-11-18',total:10}]} as unknown as Vehicle
 return {settings,job,vehicle}
}
it('subtracts actual materials, parts, labor, other costs and non-payroll overhead once',()=>{
 const {settings,job,vehicle}=fixture()
 const result=vehicleOperatingProfit(vehicle,job,[job],settings)
 expect(result).toMatchObject({materialCents:8000,partsCents:5000,laborCents:4000,otherCents:1000,overheadCents:2000,profitCents:30000,percent:60})
 job.materialActualCost={amount:80,at:'',note:''}
 expect(vehicleOperatingProfit(vehicle,job,[job],settings).profitCents).toBe(30000)
})
it('preserves losses and does not present missing labor or overhead as zero',()=>{
 const {settings,job,vehicle}=fixture()
 job.taxableAmount=100
 expect(vehicleOperatingProfit(vehicle,job,[job],settings).profitCents).toBe(-10000)
 settings.operators[0].hourlyCost=undefined
 expect(vehicleOperatingProfit(vehicle,job,[job],settings).profitCents).toBeNull()
 settings.operators[0].hourlyCost=20
 settings.internalCostSettings!.monthlyCostItems=[]
 expect(vehicleOperatingProfit(vehicle,job,[job],settings).profitCents).toBeNull()
})

it('values unrecorded work at zero after delivery without rewriting timers',()=>{
 const {settings,job,vehicle}=fixture()
 job.phases[0].tabletWorkedSeconds=undefined
 job.phases[0].operatorAssignments=[]
 job.phases[0].status='Completata'
 job.status='Consegnata'
 const result=vehicleOperatingProfit(vehicle,job,[job],settings)
 expect(result.profitCents).toBe(36000)
 expect(result.missing).toEqual([])
 expect(job.status).toBe('Consegnata')
 expect(job.phases[0].tabletWorkedSeconds).toBeUndefined()
})

it('never falls back to budget costs on closed cars and retains all recorded charges',()=>{
 const {settings,job,vehicle}=fixture()
 job.status='Pronta consegna'
 job.lines=[{category:'ricambi',quantity:1,budgetDirectUnitCost:900,unitPrice:1000}] as RepairJob['lines']
 vehicle.costEntries=[]
 const result=vehicleOperatingProfit(vehicle,job,[job],settings)
 expect(result).toMatchObject({materialCents:0,partsCents:0,otherCents:0,laborCents:4000,overheadCents:2000,profitCents:44000})
 settings.operators[0].hourlyCost=undefined
 expect(vehicleOperatingProfit(vehicle,job,[job],settings).laborCents).toBe(0)
})

it('uses a single contribution before general expenses for both total and hourly objective comparison',()=>{
 const {settings,job,vehicle}=fixture()
 job.status='Consegnata'
 const before=JSON.stringify({job,vehicle})
 const result=vehicleOperatingProfit(vehicle,job,[job],settings)
 expect(result.contributionCents).toBe(32000)
 expect(result.contributionCents! / 100 / (result.workedSeconds/3600)).toBe(160)
 settings.internalCostSettings!.monthlyCostItems![1].monthlyAmount=10000
 expect(vehicleOperatingProfit(vehicle,job,[job],settings).contributionCents).toBe(32000)
 expect(JSON.stringify({job,vehicle})).toBe(before)
})

it('subtracts registered materials in the margin when delivery precedes planned entry',()=>{
 const {settings,job,vehicle}=fixture()
 job.status='Consegnata'
 job.entryDate='2026-11-19'
 const before=JSON.stringify({job,vehicle})
 expect(vehicleOperatingProfit(vehicle,job,[job],settings)).toMatchObject({materialCents:8000,partsCents:5000,laborCents:4000,otherCents:1000,contributionCents:32000})
 expect(JSON.stringify({job,vehicle})).toBe(before)
})
