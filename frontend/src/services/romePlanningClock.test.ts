import {expect,it} from 'vitest'
import {toRomePlanningClock,fromRomePlanningClock} from './romePlanningClock'
it('maps configured Italian work hours to real winter and summer instants',()=>{
 expect(fromRomePlanningClock('2026-10-30T08:00:00.000Z')).toBe('2026-10-30T07:00:00.000Z')
 expect(fromRomePlanningClock('2026-07-30T08:00:00.000Z')).toBe('2026-07-30T06:00:00.000Z')
 expect(toRomePlanningClock('2026-10-30T07:00:00.000Z')).toBe('2026-10-30T08:00:00.000Z')
})
it('uses the actual remaining occurrence of a repeated hour at the clock change',()=>{
 expect(fromRomePlanningClock('2026-10-25T02:30:00.000Z',Date.parse('2026-10-25T00:00:00Z'))).toBe('2026-10-25T00:30:00.000Z')
 expect(fromRomePlanningClock('2026-10-25T02:30:00.000Z',Date.parse('2026-10-25T01:00:00Z'))).toBe('2026-10-25T01:30:00.000Z')
})
