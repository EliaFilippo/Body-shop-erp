import type { NightlyEconomicSnapshot, PlannerSettings } from '../types'
import { calculateInternalProductiveCapacity } from './workflow'

export function monthlyTargetRate(settings:PlannerSettings,monthKey:string, nightly?:NightlyEconomicSnapshot) {
 if(nightly?.monthKey===monthKey)return {
  monthKey,goal:nightly.residualRevenue,hours:nightly.remainingProductiveHours,
  capacitySource:nightly.capacitySource,hourlyRate:nightly.targetHourlyRate,isResidual:true,
 }
 const capacity=calculateInternalProductiveCapacity(settings,monthKey)
 const goal=Math.max(0,Number(settings.monthlyRevenueGoal)||0)
 const hours=capacity.productiveHours
 return {
  monthKey,goal,hours,capacitySource:capacity.source,isResidual:false,
  hourlyRate:goal>0&&hours>0?Math.ceil(goal/hours*100)/100:null,
 }
}
