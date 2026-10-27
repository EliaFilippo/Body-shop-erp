import { describe,expect,it } from 'vitest'
import { emptyData } from './erp'
import { getOperatorWorkingIntervals,workingMinutesForDate,extraWorkingMinutesForMonth } from './workCalendar'
const fixture=()=>{
 const data=structuredClone(emptyData)
 data.plannerSettings.operators=[{id:'davide',name:'Davide',active:true,dailyHours:8}]
 data.plannerSettings.weeklyWorkSchedule=[{dayOfWeek:2,active:true,intervals:[{startTime:'08:00',endTime:'12:00'},{startTime:'13:00',endTime:'17:00'}]}]
 data.plannerSettings.absences=[{id:'a',operatorId:'davide',startDate:'2026-10-27',endDate:'2026-11-03',hoursPerDay:null,reason:'Assente'}]
 return data
}
describe('whole-day absences',()=>{
 it('treats blank hours as absent on both inclusive boundary dates and restores the next day',()=>{
  const {plannerSettings:s}=fixture(),op=s.operators[0]
  expect(getOperatorWorkingIntervals('2026-10-27',s,op)).toEqual([])
  expect(getOperatorWorkingIntervals('2026-11-03',s,op)).toEqual([])
  expect(workingMinutesForDate('2026-11-10',s,op)).toBe(480)
  expect(workingMinutesForDate('2026-10-27',s,{...op,id:'colleague'})).toBe(480)
 })
 it('keeps partial and explicit zero absences distinct from an empty whole-day field',()=>{
  const {plannerSettings:s}=fixture(),op=s.operators[0]
  s.absences[0].hoursPerDay=2
  expect(workingMinutesForDate('2026-10-27',s,op)).toBe(360)
  s.absences[0].hoursPerDay=0
  expect(workingMinutesForDate('2026-10-27',s,op)).toBe(480)
 })
 it('a whole-day absence wins over another partial entry and pre-existing extra capacity',()=>{
  const {plannerSettings:s}=fixture(),op=s.operators[0]
  s.absences.unshift({...s.absences[0],id:'partial',hoursPerDay:2})
  s.operatorDayExtensions=[{id:'extra',operatorId:op.id,date:'2026-10-27',startMinute:1020,endMinute:1080}]
  expect(workingMinutesForDate('2026-10-27',s,op)).toBe(0)
  expect(extraWorkingMinutesForMonth(s,'2026-10')).toBe(0)
  s.absences=s.absences.filter(a=>a.id==='partial');s.absences[0].hoursPerDay=8
  expect(workingMinutesForDate('2026-10-27',s,op)).toBe(0)
 })
})
