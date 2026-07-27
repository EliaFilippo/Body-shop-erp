import { describe, expect, it } from 'vitest'
import type { PlannerSettings, Vehicle } from '../types'
import { calculateEconomicSummary, vehicleEconomicImpact } from './economic'

const settings: PlannerSettings = {
  operators: [{ id: 'op', name: 'Filippo', dailyHours: 8, active: true }],
  workingDays: [1, 2, 3, 4, 5], efficiencyPercent: 100, safetyMarginPercent: 10,
  holidays: [], closures: [], absences: [], monthlyRevenueGoal: 10000, monthlyMarginGoal: 3000,
}
const car = (id: string, revenue: number, hours: number): Vehicle => ({
  id, customerId: 'c', plate: id, make: '', model: '', color: '', year: '', vin: '', mileage: '',
  status: 'Accettata', coneNumber: null, priority: 'Normale', deliveryDate: '2026-07-31',
  estimatedHours: hours, workedHours: 0, plannedEntryDate: '2026-07-27',
  requestedDeliveryDate: '2026-07-31', calculatedDeliveryDate: '', expectedRevenue: revenue,
  expectedMargin: revenue * .3, partsStatus: 'Disponibili', blockReason: '', manualPlanningDate: '',
  createdAt: '2026-07-20T00:00:00.000Z',
})

describe('obiettivo economico', () => {
  it('calcola percentuale, importo e ore ancora necessarie da valori reali', () => {
    const result = calculateEconomicSummary([car('A', 4000, 20)], settings, '2026-07-27')
    expect(result.plannedRevenue).toBe(4000)
    expect(result.reachedPercent).toBe(40)
    expect(result.missingRevenue).toBe(6000)
    expect(result.productiveHoursNeeded).toBe(30)
    expect(result.remainingWorkingDays).toBe(5)
    expect(result.dailyRevenueNeeded).toBe(1200)
  })

  it('dichiara il carico sufficiente quando raggiunge l’obiettivo', () => {
    expect(calculateEconomicSummary([car('A', 11000, 30)], settings, '2026-07-27').sufficient).toBe(true)
  })

  it('calcola l’impatto economico di una nuova vettura', () => {
    const impact = vehicleEconomicImpact([car('A', 4000, 20)], [car('A', 4000, 20), car('B', 3000, 10)], settings, '2026-07-27')
    expect(impact).toMatchObject({ addedRevenue: 3000, addedMargin: 900, newReachedPercent: 70, sufficient: false })
  })
})
