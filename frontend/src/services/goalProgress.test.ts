import { expect, it } from 'vitest'
import type { JobPhase, RepairJob } from '../types'
import { emptyData } from './erp'
import { setJobMaterialActualCost } from './jobMaterialCosts'
import { vehicleOperatingProfit } from './vehicleOperatingProfit'
import { vehicleInvoiceTaxableAmount } from './finance'
import { calculateGoalProgress, remainingWeeklyMarginGoals } from './goalProgress'

function makeReportJob() {
  return { id: 'j1', status: 'Pianificata', taxableAmount: 500, lines: [], phases: [] } as unknown as RepairJob
}

const completedPhase: JobPhase = {
  id: 'body', name: 'Stuccatura', estimatedMinutes: 60, actualMinutes: 60,
  status: 'Completata', notes: '', blockedReason: '', completedAt: '2026-11-09T09:00:00Z',
  tabletWorkedSeconds: 3600,
  operatorAssignments: [{
    id: 'tablet:martin', operatorName: 'Martin', workedMinutes: 60, activityStatus: 'Concluso',
    startedAt: '2026-11-09T08:00:00Z', endedAt: '2026-11-09T09:00:00Z',
  }],
}

it('subtracts Martin, internal labor and materials and reconciles delivery without counting them twice', () => {
  const data = structuredClone(emptyData)
  data.plannerSettings.monthlyRevenueGoal = 20_000
  data.plannerSettings.monthlyMarginGoal = 3_000
  data.plannerSettings.internalCostSettings = {
    internalHourlyRate: 0, minimumMarginPercent: 0, useManualHourlyRate: true, manualHourlyRate: 30,
  }
  data.plannerSettings.operators = [{
    id: 'martin', name: 'Martin', costMode: 'external-extra', externalHourlyCost: 40, dailyHours: 8, active: true,
  }, { id: 'other', name: 'Altro', hourlyCost: 30, dailyHours: 8, active: true }]
  const job = makeReportJob()
  job.status = 'In lavorazione'
  job.materialActualCost = { amount: 100, at: '', note: '' }
  const other = { ...completedPhase.operatorAssignments[0], id: 'tablet:other', operatorName: 'Altro',
    startedAt: '2026-11-10T08:00:00Z', endedAt: '2026-11-10T09:00:00Z' }
  job.phases = [completedPhase, { ...completedPhase, id: 'paint', name: 'Verniciatura', status: 'In lavorazione',
    completedAt: undefined, operatorAssignments: [other] }]
  data.jobs = [job]
  expect(calculateGoalProgress(data, '2026-11-10').map(({ done }) => done)).toEqual([0, 160, 160])
  job.phases[1] = { ...job.phases[1], status: 'Completata', completedAt: other.endedAt }
  job.status = 'Consegnata'
  job.deliveredAt = '2026-11-10T10:00:00Z'
  const result = calculateGoalProgress(data, '2026-11-10')
  expect(result.map(({ done, billed }) => [done, billed])).toEqual([[170, 0], [330, 0], [330, 0]])
  expect(result[2]).toMatchObject({ goal: 3000, gap: 2670, percent: 11, incomplete: false })
  const historical = calculateGoalProgress(data, '2026-11-17', undefined, { day: '2026-11-09', week: '2026-11-10' })
  expect(historical.map(({ done }) => done)).toEqual([160, 330, 330])
  expect(historical[2]).toEqual(calculateGoalProgress(data, '2026-11-17')[2])
  expect(calculateGoalProgress(data, '2026-11-17', undefined, { week: '2026-11-02' })[1].done).toBe(0)
})

it('marks the period incomplete when a signed phase has hours without operator attribution', () => {
  const data = structuredClone(emptyData)
  data.plannerSettings.operators = [{
    id: 'martin', name: 'Martin', costMode: 'external-extra', externalHourlyCost: 40, dailyHours: 8, active: true,
  }]
  const job = makeReportJob()
  job.status = 'In lavorazione'
  job.phases = [{ ...completedPhase, operatorAssignments: [] }]
  data.jobs = [job]
  expect(calculateGoalProgress(data, '2026-11-09')[0]).toMatchObject({
    incomplete: true, hasMargin: false, percent: null,
  })
})

it('deducts four office hours plus production time outside cars alongside the loss of a delivered job', () => {
  const data = structuredClone(emptyData)
  data.plannerSettings.monthlyMarginGoal = 3000
  data.plannerSettings.closures = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
  data.plannerSettings.absences = [{ id: 'absence', operatorId: 'federica', startDate: '2026-11-11', endDate: '2026-11-11', hoursPerDay: null, reason: '' }]
  data.plannerSettings.operators = [
    { id: 'martin', name: 'Martin', costMode: 'external-extra', externalHourlyCost: 40, dailyHours: 8, active: true },
    { id: 'federica', name: 'FEDERICA', hourlyCost: 17, dailyHours: 3.5, active: true,
      weeklySchedule: [1, 2, 3, 4, 5].map(dayOfWeek => ({
        dayOfWeek, active: true, intervals: [{ startTime: '08:30', endTime: '12:30' }],
      })) },
  ]
  const job = makeReportJob()
  job.status = 'Consegnata'
  job.deliveredAt = '2026-11-09T10:00:00Z'
  job.taxableAmount = 20
  job.materialActualCost = { amount: 0, at: '', note: '' }
  job.phases = [completedPhase]
  data.jobs = [job]
  data.historicalActuals = [
    { id: 'archived', kind: 'hours', date: '2026-11-09', operatorId: 'federica', paidSeconds: 14400, productiveSeconds: 10800 },
    { id: 'manual', kind: 'hours', date: '2026-11-10', operatorId: 'federica', paidSeconds: 14400, productiveSeconds: 7200 },
  ]
  const liveWork = [
    { date: '2026-11-09', operatorId: 'federica', seconds: 7200 },
    { date: '2026-11-10', operatorId: 'martin', seconds: 3600 },
  ]
  expect(calculateGoalProgress(data, '2026-11-09', liveWork)[0]).toMatchObject({ done: -122, offVehicleHours: 6, offVehicleCost: 102 })
  expect(calculateGoalProgress(data, '2026-11-09', [
    { date: '2026-11-09', operatorId: 'federica', seconds: 14400 },
  ])[0]).toMatchObject({ done: -88, offVehicleHours: 4, offVehicleCost: 68 })
  const result = calculateGoalProgress(data, '2026-11-11', liveWork)
  expect(result.map(({ done, offVehicleCost }) => [done, offVehicleCost])).toEqual([[0, 0], [-224, 204], [-224, 204]])
  expect(result[2]).toMatchObject({ gap: 3224, incomplete: false })
  expect(calculateGoalProgress(data, '2026-11-12')[0]).toMatchObject({ offVehicleTimeIncomplete: true })
  expect(calculateGoalProgress(data, '2026-11-12', [])[0]).toMatchObject({ offVehicleHours: 8, offVehicleCost: 136 })
  expect(calculateGoalProgress(data, '2026-11-12', [
    { date: '2026-11-12', operatorId: 'federica', seconds: 32400 },
  ])[0]).toMatchObject({ offVehicleHours: 4, offVehicleCost: 68 })
})

it('keeps ready and delivered costs incomplete while recognizing produced revenue once',()=>{
 const data=structuredClone(emptyData)
 data.plannerSettings.operators=[{id:'martin',name:'Martin',hourlyCost:20,dailyHours:8,active:true}]
 const job={...makeReportJob(),vehicleId:'v',plate:'TEST',entryDate:'2026-11-09',updatedAt:'2026-11-09T11:00:00Z',status:'Pronta consegna' as const,
  lines:[{category:'ricambi',quantity:1,budgetDirectUnitCost:900,unitPrice:1000}],
  phases:[completedPhase,{...completedPhase,id:'missing',name:'Verniciatura',tabletWorkedSeconds:undefined,operatorAssignments:[]}]} as RepairJob
 data.jobs=[job]
 data.vehicles=[{id:'v',plate:'TEST',status:'Pronta',costEntries:[{category:'vernice',usedAt:'2026-11-09',total:10},{category:'trasporto',usedAt:'2026-11-09',total:5}]}] as typeof data.vehicles
 const before=JSON.stringify(data)
 expect(calculateGoalProgress(data,'2026-11-09').map(p=>p.done)).toEqual([0,0,0])
 expect(calculateGoalProgress(data,'2026-11-09')[2]).toMatchObject({incomplete:true,produced:500})
 expect(JSON.stringify(data)).toBe(before)
 job.status='Consegnata';job.deliveredAt='2026-11-10T11:00:00Z'
 expect(calculateGoalProgress(data,'2026-11-10')[2]).toMatchObject({incomplete:true,produced:500})
})

it('reconciles every remaining weekly amount to the monthly residual without changing historical periods',()=>{
 const data=structuredClone(emptyData)
 data.plannerSettings.monthlyMarginGoal=3000
 data.plannerSettings.operators=[]
 const periods=calculateGoalProgress(data,'2026-11-18')
 const residual=periods[2].gap
 const allocation=remainingWeeklyMarginGoals(data,'2026-11-18',residual)
 expect(Math.round((allocation.weeks.reduce((sum,week)=>sum+week.amount,0)+allocation.unallocated)*100)).toBe(Math.round(residual*100))
 expect(periods[0].gap).toBeLessThanOrEqual(residual)
 expect(periods[1].gap).toBeLessThanOrEqual(residual)
 expect(calculateGoalProgress(data,'2026-11-18',undefined,{day:'2026-11-17',week:'2026-11-09'})[2]).toEqual(periods[2])
})

it('reconciles monthly internal payroll once, excludes contractors and preserves job records',()=>{
 const data=structuredClone(emptyData)
 data.plannerSettings.operators=[{id:'martin',name:'Martin',costMode:'external-extra',externalHourlyCost:40,dailyHours:8,active:true},{id:'other',name:'Altro',hourlyCost:30,dailyHours:8,active:true}]
 const job=makeReportJob()
 job.materialActualCost = { amount: 0, at: '', note: '' }
 job.status='Consegnata';job.deliveredAt='2026-11-10T17:00:00Z';job.entryDate='2026-11-01'
 job.phases=[completedPhase,{...completedPhase,id:'internal',operatorAssignments:[{...completedPhase.operatorAssignments[0],id:'tablet:other',operatorName:'Altro'}]}]
 data.jobs=[job]
 const before=JSON.stringify(data.jobs)
 const baseline=calculateGoalProgress(data,'2026-11-30')[2]
 expect(baseline.recognizedInternalLabor).toBe(30)
 data.plannerSettings.monthlyPayrollActuals=[{id:'a',monthKey:'2026-11',amount:100,note:'',updatedAt:'2026-12-05T10:00:00Z'}]
 const adjusted=calculateGoalProgress(data,'2026-11-30')[2]
 expect(adjusted.payrollAdjustment).toBe(70)
 expect(adjusted.done).toBe(baseline.done-70)
 expect(calculateGoalProgress(data,'2026-12-31')[2].payrollAdjustment).toBe(0)
 data.plannerSettings.monthlyPayrollActuals.push({id:'b',monthKey:'2026-11',amount:0,note:'rettifica',updatedAt:'2026-12-06T10:00:00Z'})
 expect(calculateGoalProgress(data,'2026-11-30')[2].done).toBe(baseline.done+30)
 expect(JSON.stringify(data.jobs)).toBe(before)
})

it('updates contribution from one actual material total and keeps the invoice taxable amount independent', () => {
  const data = structuredClone(emptyData)
  data.plannerSettings.operators = [{ id: 'martin', name: 'Martin', hourlyCost: 20, dailyHours: 8, active: true }]
  const job = { ...makeReportJob(), vehicleId: 'v', customerId: 'c', plate: 'TEST',
    entryDate: '2026-11-09', deliveredAt: '2026-11-09T15:00:00Z', status: 'Consegnata' as const,
    updatedAt: '2026-11-09T15:00:00Z', history: [], phases: [completedPhase] }
  const vehicle = { id: 'v', customerId: 'c', plate: 'TEST', status: 'Consegnata',
    costEntries: [{ category: 'vernice', usedAt: '2026-11-09', total: 60 }] } as typeof data.vehicles[number]
  data.jobs = [job]
  data.vehicles = [vehicle]
  const updated = setJobMaterialActualCost(data, job.id, 75, '', job.deliveredAt)
  expect(calculateGoalProgress(data, '2026-11-10')[2]).toMatchObject({ done: 420, produced: 500, billed: 0 })
  expect(calculateGoalProgress(updated, '2026-11-10')[2]).toMatchObject({ done: 405, produced: 500, billed: 0 })
  expect(vehicleOperatingProfit(vehicle, updated.jobs![0], updated.jobs!, data.plannerSettings).contributionCents).toBe(40500)
  expect(vehicleInvoiceTaxableAmount(updated, vehicle)).toBe(500)
  expect(setJobMaterialActualCost(updated, job.id, 75)).toBe(updated)
})
