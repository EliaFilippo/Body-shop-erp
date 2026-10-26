import { expect,it } from 'vitest'
import { findWashStationStart,isWashingPhase } from './washStation'
it('una postazione unica per esterno e interni senza attesa aggiuntiva',()=>{
 const end=(s:string)=>new Date(Date.parse(s)+25*60000).toISOString()
 const reservations=[{jobId:'first',startAt:'2026-10-26T08:00:00.000Z',endAt:'2026-10-26T08:25:00.000Z'}]
 expect(findWashStationStart('2026-10-26T08:00:00.000Z','second',reservations,end)).toBe('2026-10-26T08:25:00.000Z')
 expect(isWashingPhase('Lavaggio interni')).toBe(true)
 expect(isWashingPhase('Verniciatura')).toBe(false)
})
