import { describe,it,expect } from 'vitest'
import { emptyData } from './erp'
import { monthlyTargetRate } from './monthlyTargetRate'
describe('tariffa per l’obiettivo fatturato mensile',()=>{
 it('divide il fatturato obiettivo per le ore produttive e non usa il costo orario manuale',()=>{
  const settings=structuredClone(emptyData.plannerSettings)
  settings.monthlyRevenueGoal=30000
  settings.internalCostSettings={...settings.internalCostSettings!,usePlannerCapacity:false,useManualHourlyRate:true,manualHourlyRate:999,productiveCapacity:{productiveOperators:3,hoursPerOperatorPerDay:8,workingDaysPerMonth:20,efficiencyPercent:50}}
  expect(monthlyTargetRate(settings,'2026-10')).toMatchObject({goal:30000,hours:240,hourlyRate:125})
  settings.monthlyRevenueGoal=60000
  expect(monthlyTargetRate(settings,'2026-10').hourlyRate).toBe(250)
 })
 it('non presenta zero come tariffa valida con obiettivo o capacità mancanti',()=>{
  const settings=structuredClone(emptyData.plannerSettings)
  settings.monthlyRevenueGoal=0
  expect(monthlyTargetRate(settings,'2026-10').hourlyRate).toBeNull()
  settings.monthlyRevenueGoal=30000
  settings.internalCostSettings={...settings.internalCostSettings!,usePlannerCapacity:false,productiveCapacity:{productiveOperators:0,hoursPerOperatorPerDay:8,workingDaysPerMonth:20,efficiencyPercent:100}}
  expect(monthlyTargetRate(settings,'2026-10').hourlyRate).toBeNull()
 })
})
