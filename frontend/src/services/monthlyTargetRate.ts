import type { PlannerSettings } from '../types'
import { calculateInternalProductiveCapacity } from './workflow'

export function monthlyTargetRate(settings:PlannerSettings,monthKey:string) {
 const capacity=calculateInternalProductiveCapacity(settings,monthKey)
 const goal=Math.max(0,Number(settings.monthlyRevenueGoal)||0)
 const hours=capacity.productiveHours
 return {
  monthKey,goal,hours,capacitySource:capacity.source,
  hourlyRate:goal>0&&hours>0?Math.ceil(goal/hours*100)/100:null,
 }
}
