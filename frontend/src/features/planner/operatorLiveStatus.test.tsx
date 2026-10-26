import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunningTaskCard, useOperatorStatus } from './operatorLiveStatus'
import { productionRpc } from '../../services/liveProduction'
vi.mock('../../services/liveProduction',()=>({productionRpc:vi.fn()}))
const task={operatorId:'a',jobId:'j',phaseId:'p',remainingSeconds:60,overrunSeconds:0}
const connection={companyId:'company',session:{accessToken:'token'},config:{url:'https://example.test',anonKey:'key'}} as Parameters<typeof useOperatorStatus>[0]
function Probe(){const {running,message}=useOperatorStatus(connection);return <>{message}{running.map(t=><RunningTaskCard key={t.operatorId} task={t} plate="AA" phase="Verniciatura"/>)}</>}
afterEach(()=>{vi.useRealTimers();vi.resetAllMocks()})
describe('live operator cards',()=>{
 it('uses explicit green and red labels and never calls an unknown allowance on time',()=>{
  const {rerender}=render(<RunningTaskCard task={task} plate="AA" phase="Verniciatura"/>)
  expect(screen.getByLabelText('Lavoro attivo AA')).toHaveClass('on-time')
  rerender(<RunningTaskCard task={{...task,remainingSeconds:0,overrunSeconds:61}} plate="AA" phase="Verniciatura"/>)
  expect(screen.getByLabelText('Lavoro attivo AA')).toHaveClass('late')
  expect(screen.getByText('Ritardo: 2 min')).toBeInTheDocument()
  rerender(<RunningTaskCard task={{...task,remainingSeconds:null}} plate="AA" phase="Verniciatura"/>)
  expect(screen.getByLabelText('Lavoro attivo AA')).toHaveClass('unknown')
 })
 it('removes color after pause and clears obsolete status on a failed refresh',async()=>{
  vi.useFakeTimers()
  vi.mocked(productionRpc).mockResolvedValueOnce({running:[task]}).mockResolvedValueOnce({running:[]}).mockResolvedValueOnce({running:[task]}).mockRejectedValueOnce(new Error('offline'))
  render(<Probe/>)
  await act(async()=>{})
  expect(screen.getByLabelText('Lavoro attivo AA')).toHaveClass('on-time')
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000)})
  expect(screen.queryByLabelText('Lavoro attivo AA')).not.toBeInTheDocument()
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000)})
  expect(screen.getByLabelText('Lavoro attivo AA')).toBeInTheDocument()
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000)})
  expect(screen.queryByLabelText('Lavoro attivo AA')).not.toBeInTheDocument()
  expect(screen.getByText(/Stato dei timer non aggiornato/)).toBeInTheDocument()
 })
})
