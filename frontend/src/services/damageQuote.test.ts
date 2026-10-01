import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { defaultPlannerSettings, emptyData } from './erp'
import { buildAcceptanceQuoteSummary, createAcceptanceDraft, createDefaultQuote, updateConsumptionLine } from './acceptance'
import { acceptanceEstimateLines, damageQuoteError, makeDamageLine, makeMinorDamagePreset, minorDamageLines, recalculateDamageLine } from './damageQuote'
import { createEstimate, estimatePhaseTotals, estimateVehicleTotalMinutes } from './workflow'
import { createQuoteDocument } from './documents'
import { loadDatabase, saveDatabase } from './database'

const panel = { id: 'porta-ant-sx', name: 'Porta anteriore SX' }
const settings = structuredClone(defaultPlannerSettings)
const work = settings.standardWorks!.find((item) => item.name === 'Lattoneria')!
const mild = () => makeDamageLine(settings, panel, work, 'lieve', 22, 0, { workId: work.id, minutes: 90, price: 150 })

describe('preventivo grafico per danno', () => {
  it('non inventa un prezzo se manca il listino e blocca la conversione incompleta', () => {
    expect(minorDamageLines(settings, panel, 22)).toEqual([])
    const line = makeDamageLine(settings, panel, work, 'lieve', 22, 0)
    expect(line.unitPrice).toBe(0)
    expect(damageQuoteError([line])).toContain('Completa tempo e prezzo')
    expect(() => acceptanceEstimateLines({ ...createDefaultQuote(settings, '2026-10'), damageLines: [line] })).toThrow('Completa tempo e prezzo')
  })

  it('riusa le impostazioni lievi sullo stesso pannello e non su un pannello diverso', () => {
    const preset = makeMinorDamagePreset(panel, [mild()])
    const configured = { ...settings, minorDamagePresets: [preset] }
    expect(minorDamageLines(configured, panel, 22)[0]).toMatchObject({ estimatedMinutes: 90, unitPrice: 150, damageSeverity: 'lieve' })
    expect(minorDamageLines(configured, { id: 'porta-ant-dx', name: 'Porta anteriore DX' }, 22)).toEqual([])
  })

  it('calcola il danno grave dalla tariffa di vendita e mantiene le ore manuali nel preventivo', () => {
    const line = makeDamageLine(settings, panel, work, 'grave', 22, 60, { workId: work.id, minutes: 180, price: 999 })
    expect(line).toMatchObject({ estimatedMinutes: 180, unitPrice: 180, total: 219.6 })
    const data = createEstimate(structuredClone(emptyData), { customerId: 'c', vehicleId: 'v', plate: 'TEST001', companyName: '', contactName: '', date: '2026-10-01', notes: '', lines: [line] })
    expect(data.estimates![0].lines[0]).toMatchObject({ panelId: panel.id, damageSeverity: 'grave', estimatedMinutes: 180, categoryOrPhase: 'Lattoneria' })
    expect(estimateVehicleTotalMinutes(data.estimates![0].lines)).toBe(180)
    expect(estimatePhaseTotals(data.estimates![0].lines).get('Lattoneria')).toBe(180)
  })

  it('somma tutti i pannelli, ricalcola i materiali e produce gli stessi totali per il documento cliente', () => {
    const second = recalculateDamageLine({ ...mild(), id: 'second', panelId: 'cofano', panelName: 'Cofano', unitPrice: 100, estimatedMinutes: 60 }, settings)
    let quote = { ...createDefaultQuote(settings, '2026-10'), damageLines: [mild(), second] }
    quote = updateConsumptionLine(quote, .2) as typeof quote
    expect(buildAcceptanceQuoteSummary(quote)).toMatchObject({ labor: { total: 250 }, materials: { total: 50 }, taxableAmount: 300, total: 366 })
    quote.lines.push({ id: 'discount', kind: 'discount', description: 'Sconto', quantity: 1, unitPrice: 30, unitCost: 0, source: 'manual' })
    const lines = acceptanceEstimateLines(quote)
    const data = createEstimate({ ...structuredClone(emptyData), customers: [{ id: 'c', name: 'Cliente prova', type: 'Privato', phone: '', email: '', taxId: '', address: '', createdAt: '' }],
      vehicles: [{ id: 'v', customerId: 'c', plate: 'TEST001' } as typeof emptyData.vehicles[number]],
    }, { customerId: 'c', vehicleId: 'v', plate: 'TEST001', companyName: '', contactName: '', date: '2026-10-01', notes: '', lines })
    const estimate = data.estimates![0]
    const converted = createQuoteDocument(data, { customerId: 'c', vehicleId: 'v', lines: estimate.lines.map((line) => ({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, vatRate: line.vatRate, discountRate: line.discount / (line.quantity * line.unitPrice) * 100 })) })
    expect(estimate.total).toBe(329.4)
    expect(converted.quotes![0].total).toBe(estimate.total)
    expect(buildAcceptanceQuoteSummary(quote).total).toBe(estimate.total)
  })

  it('conserva pannelli e listino lieve dopo un salvataggio e una rilettura reali', async () => {
    const data = structuredClone(emptyData)
    data.plannerSettings.minorDamagePresets = [makeMinorDamagePreset(panel, [mild()])]
    const draft = createAcceptanceDraft('customer-1', 'vehicle-1', settings, '2026-10')
    expect(draft.quote.lines.find((line) => line.kind === 'labor')!.quantity).toBe(0)
    draft.quote.damageLines = [mild()]
    data.acceptances = [draft]
    await saveDatabase(data)
    const loaded = await loadDatabase()
    expect(loaded.plannerSettings.minorDamagePresets).toEqual(data.plannerSettings.minorDamagePresets)
    expect(loaded.acceptances![0].quote.damageLines![0]).toMatchObject({ panelId: panel.id, damageSeverity: 'lieve', estimatedMinutes: 90, unitPrice: 150 })
  })
})
