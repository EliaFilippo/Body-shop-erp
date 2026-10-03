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
    expect(screen.getByText('Tempo residuo con 2 operatori attivi')).toBeInTheDocument()
    expect(screen.getByText(/rimane meno del 20%/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pausa', exact: true }))
    await waitFor(() => expect(mocked.rpc).toHaveBeenCalledWith('production_timer_action', { p_company_id: 'c1', p_job_id: 'j1', p_action: 'pause' }, expect.objectContaining({ userId: 'u1' }), expect.anything()))
    await screen.findByText('Tempo residuo con 1 operatori attivi')
    expect(screen.getByText(/Mario: in pausa · Luca: al lavoro/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Riprendi' })).toBeEnabled()
  })
})
