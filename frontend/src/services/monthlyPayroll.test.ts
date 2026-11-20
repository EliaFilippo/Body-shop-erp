import { describe, expect, it } from 'vitest'
import { payrollEstimate, saveMonthlyPayroll } from './monthlyPayroll'
import { emptyData } from './erp'

describe('consuntivo personale mensile',()=>{
 it('sostituisce il mese e conserva lo storico, anche con costo zero',()=>{
  const data=structuredClone(emptyData)
  const first=saveMonthlyPayroll(data,'2026-10',5600,600,5000,'2026-11-20T12:00:00Z')
  expect(first.plannerSettings.monthlyPayrollActuals?.[0].productionFactor).toBe(1)
  const second=saveMonthlyPayroll(first,'2026-10',0,0,5000,'2026-11-21T12:00:00Z')
  expect(second.plannerSettings.monthlyPayrollActuals).toHaveLength(1)
  expect(second.plannerSettings.monthlyPayrollActuals?.[0].history).toHaveLength(2)
  expect(second.plannerSettings.monthlyPayrollActuals?.[0].productionFactor).toBe(0)
 })
 it('rifiuta mesi aperti e importi incoerenti',()=>{
  expect(()=>saveMonthlyPayroll(emptyData,'2026-11',100,0,10,'2026-11-20T12:00:00Z')).toThrow()
  expect(()=>saveMonthlyPayroll(emptyData,'2026-10',100,101,10,'2026-11-20T12:00:00Z')).toThrow()
 })
 it('esclude gli esterni e non duplica le ore storiche dei tablet',()=>{
  const data=structuredClone(emptyData)
  data.plannerSettings.operators=[{id:'a',name:'A',active:true,dailyHours:8,hourlyCost:20},{id:'b',name:'B',active:true,dailyHours:8,hourlyCost:40,costMode:'external-extra'}]
  data.historicalActuals=[{id:'h',kind:'hours',date:'2026-10-01',operatorId:'a',paidSeconds:7200,productiveSeconds:3600}]
  expect(payrollEstimate(data,'2026-10',[{date:'2026-10-01',operatorId:'a',paidSeconds:3600,productiveSeconds:3600},{date:'2026-10-01',operatorId:'b',paidSeconds:3600,productiveSeconds:3600}])).toBe(20)
 })
})

import { calculateNightlyEconomics } from './nightlyEconomics'
import { recordedPhaseLabor } from './closedJobMargin'
import type { JobPhase } from '../types'
it('il costo effettivo sostituisce la stima mensile e mantiene gli esterni',()=>{
 const data=structuredClone(emptyData)
 data.plannerSettings.operators=[{id:'a',name:'A',active:true,dailyHours:8,hourlyCost:20},{id:'b',name:'B',active:true,dailyHours:8,hourlyCost:40,costMode:'external-extra'}]
 const actual=saveMonthlyPayroll(data,'2026-10',5600,600,5000,'2026-11-20T12:00:00Z')
 const state={serverNow:'2026-11-20T12:00:00Z',entries:[],dailyWork:[{date:'2026-10-01',operatorId:'a',paidSeconds:3600,productiveSeconds:3600},{date:'2026-10-01',operatorId:'b',paidSeconds:3600,productiveSeconds:3600}]}
 const before=calculateNightlyEconomics(data,state,'2026-10-01')
 const after=calculateNightlyEconomics(actual,state,'2026-10-01')
 expect(after.accruedOperatingCosts-before.accruedOperatingCosts).toBe(5580)
})
it('corregge il costo sulle fasi del mese lasciando gli esterni invariati',()=>{
 const operators=[{id:'a',name:'A',active:true,dailyHours:8,hourlyCost:20}]
 const phase={operatorAssignments:[{id:'tablet:a',operatorName:'A',startedAt:'2026-10-20T08:00:00Z',endedAt:'2026-10-20T09:00:00Z',workedMinutes:60,activityStatus:'Concluso'}]} as JobPhase
 const actual=saveMonthlyPayroll(emptyData,'2026-10',6000,0,5000,'2026-11-20T12:00:00Z').plannerSettings.monthlyPayrollActuals
 expect(recordedPhaseLabor(phase,operators,actual).workers[0].rate).toBe(24)
 expect(recordedPhaseLabor(phase,[{...operators[0],costMode:'external-extra'}],actual).workers[0].rate).toBe(20)
 phase.operatorAssignments[0].startedAt='2026-09-30T08:00:00Z'
 expect(recordedPhaseLabor(phase,operators,actual).workers[0].rate).toBe(20)
})
