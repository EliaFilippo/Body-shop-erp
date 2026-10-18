import { describe, it, expect } from 'vitest'
import { liveCountdown, type LiveClock } from './liveProduction'
const clock: LiveClock = { jobId:'j',plate:'T',number:'1',operators:[],ownStatus:'running',remainingSeconds:2,ownRemainingSeconds:4,ownBurnFactor:2,activeCount:2,remainingPercent:1 }
describe('technical overtime continues', () => {
 it('crosses zero without resetting and burns person-time for both operators', () => {
  expect(liveCountdown(clock, 5)).toMatchObject({individualSeconds:0,overrunSeconds:6,exhausted:true})
  expect(liveCountdown({...clock, remainingSeconds:0,ownRemainingSeconds:0,overrunSeconds:60}, 5).overrunSeconds).toBe(70)
 })
 it('does not accumulate while everyone is paused and does not invent missing times', () => {
  expect(liveCountdown({...clock,remainingSeconds:0,ownRemainingSeconds:0,activeCount:0,ownBurnFactor:0,overrunSeconds:60}, 20).overrunSeconds).toBe(60)
  expect(liveCountdown({...clock,remainingSeconds:null,ownRemainingSeconds:null}, 200).overrunSeconds).toBe(0)
 })
})
