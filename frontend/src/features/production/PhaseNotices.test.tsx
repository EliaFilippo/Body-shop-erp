import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PhaseNotices, useTabletNotices } from './PhaseNotices'
const mocked = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../services/liveProduction', () => ({ productionRpc: mocked.rpc }))
const connection = { companyId: 'company', session: { accessToken: 'token', refreshToken: 'refresh', userId: 'u', email: 'u@example.test', expiresIn: 3600 }, config: { url: 'https://example.test', anonKey: 'key' } }
const phases = [{ id: 'p1', name: 'Lattoneria' }, { id: 'p2', name: 'Rimontaggio' }]
const note = { id: 'n1', phaseId: 'p1', phaseName: 'Lattoneria', body: 'Attenzione al rivestimento', authorName: 'Stefania', authorRole: 'production', createdAt: '2026-10-06T08:00:00Z', reviewedAt: null, reviewedName: null }
beforeEach(() => mocked.rpc.mockReset())
afterEach(cleanup)
it('shows author, phase and office review while preserving messages in closed jobs', async () => {
  mocked.rpc.mockResolvedValue([note])
  render(<PhaseNotices connection={connection} jobId="j" phases={phases} office closed />)
  expect(await screen.findByText(note.body)).toBeInTheDocument()
  expect(screen.getByText(/Stefania · Operatore/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Scrivi un avviso')).not.toBeInTheDocument()
  mocked.rpc.mockResolvedValue([{ ...note, reviewedName: 'Filippo', reviewedAt: '2026-10-06T09:00:00Z' }])
  fireEvent.click(screen.getByText('✓ Verificato dall’ufficio'))
  expect(await screen.findByText(/✓ Verificato da Filippo/)).toBeInTheDocument()
})
it('keeps a failed draft and reuses its identifier on retry; operators cannot review', async () => {
  mocked.rpc.mockResolvedValueOnce([note]).mockRejectedValueOnce(new Error('Connessione interrotta')).mockResolvedValueOnce([note])
  render(<PhaseNotices connection={connection} jobId="j" phases={phases} />)
  await screen.findByText(note.body)
  expect(screen.queryByText('✓ Verificato dall’ufficio')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Fase dell’avviso'), { target: { value: 'p2' } })
  fireEvent.change(screen.getByLabelText('Scrivi un avviso'), { target: { value: 'Controllare gli agganci' } })
  fireEvent.click(screen.getByText('Invia avviso'))
  await screen.findByText('Connessione interrotta')
  expect(screen.getByLabelText('Scrivi un avviso')).toHaveValue('Controllare gli agganci')
  const first = mocked.rpc.mock.calls[1][1]
  fireEvent.click(screen.getByText('Riprova invio avviso'))
  await waitFor(() => expect(screen.getByLabelText('Scrivi un avviso')).toHaveValue(''))
  expect(mocked.rpc.mock.calls[2][1]).toEqual(first)
  expect(first).toMatchObject({ p_company_id: 'company', p_job_id: 'j', p_phase_id: 'p2', p_body: 'Controllare gli agganci' })
})


it('loads avvisi for two vehicles in one request and refreshes when the tablet becomes visible', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  const second = { ...note, id: 'n2', body: 'Seconda vettura' }
  mocked.rpc.mockResolvedValue({ j: [note], k: [second] })
  function Tablet() {
    const shared = useTabletNotices(connection.companyId, connection.session, connection.config, ['j', 'k'])
    return <>{['j', 'k'].map(id => <PhaseNotices key={id} connection={connection} jobId={id} phases={phases} shared={shared.forJob(id)} />)}</>
  }
  try {
    render(<Tablet />)
    expect(mocked.rpc).not.toHaveBeenCalled()
    hidden.mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    expect(await screen.findByText(note.body)).toBeInTheDocument()
    expect(await screen.findByText(second.body)).toBeInTheDocument()
    expect(mocked.rpc).toHaveBeenCalledTimes(1)
    expect(mocked.rpc.mock.calls[0].slice(0, 2)).toEqual([
      'production_phase_notices_batch', { p_company_id: 'company', p_job_ids: ['j', 'k'] },
    ])
  } finally { hidden.mockRestore() }
})


it('skips office notice reads in a hidden tab and refreshes when it is visible', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  mocked.rpc.mockResolvedValue([note])
  try {
    render(<PhaseNotices connection={connection} jobId="j" phases={phases} office />)
    expect(mocked.rpc).not.toHaveBeenCalled()
    hidden.mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    expect(await screen.findByText(note.body)).toBeInTheDocument()
    expect(mocked.rpc).toHaveBeenCalledTimes(1)
  } finally { hidden.mockRestore() }
})
