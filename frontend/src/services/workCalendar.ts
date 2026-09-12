import type { CompanyClosureEntry, PlannerAbsence, PlannerOperator, PlannerSettings, WeeklyWorkDaySchedule, WorkDayInterval } from '../types'

const DAY_MS = 86_400_000

export type TimeInterval = { startMinute: number; endMinute: number }

export const DEFAULT_WEEKLY_WORK_SCHEDULE: WeeklyWorkDaySchedule[] = [
  { dayOfWeek: 1, active: true, intervals: [{ startTime: '08:00', endTime: '12:30' }, { startTime: '13:30', endTime: '18:00' }] },
  { dayOfWeek: 2, active: true, intervals: [{ startTime: '08:00', endTime: '12:30' }, { startTime: '13:30', endTime: '18:00' }] },
  { dayOfWeek: 3, active: true, intervals: [{ startTime: '08:00', endTime: '12:30' }, { startTime: '13:30', endTime: '18:00' }] },
  { dayOfWeek: 4, active: true, intervals: [{ startTime: '08:00', endTime: '12:30' }, { startTime: '13:30', endTime: '18:00' }] },
  { dayOfWeek: 5, active: true, intervals: [{ startTime: '08:00', endTime: '12:30' }, { startTime: '13:30', endTime: '18:00' }] },
  { dayOfWeek: 6, active: false, intervals: [] },
  { dayOfWeek: 0, active: false, intervals: [] },
]

export function parseTimeToMinutes(value?: string) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

export function formatMinutesToTime(totalMinutes: number) {
  const safe = Math.max(0, Math.round(totalMinutes))
  const hours = Math.floor(safe / 60)
  const minutes = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function normalizeWeeklyWorkSchedule(schedule?: WeeklyWorkDaySchedule[]) {
  const source = Array.isArray(schedule) && schedule.length ? schedule : DEFAULT_WEEKLY_WORK_SCHEDULE
  return DEFAULT_WEEKLY_WORK_SCHEDULE.map((fallback) => {
    const item = source.find((entry) => entry.dayOfWeek === fallback.dayOfWeek)
    const intervals = (item?.intervals ?? fallback.intervals)
      .map((interval) => ({ startTime: interval.startTime, endTime: interval.endTime }))
      .filter((interval) => {
        const start = parseTimeToMinutes(interval.startTime)
        const end = parseTimeToMinutes(interval.endTime)
        return start != null && end != null && end > start
      })
      .sort((a, b) => (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0))
    return {
      dayOfWeek: fallback.dayOfWeek,
      active: item?.active ?? fallback.active,
      intervals,
    }
  })
}

export function dateKey(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function addDays(value: string, days: number) {
  return dateKey(new Date(parseDateKey(value).getTime() + days * DAY_MS))
}

export function isoAt(date: string, minute: number) {
  const hours = Math.floor(minute / 60)
  const minutes = minute % 60
  return `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`
}

export function minutesFromIso(value: string) {
  const date = new Date(value)
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function mergeIntervals(intervals: TimeInterval[]) {
  if (!intervals.length) return []
  const sorted = [...intervals].sort((a, b) => a.startMinute - b.startMinute)
  const merged: TimeInterval[] = [sorted[0]]
  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (current.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, current.endMinute)
      continue
    }
    merged.push({ ...current })
  }
  return merged
}

function subtractInterval(base: TimeInterval, blocker: TimeInterval) {
  if (blocker.endMinute <= base.startMinute || blocker.startMinute >= base.endMinute) return [base]
  const next: TimeInterval[] = []
  if (blocker.startMinute > base.startMinute) next.push({ startMinute: base.startMinute, endMinute: blocker.startMinute })
  if (blocker.endMinute < base.endMinute) next.push({ startMinute: blocker.endMinute, endMinute: base.endMinute })
  return next.filter((interval) => interval.endMinute > interval.startMinute)
}

function subtractIntervals(base: TimeInterval[], blockers: TimeInterval[]) {
  return blockers.reduce<TimeInterval[]>((acc, blocker) => acc.flatMap((interval) => subtractInterval(interval, blocker)), base)
}

function closureApplies(closure: CompanyClosureEntry, date: string) {
  return date >= closure.startDate && date <= closure.endDate
}

function closureToIntervals(closure: CompanyClosureEntry) {
  const startMinute = parseTimeToMinutes(closure.startTime)
  const endMinute = parseTimeToMinutes(closure.endTime)
  if (startMinute == null || endMinute == null || endMinute <= startMinute) return [{ startMinute: 0, endMinute: 24 * 60 }]
  return [{ startMinute, endMinute }]
}

function intervalsMinutes(intervals: TimeInterval[]) {
  return intervals.reduce((sum, interval) => sum + Math.max(0, interval.endMinute - interval.startMinute), 0)
}

function trimIntervalsToMinutes(intervals: TimeInterval[], allowedMinutes: number) {
  let remaining = Math.max(0, Math.round(allowedMinutes))
  if (remaining <= 0) return []
  const next: TimeInterval[] = []
  for (const interval of intervals) {
    const length = interval.endMinute - interval.startMinute
    if (length <= 0) continue
    if (remaining >= length) {
      next.push(interval)
      remaining -= length
      continue
    }
    next.push({ startMinute: interval.startMinute, endMinute: interval.startMinute + remaining })
    remaining = 0
    break
  }
  return next
}

export function getCompanyWorkingIntervals(date: string, settings: PlannerSettings) {
  const weekday = parseDateKey(date).getUTCDay()
  const weekly = normalizeWeeklyWorkSchedule(settings.weeklyWorkSchedule)
  const day = weekly.find((entry) => entry.dayOfWeek === weekday)
  if (!day?.active) return []
  const base = mergeIntervals((day.intervals ?? []).map((interval) => ({
    startMinute: parseTimeToMinutes(interval.startTime) ?? 0,
    endMinute: parseTimeToMinutes(interval.endTime) ?? 0,
  })).filter((interval) => interval.endMinute > interval.startMinute))
  if (!base.length) return []
  if ((settings.holidays ?? []).includes(date) || (settings.closures ?? []).includes(date)) return []
  const blockers = ((settings.companyClosures ?? []).filter((closure) => closureApplies(closure, date)))
    .flatMap((closure) => closureToIntervals(closure))
  return mergeIntervals(subtractIntervals(base, blockers))
}

export function getOperatorWorkingIntervals(date: string, settings: PlannerSettings, operator?: PlannerOperator) {
  const schedule = operator?.weeklySchedule?.length ? operator.weeklySchedule : settings.weeklyWorkSchedule
  const baseSettings = { ...settings, weeklyWorkSchedule: schedule }
  const companyIntervals = getCompanyWorkingIntervals(date, baseSettings)
  const targetOperator = operator
  if (!targetOperator) return companyIntervals
  const nominalMinutes = Math.min(intervalsMinutes(companyIntervals), Math.max(0, Math.round((targetOperator.dailyHours ?? 0) * 60)))
  const absence = (settings.absences ?? []).find((entry: PlannerAbsence) => entry.operatorId === targetOperator.id && date >= entry.startDate && date <= entry.endDate)
  const availableMinutes = Math.max(0, nominalMinutes - Math.round((absence?.hoursPerDay ?? 0) * 60))
  return trimIntervalsToMinutes(companyIntervals, availableMinutes)
}

export function isWorkingDate(date: string, settings: PlannerSettings) {
  return getCompanyWorkingIntervals(date, settings).length > 0
}

export function workingMinutesForDate(date: string, settings: PlannerSettings, operator?: PlannerOperator) {
  return intervalsMinutes(getOperatorWorkingIntervals(date, settings, operator))
}

export function nextWorkingDate(date: string, settings: PlannerSettings) {
  let current = date
  let guard = 0
  while (!isWorkingDate(current, settings) && guard < 730) {
    current = addDays(current, 1)
    guard += 1
  }
  return current
}

export function nextWorkingInstant(fromIso: string, settings: PlannerSettings, operator?: PlannerOperator) {
  let date = fromIso.slice(0, 10)
  let minute = minutesFromIso(fromIso)
  let guard = 0
  while (guard < 730) {
    const intervals = getOperatorWorkingIntervals(date, settings, operator)
    for (const interval of intervals) {
      if (minute <= interval.startMinute) return isoAt(date, interval.startMinute)
      if (minute >= interval.startMinute && minute < interval.endMinute) return isoAt(date, minute)
    }
    date = addDays(date, 1)
    minute = 0
    guard += 1
  }
  return fromIso
}

export function addWorkingMinutes(startIso: string, minutes: number, settings: PlannerSettings, operator?: PlannerOperator) {
  let remaining = Math.max(0, Math.round(minutes))
  let cursor = nextWorkingInstant(startIso, settings, operator)
  if (remaining <= 0) return cursor
  let date = cursor.slice(0, 10)
  let minute = minutesFromIso(cursor)
  let guard = 0
  while (remaining > 0 && guard < 2000) {
    const intervals = getOperatorWorkingIntervals(date, settings, operator)
    let progressed = false
    for (const interval of intervals) {
      const startMinute = Math.max(interval.startMinute, minute)
      if (startMinute >= interval.endMinute) continue
      const usable = interval.endMinute - startMinute
      if (remaining <= usable) return isoAt(date, startMinute + remaining)
      remaining -= usable
      minute = interval.endMinute
      progressed = true
    }
    const overnightResumeMinute = intervals.length > 1 ? 9 * 60 : 8 * 60
    date = nextWorkingDate(addDays(date, 1), settings)
    minute = overnightResumeMinute
    cursor = nextWorkingInstant(isoAt(date, overnightResumeMinute), settings, operator)
    date = cursor.slice(0, 10)
    minute = minutesFromIso(cursor)
    if (!progressed && !getOperatorWorkingIntervals(date, settings, operator).length) guard += 1
  }
  return cursor
}

export function calendarMinutesBetween(startIso: string, endIso: string) {
  const delta = new Date(endIso).getTime() - new Date(startIso).getTime()
  return Math.max(0, Math.round(delta / 60_000))
}

export function intervalsToText(intervals: WorkDayInterval[]) {
  return intervals.map((interval) => `${interval.startTime}-${interval.endTime}`).join(' / ')
}
