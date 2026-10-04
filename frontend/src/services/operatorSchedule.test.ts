import { describe, expect, it } from 'vitest'
import { emptyData } from './erp'
import { workingMinutesForDate, addWorkingMinutes, isWorkingDate, nextWorkingInstant } from './workCalendar'
import { calculateDayCapacity } from './planner'
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


describe('Martin, sabato e lavoro serale', () => {
  const martin = { id: 'martin', name: 'Martin', active: true, dailyHours: 10, weeklySchedule: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, active: dayOfWeek !== 0, intervals: [1,2,6].includes(dayOfWeek) ? [{startTime: '07:00', endTime: '12:00'}, {startTime: '14:00', endTime: '19:00'}] : [{startTime: '19:00', endTime: '23:00'}] })) }
  it('conta 10 ore il sabato e 4 ore serali senza aprire la domenica', () => {
    const settings = { ...structuredClone(emptyData.plannerSettings), operators: [martin] }
    expect(isWorkingDate('2026-10-10', settings)).toBe(true)
    expect(calculateDayCapacity('2026-10-10', settings).nominal).toBe(10)
    expect(workingMinutesForDate('2026-10-07', settings, martin)).toBe(240)
    expect(isWorkingDate('2026-10-11', settings)).toBe(false)
    expect(nextWorkingInstant('2026-10-07T20:00:00.000Z', settings, martin)).toBe('2026-10-07T20:00:00.000Z')
    expect(addWorkingMinutes('2026-10-09T22:00:00.000Z', 120, settings, martin)).toBe('2026-10-10T08:00:00.000Z')
  })
})
