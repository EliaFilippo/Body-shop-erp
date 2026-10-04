import { describe, expect, it } from 'vitest'
import { emptyData } from './erp'
import { workingMinutesForDate } from './workCalendar'
import { invalidOperatorSchedule } from './operatorSchedule'

describe('calendario individuale', () => {
  const operator = { id: 'external', name: 'Esterno', active: true, dailyHours: 4, weeklySchedule: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, active: dayOfWeek === 1 || dayOfWeek === 3, intervals: dayOfWeek === 3 ? [{ startTime: '08:00', endTime: '12:00' }, { startTime: '13:00', endTime: '17:00' }] : [{ startTime: '08:00', endTime: '12:00' }] })) }
  it('usa 4 ore il lunedì, 8 il mercoledì e zero negli altri giorni', () => {
    const settings = structuredClone(emptyData.plannerSettings)
    expect(workingMinutesForDate('2026-10-05', settings, operator)).toBe(240)
    expect(workingMinutesForDate('2026-10-07', settings, operator)).toBe(480)
    expect(workingMinutesForDate('2026-10-06', settings, operator)).toBe(0)
    expect(invalidOperatorSchedule(operator)).toBe(false)
  })
  it('rifiuta fasce sovrapposte', () => {
    expect(invalidOperatorSchedule({ ...operator, weeklySchedule: [{ dayOfWeek: 1, active: true, intervals: [{ startTime: '08:00', endTime: '12:00' }, { startTime: '11:00', endTime: '14:00' }] }] })).toBe(true)
  })
})
