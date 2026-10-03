import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LiveProductionPage } from './LiveProductionPage'

const mocked = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../services/cloudAuth', () => ({
  getCloudAuthConfig: () => ({ url: 'https://example.test', anonKey: 'public' }), signInWithPassword: vi.fn(), signOutCloud: vi.fn(),
}))
vi.mock('../../services/liveProduction', async original => ({ ...await original<typeof import('../../services/liveProduction')>(),
  productionRpc: mocked.rpc, refreshProductionSession: vi.fn(async session => session),
}))
beforeEach(() => {
  sessionStorage.setItem('body-shop-erp.cloud-session.v1', JSON.stringify({ accessToken: 'token', refreshToken: 'refresh', userId: 'u1', email: 'test@example.test', expiresIn: 3600 }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ company_id: 'c1', role: 'production' }]))))
  mocked.rpc.mockReset()
})
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals() })

describe('profilo tablet', () => {
  it('shows tasks, personal hours and the identity of the phase signer before advancing to the next phase', async () => {
    let checked = false
    mocked.rpc.mockImplementation(async (name: string) => {
      if (name === 'production_complete_phase') { checked = true; return null }
      return { companyId: 'c1', role: 'production', operatorName: 'Mario', serverNow: new Date().toISOString(), members: [],
        today: { operatorId: 'a', name: 'Mario', serverNow: '', from: '2026-10-03', to: '2026-10-03', workedSeconds: 28860, ordinarySeconds: 28800, extraSeconds: 60, unconfigured: false,
          days: [{ date: '2026-10-03', workedSeconds: 28860, plannedSeconds: 28800, ordinarySeconds: 28800, extraSeconds: 60, running: false }] },
        jobs: [{ jobId: 'j1', plate: 'AA123BB', number: '1', remainingSeconds: 600, ownRemainingSeconds: 900, ownBurnFactor: 1.5, remainingPercent: 25, activeCount: checked ? 0 : 1,
          ownStatus: checked ? 'finished' : 'running', ownPhaseId: 'p1', operators: [], tasks: [{ id: 'l1', description: 'Porta da verniciare', quantity: 1 }],
          phases: [{ id: 'p1', name: 'Preparazione', notRequired: false, status: checked ? 'Completata' : 'In lavorazione', canComplete: true, checkedBy: checked ? 'Mario' : null, checkedAt: checked ? '2026-10-03T10:00:00Z' : null },
            { id: 'p2', name: 'Verniciatura', notRequired: false, status: 'Da fare', canComplete: false, checkedBy: null, checkedAt: null }],
        }] }
    })
    render(<LiveProductionPage />)
    await screen.findByText('Porta da verniciare')
    expect(screen.getByText('Le mie ore di oggi')).toBeInTheDocument()
    expect(screen.getByText('0h 01m')).toBeInTheDocument()
    expect(screen.getByLabelText('Ore disponibili per te').textContent).toMatch(/^0:14:|^0:15:/)
    fireEvent.click(screen.getByRole('button', { name: '✓ Completa Preparazione' }))
    await screen.findByText(/Visto di Mario/)
    expect(screen.getByLabelText('Fase da lavorare su AA123BB')).toHaveValue('p2')
    expect(screen.queryByText('Profili dipendenti · monte ore')).not.toBeInTheDocument()
  })
  it('shows a shared low-budget clock and pauses only the authenticated operator', async () => {
    let paused = false
    mocked.rpc.mockImplementation(async (name: string) => {
      if (name === 'production_timer_action') { paused = true; return null }
      return { companyId: 'c1', role: 'production', operatorName: 'Mario', serverNow: new Date().toISOString(), members: [], jobs: [{
        jobId: 'j1', plate: 'AA123BB', number: '1', remainingSeconds: 600, remainingPercent: 19, activeCount: paused ? 1 : 2,
        ownStatus: paused ? 'paused' : 'running', operators: [{ name: 'Mario', status: paused ? 'paused' : 'running' }, { name: 'Luca', status: 'running' }],
      }] }
    })
    render(<LiveProductionPage />)
    await screen.findByText('AA123BB')
    expect(screen.getByText(/Tempo residuo con 2 operatori attivi/)).toBeInTheDocument()
    expect(screen.getByText(/rimane meno del 20%/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Pausa$/ }))
    await waitFor(() => expect(mocked.rpc).toHaveBeenCalledWith('production_timer_action', { p_company_id: 'c1', p_job_id: 'j1', p_action: 'pause' }, expect.objectContaining({ userId: 'u1' }), expect.anything()))
    await screen.findByText(/Tempo residuo con 1 operatori attivi/)
    expect(screen.getByText(/Mario: in pausa · Luca: al lavoro/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Riprendi' })).toBeEnabled()
  })
})
