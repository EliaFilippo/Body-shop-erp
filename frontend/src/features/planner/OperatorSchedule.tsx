import type { PlannerOperator, WeeklyWorkDaySchedule } from '../../types'

const days = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
export function OperatorSchedule({ operator, companySchedule, onChange }: {
  operator: PlannerOperator
  companySchedule?: WeeklyWorkDaySchedule[]
  onChange: (schedule: WeeklyWorkDaySchedule[] | undefined) => void
}) {
  const schedule = operator.weeklySchedule
  return <fieldset style={{ gridColumn: '1 / -1', width: '100%' }}>
    <legend>Giorni e ore concordate · {operator.name || 'Operatore'}</legend>
    <label><input type="checkbox" checked={Boolean(schedule?.length)} onChange={event => onChange(event.target.checked
      ? Array.from({ length: 7 }, (_, dayOfWeek) => {
        const day = companySchedule?.find(item => item.dayOfWeek === dayOfWeek)
        return { dayOfWeek, active: day?.active ?? (dayOfWeek > 0 && dayOfWeek < 6), intervals: structuredClone(day?.intervals ?? [{ startTime: '08:00', endTime: '12:00' }]) }
      }) : undefined)} /> Calendario individuale</label>
    {!schedule?.length && <p>Usa il calendario aziendale e le ore giornaliere dell’operatore.</p>}
    {schedule?.length ? <>
      <p>Attiva solo i giorni concordati. Le fasce orarie determinano le ore disponibili di ogni giornata; lascia fuori le pause.</p>
      {[1, 2, 3, 4, 5, 6, 0].map(dayOfWeek => {
        const day = schedule.find(item => item.dayOfWeek === dayOfWeek) ?? { dayOfWeek, active: false, intervals: [] }
        const update = (patch: Partial<WeeklyWorkDaySchedule>) => onChange(schedule.map(item => item.dayOfWeek === dayOfWeek ? { ...item, ...patch } : item))
        const minutes = day.intervals.reduce((sum, interval) => {
          const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
          return sum + Math.max(0, toMinutes(interval.endTime) - toMinutes(interval.startTime))
        }, 0)
        return <div key={dayOfWeek} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <label><input type="checkbox" checked={day.active} onChange={event => update({ active: event.target.checked })} /> {days[dayOfWeek]}</label>
          {day.active && <>
            {day.intervals.map((interval, index) => <span key={index}>
              <input aria-label={`${operator.name} ${days[dayOfWeek]} inizio ${index + 1}`} type="time" value={interval.startTime} onChange={event => update({ intervals: day.intervals.map((item, i) => i === index ? { ...item, startTime: event.target.value } : item) })} />
              <input aria-label={`${operator.name} ${days[dayOfWeek]} fine ${index + 1}`} type="time" value={interval.endTime} onChange={event => update({ intervals: day.intervals.map((item, i) => i === index ? { ...item, endTime: event.target.value } : item) })} />
              <button type="button" aria-label={`Rimuovi fascia ${days[dayOfWeek]} ${index + 1}`} onClick={() => update({ intervals: day.intervals.filter((_, i) => i !== index) })}>Rimuovi fascia</button>
            </span>)}
            <button type="button" onClick={() => update({ intervals: [...day.intervals, { startTime: '13:00', endTime: '17:00' }] })}>+ Fascia {days[dayOfWeek]}</button>
            <strong>{(minutes / 60).toLocaleString('it-IT')} ore concordate</strong>
          </>}
        </div>
      })}
    </> : null}
  </fieldset>
}

