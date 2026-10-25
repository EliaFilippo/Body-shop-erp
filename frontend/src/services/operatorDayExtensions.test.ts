import { describe,it,expect } from 'vitest'
import { emptyData } from './erp'
import { getOperatorWorkingIntervals,workingMinutesForDate } from './workCalendar'
import { monthlyTargetRate } from './monthlyTargetRate'
import { applyDayExtensions } from './operatorDayExtensions'
describe('prosecuzione giornata e tariffa mensile',()=>{
 function fixture(){
  const data=structuredClone(emptyData)
  data.plannerSettings.operators=[{id:'a',name:'Operatore',active:true,dailyHours:8,weeklySchedule:[{dayOfWeek:1,active:true,intervals:[{startTime:'08:00',endTime:'16:00'}]}]}]
  data.plannerSettings.monthlyRevenueGoal=10000
  data.plannerSettings.internalCostSettings={...data.plannerSettings.internalCostSettings!,usePlannerCapacity:false,productiveCapacity:{productiveOperators:1,hoursPerOperatorPerDay:8,workingDaysPerMonth:20,efficiencyPercent:100}}
  return data
 }
 it('aggiunge solo oggi, non moltiplica sovrapposizioni e ricalcola capacità manuale',()=>{
  const data=fixture(),before=monthlyTargetRate(data.plannerSettings,'2026-10')
  const entries=[{id:'1',operatorId:'a',date:'2026-10-26',startMinute:960,endMinute:1020},{id:'2',operatorId:'a',date:'2026-10-26',startMinute:990,endMinute:1080}]
  const next=applyDayExtensions(data,entries,'2026-10-26','2026-10-26T16:00:00Z')
  expect(workingMinutesForDate('2026-10-26',next.plannerSettings,next.plannerSettings.operators[0])).toBe(600)
  expect(getOperatorWorkingIntervals('2026-11-02',next.plannerSettings,next.plannerSettings.operators[0])).toEqual([{startMinute:480,endMinute:960}])
  const after=monthlyTargetRate(next.plannerSettings,'2026-10')
  expect(after.hours-before.hours).toBe(2)
  expect(after.hourlyRate!).toBeLessThan(before.hourlyRate!)
  expect(monthlyTargetRate(next.plannerSettings,'2026-11').hours).toBe(160)
  expect(applyDayExtensions(next,entries,'2026-10-26')).toBe(next)
  expect(next.jobs).toEqual(data.jobs)
 })
 it('la capacità da calendario conta gli extra una sola volta e ignora operatori disattivati',()=>{
  const data=fixture();data.plannerSettings.internalCostSettings!.usePlannerCapacity=true
  const before=monthlyTargetRate(data.plannerSettings,'2026-10')
  data.plannerSettings.operatorDayExtensions=[{id:'x',operatorId:'a',date:'2026-10-26',startMinute:960,endMinute:1020},{id:'y',operatorId:'inactive',date:'2026-10-26',startMinute:960,endMinute:1200}]
  expect(monthlyTargetRate(data.plannerSettings,'2026-10').hours-before.hours).toBe(1)
 })
})
