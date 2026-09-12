import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { emptyData } from './services/erp'
import { loadDatabase, saveDatabase } from './services/database'

vi.mock('./services/database', async () => {
  const actual = await vi.importActual<typeof import('./services/database')>('./services/database')
  return {
    ...actual,
    loadDatabase: vi.fn(),
    saveDatabase: vi.fn(),
  }
})

describe('App navigation impostazioni', () => {
  const clickSettingsToggle = () => {
    fireEvent.click(screen.getByRole('button', { name: /⚙ Impostazioni/ }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadDatabase).mockResolvedValue(structuredClone(emptyData))
    vi.mocked(saveDatabase).mockResolvedValue(undefined)
  })

  it('espande e collassa la sezione Impostazioni nella sidebar', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: 'Planner e tempi' })).not.toBeInTheDocument()

    clickSettingsToggle()
    expect(screen.getByRole('button', { name: 'Planner e tempi' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Planner e tempi' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Planner e tempi' })).toBeInTheDocument()
  })

  it('mostra la dashboard Impostazioni e apre le pagine corrette dalle card', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    })

    clickSettingsToggle()
    expect(screen.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeInTheDocument()

    const settingsMain = screen.getByRole('main')
    const clickSettingsCard = (name: string) => fireEvent.click(within(settingsMain).getByRole('button', { name: new RegExp(name, 'i') }))

    clickSettingsCard('Planner e tempi')
    expect(screen.getByRole('heading', { level: 1, name: 'Planner e tempi' })).toBeInTheDocument()

    clickSettingsToggle()
    clickSettingsCard('Orari di lavoro')
    expect(screen.getByRole('heading', { level: 1, name: 'Orari di lavoro' })).toBeInTheDocument()

    clickSettingsToggle()
    clickSettingsCard('Listino prezzi')
    expect(screen.getByRole('heading', { level: 1, name: 'Listino prezzi' })).toBeInTheDocument()

    clickSettingsToggle()
    clickSettingsCard('Costi e tariffe interne')
    expect(screen.getByRole('heading', { level: 1, name: 'Costi e tariffe interne' })).toBeInTheDocument()

    clickSettingsToggle()
    clickSettingsCard('Obiettivi')
    expect(screen.getByRole('heading', { level: 1, name: 'Obiettivi' })).toBeInTheDocument()
  })

  it('mantiene Preventivi / Commesse nel menu operativo anche con Impostazioni aperto', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    })

    clickSettingsToggle()
    expect(screen.getByRole('button', { name: 'Preventivi / Commesse' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Preventivi / Commesse' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Preventivi / Commesse' })).toBeInTheDocument()
  })
})
