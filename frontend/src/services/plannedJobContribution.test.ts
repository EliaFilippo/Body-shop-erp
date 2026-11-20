import { it,expect } from 'vitest'
import { emptyData } from './erp'
import { plannedJobContribution } from './plannedJobContribution'
import type { RepairJob,Vehicle } from '../types'
it('deducts planned labor once and leaves general expenses in the goal',()=>{
 const settings=structuredClone(emptyData.plannerSettings)
 settings.operators=[{id:'a',name:'A',active:true,dailyHours:8,hourlyCost:20}]
 const job={taxableAmount:500,phases:[{estimatedMinutes:120}],lines:[]} as unknown as RepairJob
 const vehicle={estimatedHours:2} as Vehicle
 const before=JSON.stringify(job)
 expect(plannedJobContribution(job,vehicle,settings)).toMatchObject({contribution:460,contributionPerHour:230})
 settings.internalCostSettings={...settings.internalCostSettings!,budgetUseManualStructureRate:true,budgetManualStructureRate:900}
 expect(plannedJobContribution(job,vehicle,settings).contribution).toBe(460)
 expect(JSON.stringify(job)).toBe(before)
 settings.operators[0].hourlyCost=undefined
 expect(plannedJobContribution(job,vehicle,settings).contribution).toBeNull()
})
