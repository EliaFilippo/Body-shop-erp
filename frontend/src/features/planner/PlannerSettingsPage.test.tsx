import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlannerSettingsPage } from './PlannerSettingsPage'
import { emptyData } from '../../services/erp'

describe('PlannerSettingsPage separazione impostazioni', () => {
  it('non mostra storico listino o sezioni prezzi dentro Planner e tempi', () => {
    render(
      <PlannerSettingsPage
        settings={structuredClone(emptyData.plannerSettings)}
        onSave={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.queryByText('STORICO LISTINO')).not.toBeInTheDocument()
    expect(screen.queryByText('LISTINO PREZZI LAVORAZIONI')).not.toBeInTheDocument()
    expect(screen.getByText('STORICO REGOLE')).toBeInTheDocument()
  })
})
