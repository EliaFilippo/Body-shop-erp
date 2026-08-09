import { describe, expect, it } from 'vitest'
import type { PlannerSettings, Vehicle } from '../types'
import {
  calculateDayCapacity,
  calculatePlanner,
  capacityWithAssignments,
  isWorkingDay,
  moveVehiclePlanningDate,
  moveVehicleWork,
} from './planner'

const settings: PlannerSettings = {
  operators: [{ id: 'op-1', name: 'Giorgio', dailyHours: 8, active: true }],
  workingDays: [1, 2, 3, 4, 5],
  efficiencyPercent: 100,
  safetyMarginPercent: 20,
  holidays: [],
  closures: [],
  absences: [],
  monthlyRevenueGoal: 40000,
  ownerWithdrawalAmount: 3000,
  ownerWithdrawalPlannedDate: '2026-07-31',
  monthlyMarginGoal: 12000,
}

const vehicle = (id: string, hours: number, requestedDeliveryDate = '2026-07-27'): Vehicle => ({
  id, customerId: 'c1', plate: `AA00${id}AA`, make: 'Fiat', model: '500', color: '',
  year: '', vin: '', mileage: '', status: 'Accettata', coneNumber: null, priority: 'Normale',
  deliveryDate: requestedDeliveryDate, estimatedHours: hours, workedHours: 0,
  plannedEntryDate: '2026-07-27', requestedDeliveryDate, calculatedDeliveryDate: '',
  expectedRevenue: 1000, expectedMargin: 300, partsStatus: 'Disponibili', blockReason: '',
  manualPlanningDate: '', createdAt: `2026-07-20T00:00:0${id}.000Z`,
})

describe('capacità produttiva', () => {
  it('applica efficienza e margine di sicurezza', () => {
    expect(calculateDayCapacity('2026-07-27', settings)).toMatchObject({
      nominal: 8, normal: 8, protected: 6.4, remaining: 6.4,
    })
  })

  it('esclude weekend, festività e chiusure', () => {
    expect(isWorkingDay('2026-08-01', settings)).toBe(false)
    expect(calculateDayCapacity('2026-07-27', { ...settings, holidays: ['2026-07-27'] }).protected).toBe(0)
    expect(calculateDayCapacity('2026-07-27', { ...settings, closures: ['2026-07-27'] }).protected).toBe(0)
  })

  it('sottrae ferie e assenze, anche parziali', () => {
    const absent = { ...settings, absences: [{ id: 'a', operatorId: 'op-1', startDate: '2026-07-27', endDate: '2026-07-27', hoursPerDay: 3, reason: 'Visita' }] }
    expect(calculateDayCapacity('2026-07-27', absent).nominal).toBe(5)
  })

  it('non restituisce ore disponibili negative e segnala l’eccedenza', () => {
    const capacity = capacityWithAssignments('2026-07-27', settings, [{ vehicleId: 'v', date: '2026-07-27', protectedHours: 9, normalHours: 9 }])
    expect(capacity.remaining).toBe(0)
    expect(capacity.overload).toBe(2.6)
  })
})

describe('consegne e semafori', () => {
  it('classifica verde quando basta la capacità protetta', () => {
    expect(calculatePlanner([vehicle('1', 6)], settings, '2026-07-26').vehicles[0].status).toBe('green')
  })

  it('classifica giallo quando serve consumare il margine di sicurezza', () => {
    expect(calculatePlanner([vehicle('2', 7)], settings, '2026-07-26').vehicles[0].status).toBe('yellow')
  })

  it('classifica rosso e indica ore, ritardo e prima data consigliata', () => {
    const result = calculatePlanner([vehicle('3', 9)], settings, '2026-07-26').vehicles[0]
    expect(result.status).toBe('red')
    expect(result.missingHours).toBe(1)
    expect(result.delayWorkingDays).toBe(1)
    expect(result.suggestedDate).toBe('2026-07-28')
  })

  it('ricalcola la consegna dopo l’inserimento di una nuova vettura prioritaria', () => {
    const normal = vehicle('4', 6, '2026-07-28')
    const before = calculatePlanner([normal], settings, '2026-07-26').vehicles.find((item) => item.vehicleId === normal.id)
    const urgent = { ...vehicle('5', 6, '2026-07-27'), priority: 'Urgente' as const }
    const after = calculatePlanner([normal, urgent], settings, '2026-07-26').vehicles.find((item) => item.vehicleId === normal.id)
    expect(before?.calculatedDeliveryDate).toBe('2026-07-27')
    expect(after?.calculatedDeliveryDate).toBe('2026-07-28')
  })

  it('mantiene visibile una vettura bloccata senza assegnare ore', () => {
    const blocked = { ...vehicle('6', 4), partsStatus: 'Mancanti' as const }
    const result = calculatePlanner([blocked], settings, '2026-07-26').vehicles[0]
    expect(result.blocked).toBe(true)
    expect(result.assignments).toEqual([])
  })

  it('sposta il carico su una nuova data mantenendo le ore assegnate', () => {
    const result = moveVehiclePlanningDate([{ vehicleId: 'v', date: '2026-07-28', protectedHours: 8, normalHours: 0 }], 'v', '2026-07-29', settings)
    expect(result.assignments[0]).toMatchObject({ vehicleId: 'v', date: '2026-07-29', protectedHours: 8 })
  })

  it('richiede conferma quando uno spostamento supera la capacità', () => {
    const result = moveVehicleWork([{ vehicleId: 'v', date: '2026-07-28', protectedHours: 8, normalHours: 0 }], 'v', '2026-07-27', settings)
    expect(result.requiresConfirmation).toBe(true)
    expect(result.excessHours).toBe(1.6)
  })
})
