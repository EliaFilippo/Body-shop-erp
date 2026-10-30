import {afterEach,describe,expect,it,vi} from 'vitest'
import {CloudSaveQueue} from './cloudSaveQueue'
afterEach(()=>vi.useRealTimers())
describe('local snapshot upload queue',()=>{
 it('retries after a temporary failure without new edits',async()=>{
  vi.useFakeTimers()
  const send=vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(undefined),report=vi.fn()
  const queue=new CloudSaveQueue(send,report,()=>true)
  queue.enqueue('car');await vi.advanceTimersByTimeAsync(0)
  expect(report).toHaveBeenLastCalledWith('pending',expect.any(TypeError))
  await vi.advanceTimersByTimeAsync(5000)
  expect(send.mock.calls).toEqual([['car'],['car']])
  expect(report).toHaveBeenLastCalledWith('synced');queue.dispose()
 })
 it('coalesces complete snapshots with just one in-flight request',async()=>{
  let finish!:()=>void
  const send=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve})).mockResolvedValue(undefined),report=vi.fn()
  const queue=new CloudSaveQueue(send,report,()=>true)
  queue.enqueue(['a']);queue.enqueue(['a','b']);queue.enqueue(['a','b','c'])
  expect(send).toHaveBeenCalledTimes(1)
  finish();await new Promise(resolve=>setTimeout(resolve,0))
  expect(send.mock.calls).toEqual([[['a']],[['a','b','c']]])
  expect(report).toHaveBeenLastCalledWith('synced');queue.dispose()
 })
 it('stops on conflict and disposes retries when the page closes',async()=>{
  vi.useFakeTimers()
  const send=vi.fn().mockRejectedValue(new Error('conflict')),report=vi.fn()
  const queue=new CloudSaveQueue(send,report,()=>false)
  queue.enqueue('local');await vi.advanceTimersByTimeAsync(100000)
  expect(send).toHaveBeenCalledTimes(1)
  expect(report).toHaveBeenLastCalledWith('blocked',expect.any(Error))
  queue.dispose();queue.retry();await vi.advanceTimersByTimeAsync(100000)
  expect(send).toHaveBeenCalledTimes(1)
 })
})
