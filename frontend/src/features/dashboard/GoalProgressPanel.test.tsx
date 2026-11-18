// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GoalProgressPanel } from './GoalProgressPanel'
import { emptyData } from '../../services/erp'

vi.mock('../../services/goalProgress', async importOriginal => {
  const original = await importOriginal<typeof import('../../services/goalProgress')>()
  return {
    ...original,
    calculateGoalProgress: () => [{ label: 'Oggi', goal: 694.14, done: 885.68, gap: 0,
      hasMargin: true, provisional: true, incomplete: false }],
  }
})
vi.mock('../../services/marginTargetRate', () => ({ marginTargetRate: () => null }))

afterEach(cleanup)

it('spiega lo zero storico con obiettivo base e margine provvisorio senza confermare il risultato', () => {
  render(<GoalProgressPanel data={emptyData} />)
  fireEvent.click(screen.getByRole('button', { name: 'Giorno precedente' }))
  expect(screen.getByText(/Obiettivo base del giorno: 694,14/)).toBeTruthy()
  expect(screen.getByText(/Margine provvisorio: 885,68/)).toBeTruthy()
  expect(screen.getByText('Stima sopra o pari all’obiettivo · da confermare')).toBeTruthy()
  expect(screen.queryByText('Obiettivo raggiunto')).toBeNull()
  expect(screen.getByRole('progressbar').style.background).toBe('rgb(169, 105, 24)')
})
