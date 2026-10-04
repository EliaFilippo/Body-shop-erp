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
  it('mostra le ore disponibili dal prezzo anche senza operatore e senza tempario', () => {
    const settings = structuredClone(defaultPlannerSettings)
    settings.internalCostSettings = { internalHourlyRate: 0, minimumMarginPercent: 0, usePlannerCapacity: false, budgetMaterialsPercent: 20, monthlyCostItems: [{id:'cost',category:'affitto',description:'Spese',monthlyAmount:1000,active:true}], productiveCapacity: {productiveOperators:1,hoursPerOperatorPerDay:1,workingDaysPerMonth:20,efficiencyPercent:100} }
    const quote = createDefaultQuote(settings, '2026-10')
    quote.damageLines = [{id:'line',description:'Porta',panelId:'porta-ant-sx',panelName:'Porta anteriore SX',category:'verniciatura',quantity:1,unitPrice:150,discount:0,vatRate:22,estimatedMinutes:0,taxableAmount:150,vatAmount:33,total:183}]
    render(<DamageQuoteEditor settings={settings} quote={quote} onChange={() => {}} />)
    expect(screen.getByText('Ore a disposizione').parentElement).toHaveTextContent('2 h 24 min')
    expect(screen.getByText('Tempo tecnico previsto').parentElement).toHaveTextContent('0 h 0 min')
  })

  it('configura lieve, lo memorizza, riapre senza duplicare e passa alle ore manuali per grave', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Porta anteriore SX' }))
    fireEvent.click(screen.getByText('Altre lavorazioni e tempi separati'))
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
    fireEvent.click(screen.getByText('Altre lavorazioni e tempi separati'))
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

  it('applica il listino alla porta senza ricarico materiali e riusa le ore memorizzate', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Porta anteriore SX' }))
    fireEvent.click(screen.getByRole('button', { name: 'Porta: 150 euro' }))
    expect(latest.damageLines).toHaveLength(1)
    expect(latest.damageLines![0]).toMatchObject({ unitPrice: 150, estimatedMinutes: 0, materialsIncluded: true })
    expect(latest.lines.find((line) => line.kind === 'consumption')!.unitPrice).toBe(0)
    expect(screen.getByRole('button', { name: 'Memorizza danno lieve' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Ore Porta'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Memorizza danno lieve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi pannello' }))
    fireEvent.click(screen.getByRole('button', { name: 'Porta anteriore SX' }))
    expect(latest.damageLines![0]).toMatchObject({ estimatedMinutes: 120, unitPrice: 150, materialsIncluded: true })
    fireEvent.click(screen.getByRole('button', { name: 'Danno grave' }))
    fireEvent.change(screen.getByLabelText(/Tariffa vendita per danni gravi/), { target: { value: '60' } })
    fireEvent.blur(screen.getByLabelText(/Tariffa vendita per danni gravi/))
    fireEvent.change(screen.getByLabelText('Ore Porta'), { target: { value: '3' } })
    expect(latest.damageLines![0]).toMatchObject({ estimatedMinutes: 180, unitPrice: 180, damageSeverity: 'grave' })
  })

  it('sceglie importi alternativi e applica il sensore pioggia una sola volta', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Scegli un pannello o un accessorio'), { target: { value: 'parabrezza' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sostituzione parabrezza: 150 euro' }))
    fireEvent.change(screen.getByLabelText('Ore Sostituzione parabrezza'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Sensore pioggia/ }))
    expect(latest.damageLines![0].unitPrice).toBe(165)
    fireEvent.click(screen.getByRole('button', { name: 'Sostituzione parabrezza: 170 euro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sostituzione parabrezza: 170 euro' }))
    expect(latest.damageLines).toHaveLength(1)
    expect(latest.damageLines![0]).toMatchObject({ estimatedMinutes: 60, unitPrice: 185 })
    fireEvent.click(screen.getByRole('checkbox', { name: /Sensore pioggia/ }))
    expect(latest.damageLines![0].unitPrice).toBe(170)
  })
})
