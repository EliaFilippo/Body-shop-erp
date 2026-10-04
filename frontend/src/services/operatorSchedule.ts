import type { PlannerOperator } from '../types'

export function invalidOperatorSchedule(operator: PlannerOperator) {
  return operator.weeklySchedule?.some(day => day.active && (!day.intervals.length || day.intervals.some((interval, index) =>
    !/^\d{2}:\d{2}$/.test(interval.startTime) || !/^\d{2}:\d{2}$/.test(interval.endTime) || interval.endTime <= interval.startTime ||
    day.intervals.some((other, otherIndex) => index !== otherIndex && interval.startTime < other.endTime && other.startTime < interval.endTime)))) ?? false
}
