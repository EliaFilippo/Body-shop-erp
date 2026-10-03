import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { calculateQuoteHourBudget, quoteStructureRate } from './quoteHourBudget'
import { buildAcceptanceQuoteSummary, createAcceptanceDraft, createDefaultQuote } from './acceptance'
import { chooseEliasPrice, acceptanceEstimateLines, recalculateDamageLine } from './damageQuote'
import { ELIAS_PRICE_LIST } from './eliasPriceList'
import { defaultPlannerSettings, emptyData } from './erp'
import { createEstimate } from './workflow'
import { loadDatabase, saveDatabase } from './database'

function fixture() {
  const settings = structuredClone(defaultPlannerSettings)
  settings.operators = [{ id: 'a', name: 'Operatore A', dailyHours: 8, active: true, hourlyCost: 20 }, { id: 'b', name: 'Operatore B', dailyHours: 8, active: true, hourlyCost: 30 }]
  settings.internalCostSettings = { internalHourlyRate: 0, minimumMarginPercent: 20, budgetMaterialsPercent: 20,
    monthlyCostItems: [{ id: 'overhead', category: 'affitto', description: 'Spese generali', monthlyAmount: 6000, active: true },
      { id: 'payroll', category: 'personale', description: 'Personale produttivo', monthlyAmount: 4000, active: true }],
    productiveCapacity: { productiveOperators: 2, hoursPerOperatorPerDay: 8, workingDaysPerMonth: 20, efficiencyPercent: 62.5 } }
  const panel = { id: 'porta-ant-sx', name: 'Porta anteriore SX' }
  const [line] = chooseEliasPrice(settings, [], panel, ELIAS_PRICE_LIST.find((item) => item.id === 'porta')!, 150, 22, 'lieve', 60)
  const quote = { ...createDefaultQuote(settings, '2026-10'), damageLines: [line], budgetOperatorId: 'a' }
  return { settings, quote, line }
}

describe('ore economiche a disposizione', () => {
  it('separa gli stipendi dai costi struttura, consente amministrativi e rate manuali senza doppio conteggio', () => {
    const { settings } = fixture()
    expect(quoteStructureRate(settings)).toMatchObject({ monthlyOverhead: 6000, excludedPayroll: 4000, productiveHours: 200, rate: 30 })
    settings.internalCostSettings!.monthlyCostItems!.push({ id: 'admin', category: 'personale', description: 'Segreteria', monthlyAmount: 1000, active: true, coveredByOperatorRates: false })
    expect(quoteStructureRate(settings).rate).toBe(35)
    settings.internalCostSettings!.budgetUseManualStructureRate = true
    settings.internalCostSettings!.budgetManualStructureRate = 25
    expect(quoteStructureRate(settings).rate).toBe(25)
  })

  it('150 euro meno 20% materiali a 30+20 euro/h dà 144 minuti a pareggio e 108 con margine 20%', () => {
    const { settings, quote } = fixture()
    expect(calculateQuoteHourBudget(quote, settings)).toMatchObject({ revenue: 150, materialsCost: 30, available: 120, maxMinutes: 144, targetMinutes: 108, error: '' })
    expect(buildAcceptanceQuoteSummary(quote).total).toBe(183)
    quote.budgetOperatorId = 'b'
    expect(calculateQuoteHourBudget(quote, settings).maxMinutes).toBe(120)
  })

  it('assegna operatori diversi ai pannelli senza sommarne le tariffe sulla stessa ora', () => {
    const { settings, quote, line } = fixture()
    quote.damageLines = [{ ...line, budgetOperatorId: 'a' }, { ...line, id: 'second', panelId: 'porta-ant-dx', budgetOperatorId: 'b' }]
    expect(calculateQuoteHourBudget(quote, settings)).toMatchObject({ maxMinutes: 264, targetMinutes: 198, materialsCost: 60 })
  })

  it('sconti e costi diretti riducono il budget e segnala costi mancanti', () => {
    const { settings, quote } = fixture()
    quote.lines.push({ id: 'discount', kind: 'discount', description: 'Sconto', quantity: 1, unitPrice: 30, unitCost: 0, source: 'manual' })
    expect(calculateQuoteHourBudget(quote, settings)).toMatchObject({ revenue: 120, materialsCost: 24, available: 96, maxMinutes: 115 })
    quote.lines.push({ id: 'external', kind: 'external', description: 'Lavoro esterno', quantity: 1, unitPrice: 50, unitCost: 40, source: 'manual' })
    expect(calculateQuoteHourBudget(quote, settings).directCosts).toBe(40)
    quote.lines[quote.lines.length - 1].unitCost = 0
    expect(calculateQuoteHourBudget(quote, settings).maxMinutes).toBeNull()
  })

  it('non inventa ore quando mancano costi, operatori o capacità produttiva', () => {
    const { settings, quote } = fixture()
    quote.budgetOperatorId = ''
    expect(calculateQuoteHourBudget(quote, settings).maxMinutes).toBeNull()
    quote.budgetOperatorId = 'a'
    settings.operators[0].hourlyCost = undefined
    expect(calculateQuoteHourBudget(quote, settings).maxMinutes).toBeNull()
    settings.operators[0].hourlyCost = 20
    settings.internalCostSettings!.productiveCapacity!.efficiencyPercent = 0
    expect(calculateQuoteHourBudget(quote, settings).maxMinutes).toBeNull()
  })

  it('conserva costi e assegnazioni e converte il preventivo con margine coerente', async () => {
    const { settings, quote, line } = fixture()
    quote.damageLines = [recalculateDamageLine({ ...line, estimatedMinutes: 108 }, settings)]
    expect(buildAcceptanceQuoteSummary(quote, settings)).toMatchObject({ costLive: 120, marginEuro: 30, marginPercent: 20 })
    const data = { ...structuredClone(emptyData), plannerSettings: settings }
    const draft = createAcceptanceDraft('c', 'v', settings, '2026-10')
    draft.quote = quote
    data.acceptances = [draft]
    await saveDatabase(data)
    const loaded = await loadDatabase()
    expect(calculateQuoteHourBudget(loaded.acceptances![0].quote, loaded.plannerSettings).targetMinutes).toBe(108)
    const converted = createEstimate(loaded, { customerId: 'c', vehicleId: 'v', plate: 'TEST001', companyName: '', contactName: '', date: '2026-10-03', notes: '', lines: acceptanceEstimateLines(quote, settings) })
    expect(converted.estimates![0].lines[0]).toMatchObject({ budgetOperatorId: 'a', budgetStructureRate: 30, budgetOperatorRate: 20, budgetMaterialsCost: 30, internalCostAmount: 120, theoreticalMarginAmount: 30 })
  })
})
