import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { ELIAS_PRICE_LIST, eliasPricesForPanel } from './eliasPriceList'
import { chooseEliasPrice, acceptanceEstimateLines, makeMinorDamagePreset, minorDamageLines, recalculateDamageLine } from './damageQuote'
import { buildAcceptanceQuoteSummary, createDefaultQuote, updateConsumptionLine } from './acceptance'
import { defaultPlannerSettings, emptyData } from './erp'
import { createEstimate } from './workflow'
import { createQuoteDocument } from './documents'
import { loadDatabase, saveDatabase } from './database'
import { QUOTE_PANELS } from '../features/workflow/vehiclePanels'

const settings = structuredClone(defaultPlannerSettings)
const panel = { id: 'porta-ant-sx', name: 'Porta anteriore SX' }
const entry = (id: string) => ELIAS_PRICE_LIST.find((item) => item.id === id)!

describe('listino Elias dalla foto', () => {
  it('rende raggiungibili tutte le 28 voci dai pannelli, con alternative e senza tempi inventati', () => {
    expect(ELIAS_PRICE_LIST).toHaveLength(28)
    for (const item of ELIAS_PRICE_LIST) {
      const part = QUOTE_PANELS.find((candidate) => eliasPricesForPanel(candidate.id).some((price) => price.id === item.id))!
      expect(part, item.name).toBeDefined()
      for (const price of item.prices) {
        const [line] = chooseEliasPrice(settings, [], part, item, price, 22, 'lieve', 60)
        expect(line).toMatchObject({ unitPrice: price, estimatedMinutes: 0, materialsIncluded: true })
      }
    }
    expect(entry('cofano').prices).toEqual([200, 250])
    expect(entry('tetto').prices).toEqual([300, 350])
    expect(entry('sottoporta').prices).toEqual([150, 170])
  })

  it('sostituisce mezzo/intero paraurti senza duplicare né toccare altri pannelli', () => {
    const bumper = { id: 'paraurti-anteriore', name: 'Paraurti anteriore' }
    let lines = chooseEliasPrice(settings, [], panel, entry('porta'), 150, 22, 'lieve', 60)
    lines = chooseEliasPrice(settings, lines, bumper, entry('paraurti-anteriore'), 185, 22, 'lieve', 60)
    lines = chooseEliasPrice(settings, lines, bumper, entry('mezzo-paraurti'), 80, 22, 'lieve', 60)
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => line.unitPrice)).toEqual([150, 80])
  })

  it('porta da 150 euro produce 183 euro IVA inclusa anche nei due documenti', () => {
    const [base] = chooseEliasPrice(settings, [], panel, entry('porta'), 150, 22, 'lieve', 60)
    const line = recalculateDamageLine({ ...base, estimatedMinutes: 120 }, settings)
    const quote = updateConsumptionLine({ ...createDefaultQuote(settings, '2026-10'), damageLines: [line] }, .2)
    expect(buildAcceptanceQuoteSummary(quote)).toMatchObject({ materials: { total: 0 }, taxableAmount: 150, total: 183 })
    const initial = { ...structuredClone(emptyData), customers: [{ id: 'c', name: 'Cliente prova', type: 'Privato' as const, phone: '', email: '', taxId: '', address: '', createdAt: '' }],
      vehicles: [{ id: 'v', customerId: 'c', plate: 'TEST001' } as typeof emptyData.vehicles[number]] }
    const data = createEstimate(initial, { customerId: 'c', vehicleId: 'v', plate: 'TEST001', companyName: '', contactName: '', date: '2026-10-03', notes: '', lines: acceptanceEstimateLines(quote) })
    expect(data.estimates![0]).toMatchObject({ total: 183, lines: [{ materialsIncluded: true, standardWorkId: 'elias-listino:porta', estimatedMinutes: 120 }] })
    const customerDocument = createQuoteDocument(data, { customerId: 'c', vehicleId: 'v', lines: data.estimates![0].lines.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, vatRate: item.vatRate, discountRate: 0 })) })
    expect(customerDocument.quotes![0].total).toBe(183)
    const extra = recalculateDamageLine({ ...line, id: 'extra', materialsIncluded: false, unitPrice: 50 }, settings)
    const mixed = updateConsumptionLine({ ...quote, damageLines: [line, extra] }, .2)
    expect(buildAcceptanceQuoteSummary(mixed)).toMatchObject({ materials: { total: 10 }, total: 256.2 })
  })

  it('salva e ricarica ore, prezzo e materiali inclusi del danno lieve', async () => {
    const [base] = chooseEliasPrice(settings, [], panel, entry('porta'), 150, 22, 'lieve', 60)
    const line = recalculateDamageLine({ ...base, estimatedMinutes: 90 }, settings)
    const data = structuredClone(emptyData)
    data.plannerSettings.minorDamagePresets = [makeMinorDamagePreset(panel, [line])]
    await saveDatabase(data)
    const loaded = await loadDatabase()
    expect(minorDamageLines(loaded.plannerSettings, panel, 22)[0]).toMatchObject({ unitPrice: 150, estimatedMinutes: 90, materialsIncluded: true })
    expect(() => acceptanceEstimateLines({ ...createDefaultQuote(settings, '2026-10'), damageLines: [base] })).toThrow('Completa tempo')
  })
})
