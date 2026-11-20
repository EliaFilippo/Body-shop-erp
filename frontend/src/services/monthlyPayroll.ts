import type { ErpData, MonthlyPayrollActual } from '../types'
import { operatorHourlyCost } from './closedJobMargin'
import { withHistoricalHours } from './historicalActuals'
import type { DailyProductionWork } from './productionPlanningState'

export function payrollEstimate(data: ErpData, month: string, work: DailyProductionWork[]) {
  return Math.round(withHistoricalHours(data, work).filter(row => row.date.startsWith(month)).reduce((sum, row) => {
    const operator = data.plannerSettings.operators.find(item => item.id === row.operatorId)
    return sum + (operator && operator.costMode !== 'external-extra' ? row.paidSeconds / 3600 * (operatorHourlyCost(operator) ?? 0) : 0)
  }, 0) * 100) / 100
}
export function saveMonthlyPayroll(data: ErpData, month: string, total: number, officeCost: number, estimated: number, now = new Date().toISOString()): ErpData {
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Rome', year:'numeric', month:'2-digit'}).format(new Date(now))
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= today) throw new Error('Scegli un mese concluso.')
  if (![total, officeCost, estimated].every(value => Number.isFinite(value) && value >= 0) || officeCost > total) throw new Error('Inserisci importi validi; la quota ufficio non può superare il totale.')
  const existing = data.plannerSettings.monthlyPayrollActuals ?? []
  const previous = existing.find(row => row.month === month)
  const row: MonthlyPayrollActual = {month, total, officeCost, estimated, productionFactor:estimated>0?(total-officeCost)/estimated:undefined, updatedAt:now,
    history:[...(previous?.history ?? []), {at:now, total, officeCost}]}
  return {...data, plannerSettings:{...data.plannerSettings, monthlyPayrollActuals:[...existing.filter(item => item.month !== month), row]}}
}
