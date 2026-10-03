import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QuoteHourBudget } from './QuoteHourBudget'
import { defaultPlannerSettings } from '../../services/erp'
import { createDefaultQuote } from '../../services/acceptance'
import { chooseEliasPrice } from '../../services/damageQuote'
import { ELIAS_PRICE_LIST } from '../../services/eliasPriceList'
import type { AcceptanceQuote } from '../../types'

let latest: AcceptanceQuote
function Harness() {
  const settings = structuredClone(defaultPlannerSettings)
  settings.operators = [{ id: 'a', name: 'Mario', active: true, dailyHours: 8, hourlyCost: 20 }]
  settings.internalCostSettings = { internalHourlyRate: 0, minimumMarginPercent: 20, budgetUseManualStructureRate: true, budgetManualStructureRate: 30 }
  const [line] = chooseEliasPrice(settings, [], { id: 'porta-ant-sx', name: 'Porta anteriore SX' }, ELIAS_PRICE_LIST.find((item) => item.id === 'porta')!, 150, 22, 'lieve', 60)
  const [quote, setQuote] = useState<AcceptanceQuote>(() => ({ ...createDefaultQuote(settings, '2026-10'), damageLines: [line] }))
  latest = quote
  return <QuoteHourBudget quote={quote} settings={settings} activePanelId="porta-ant-sx" onChange={setQuote} />
}
describe('budget ore nel preventivo', () => {
  it('richiede l’operatore, mostra i minuti economici e li applica senza modificare il prezzo', () => {
    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Usa le ore con margine su questo pannello' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Operatore di riferimento del preventivo'), { target: { value: 'a' } })
    expect(screen.getAllByText('2 h 24 min').length).toBeGreaterThan(0)
    expect(screen.getByText('1 h 48 min')).toBeInTheDocument()
    fireEvent.click(button)
    expect(latest.damageLines![0]).toMatchObject({ estimatedMinutes: 108, unitPrice: 150, materialsIncluded: true })
    expect(latest.budgetOperatorId).toBe('a')
  })
})
