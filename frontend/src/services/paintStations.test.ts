import { describe,it,expect } from 'vitest'
import { findPaintStationStart, type PaintReservation } from './paintStations'
const at=(minutes:number)=>new Date(Date.UTC(2026,9,26,8,minutes)).toISOString()
describe('tre postazioni di verniciatura',()=>{
 it('posticipa la quarta vettura fino alla fine della verniciatura e asciugatura',()=>{
  const reservations:PaintReservation[]=[0,1,2].map(n=>({jobId:`j${n}`,startAt:at(0),endAt:at(90)}))
  expect(findPaintStationStart(at(0),'fourth',reservations,start=>new Date(Date.parse(start)+90*60000).toISOString())).toBe(at(90))
  expect(findPaintStationStart(at(90),'fourth',reservations,()=>at(180))).toBe(at(90))
 })
 it('conta le vetture distinte, verifica tutto l’intervallo e conserva gli operatori di supporto',()=>{
  const reservations=[{jobId:'one',startAt:at(0),endAt:at(90)},{jobId:'one',startAt:at(0),endAt:at(90)},
   {jobId:'two',startAt:at(0),endAt:at(90)},{jobId:'three',startAt:at(20),endAt:at(90)}]
  expect(findPaintStationStart(at(0),'one',reservations,()=>at(90))).toBe(at(0))
  expect(findPaintStationStart(at(0),'fourth',reservations,start=>new Date(Date.parse(start)+30*60000).toISOString())).toBe(at(90))
 })
})
