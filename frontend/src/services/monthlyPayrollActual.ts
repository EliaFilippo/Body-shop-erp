import type { PlannerSettings } from '../types'

/** One effective monthly total; older entries remain available as audit history. */
export function monthlyPayrollActual(settings: PlannerSettings, month: string) {
  return [...(settings.monthlyPayrollActuals ?? [])]
    .filter(row => row.monthKey === month && Number.isFinite(row.amount) && row.amount >= 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}
