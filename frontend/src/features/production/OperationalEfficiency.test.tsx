import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { productionRpc } from '../../services/liveProduction'
import { efficiencyLevel, StaffEfficiency, TabletEfficiency } from './OperationalEfficiency'

vi.mock('../../services/liveProduction', () => ({ productionRpc: vi.fn() }))
const rpc = vi.mocked(productionRpc)
const connection = {
  companyId: 'company',
  session: { accessToken: 'token', refreshToken: 'refresh', userId: 'a', email: 'a@example.test', expiresIn: 3600 },
  config: { url: 'https://example.test', anonKey: 'key' },
}

afterEach(() => { cleanup(); rpc.mockReset() })

it.each([
  [3000, 3000, 'green'],
  [3000, 3300, 'red'],
  [3000, 3299, 'yellow'],
  [30000, 31800, 'red'],
  [30000, 31799, 'yellow'],
  [30000, 30001, 'yellow'],
  [null, null, undefined],
  [3600, 0, undefined],
])('classifies %s planned seconds and %s worked seconds as %s', (planned, worked, color) => {
  expect(efficiencyLevel(planned, worked)?.[0]).toBe(color)
})

it('shows only the current tablet light and clears the previous profile on change', async () => {
  rpc.mockResolvedValueOnce([{ operatorId: 'a', name: 'Anna', plannedSeconds: 3600, workedSeconds: 3600 }])
  const { rerender } = render(<TabletEfficiency connection={connection} operatorName="Anna" />)
  await waitFor(() => expect(screen.getByText('Efficienza ottima')).toHaveAttribute('aria-current', 'true'))
  expect(screen.queryByText('Efficienza scarsa')).not.toBeInTheDocument()
  expect(screen.queryByText('Nessuna efficienza')).not.toBeInTheDocument()
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_staff: false, p_details: false })
  rpc.mockResolvedValueOnce([{ operatorId: 'b', name: 'Bruno', plannedSeconds: null, workedSeconds: null }])
  rerender(<TabletEfficiency connection={{ ...connection, session: { ...connection.session, userId: 'b' } }} operatorName="Bruno" />)
  expect(screen.queryByText(/Anna|Saldo|Non valutabile/)).not.toBeInTheDocument()
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
  expect(await screen.findByText('Efficienza non valutabile.')).toBeInTheDocument()
  expect(document.querySelectorAll('.efficiency-light')).toHaveLength(0)
})

it.each([[3299, 'yellow', 'Efficienza scarsa'], [3300, 'red', 'Nessuna efficienza']] as const)('shows only %s seconds current rating', async (workedSeconds, color, label) => {
  rpc.mockResolvedValueOnce([{ operatorId: 'a', name: 'Anna', plannedSeconds: 3000, workedSeconds }])
  render(<TabletEfficiency connection={connection} operatorName="Anna" />)
  expect(await screen.findByText(label)).toBeInTheDocument()
  const lights = document.querySelectorAll('.efficiency-light')
  expect(lights).toHaveLength(1)
  expect(lights[0]).toHaveAttribute('data-color', color)
})

it('shows missing data as non-valutabile for an active operator in the dashboard', async () => {
  rpc.mockResolvedValueOnce([{ operatorId: 'a', name: 'Anna', plannedSeconds: null, workedSeconds: null }])
  render(<StaffEfficiency connection={connection} />)
  expect(await screen.findByText('Non valutabile')).toBeInTheDocument()
  expect(screen.getByText('Anna')).toBeInTheDocument()
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_staff: true, p_details: false })
})
