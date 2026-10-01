import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DamageQuoteEditor } from './DamageQuoteEditor'
import { defaultPlannerSettings } from '../../services/erp'
import { createDefaultQuote } from '../../services/acceptance'
import type { AcceptanceQuote, PlannerSettings } from '../../types'

let latest: AcceptanceQuote
let savedSettings: PlannerSettings
function Harness() {
  const [settings, setSettings] = useState(structuredClone(defaultPlannerSettings))
  const [quote, setQuote] = useState(createDefaultQuote(settings, '2026-10'))
  latest = quote
  savedSettings = settings
  return <DamageQuoteEditor settings={settings} quote={quote} onChange={setQuote} onSavePreset={(preset) => setSettings({ ...settings, minorDamagePresets: [preset] })} />
}

describe('pannelli cliccabili in accettazione', () => {
  it('configura lieve, lo memorizza, riapre senza duplicare e passa alle ore manuali per grave', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Porta anteriore SX' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lattoneria' }))
    expect(screen.getByRole('button', { name: 'Memorizza danno lieve' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Ore Lattoneria'), { target: { value: '1.5' } })
    fireEvent.change(screen.getByLabelText('Prezzo Lattoneria €'), { target: { value: '150' } })
    fireEvent.blur(screen.getByLabelText('Prezzo Lattoneria €'))
    fireEvent.click(screen.getByRole('button', { name: 'Memorizza danno lieve' }))
    expect(savedSettings.minorDamagePresets![0].lines[0]).toMatchObject({ minutes: 90, price: 150 })
    fireEvent.click(screen.getByRole('button', { name: 'Porta anteriore SX' }))
    expect(latest.damageLines).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Danno grave' }))
    fireEvent.change(screen.getByLabelText(/Tariffa vendita per danni gravi/), { target: { value: '60' } })
    fireEvent.blur(screen.getByLabelText(/Tariffa vendita per danni gravi/))
    fireEvent.change(screen.getByLabelText('Ore Lattoneria'), { target: { value: '3' } })
    expect(latest.damageLines![0]).toMatchObject({ damageSeverity: 'grave', estimatedMinutes: 180, unitPrice: 180 })
    expect(savedSettings.minorDamagePresets![0].lines[0].minutes).toBe(90)
  })

  it('rimuove soltanto il pannello scelto e lo recupera dal listino lieve', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Porta anteriore SX' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lattoneria' }))
    fireEvent.change(screen.getByLabelText('Prezzo Lattoneria €'), { target: { value: '50' } })
    fireEvent.blur(screen.getByLabelText('Prezzo Lattoneria €'))
    fireEvent.click(screen.getByRole('button', { name: 'Memorizza danno lieve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi pannello' }))
    expect(latest.damageLines).toHaveLength(0)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Porta anteriore SX' }), { key: 'Enter' })
    expect(latest.damageLines).toHaveLength(1)
    expect(latest.damageLines![0].unitPrice).toBe(50)
  })
})
