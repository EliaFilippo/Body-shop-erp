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
  settings.internalCostSettings = { usePlannerCapacity: false, internalHourlyRate: 0, minimumMarginPercent: 20, budgetMaterialsPercent: 20,
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

  it('non fattura extra automatici, conserva il prezzo al variare dei costi e ammette solo extra manuali', () => {
    const { settings, quote } = fixture()
    quote.damageLines![0].estimatedMinutes = 60
    const labor = quote.lines.find(line => line.kind === 'labor')!
    labor.quantity = 8
    labor.unitPrice = 75
    const consumption = quote.lines.find(line => line.kind === 'consumption')!
    consumption.unitPrice = 30
    consumption.unitCost = 30
    expect(buildAcceptanceQuoteSummary(quote).total).toBe(183)
    expect(calculateQuoteHourBudget(quote, settings)).toMatchObject({ revenue: 150, materialsCost: 30 })
    expect(acceptanceEstimateLines(quote, settings)).toHaveLength(1)
    settings.operators[0].hourlyCost = 40
    settings.internalCostSettings!.monthlyCostItems![0].monthlyAmount = 12000
    calculateQuoteHourBudget(quote, settings)
    expect(quote.damageLines![0].unitPrice).toBe(150)
    expect(buildAcceptanceQuoteSummary(quote).total).toBe(183)
    quote.lines.push({id:'extra',kind:'external',description:'Extra autorizzato',quantity:1,unitPrice:50,unitCost:40,source:'manual'})
    expect(buildAcceptanceQuoteSummary(quote).total).toBe(244)
    expect(acceptanceEstimateLines(quote, settings)).toHaveLength(2)
  })

  it('aggiunge materiali soltanto su richiesta manuale e ne sottrae il costo dal budget interno', () => {
    const { settings, quote } = fixture()
    const material = quote.lines.find(line => line.kind === 'consumption')!
    Object.assign(material, {unitPrice:30,unitCost:30,source:'manual'})
    expect(buildAcceptanceQuoteSummary(quote).total).toBe(219.6)
    expect(calculateQuoteHourBudget(quote, settings)).toMatchObject({revenue:180,materialsCost:30,directCosts:30,available:120,maxMinutes:144})
  })

  it('mostra il limite da tutte le spese anche prima di scegliere l’operatore o inserire i tempi tecnici', () => {
    const { settings, quote } = fixture()
    quote.budgetOperatorId = ''
    quote.damageLines![0].estimatedMinutes = 0
    const budget = calculateQuoteHourBudget(quote, settings)
    expect(budget.structure).toMatchObject({ totalMonthlyCosts: 10000, allInRate: 50, productiveHours: 200 })
    expect(budget).toMatchObject({ available: 120, baseMaxMinutes: 144, baseTargetMinutes: 108, maxMinutes: null })
  })

  it('ricalcola la tariffa dai turni di Martin nel mese del preventivo, escludendo ferie e domeniche', () => {
    const { settings, quote } = fixture()
    settings.internalCostSettings!.usePlannerCapacity = true
    settings.internalCostSettings!.productiveCapacity!.efficiencyPercent = 100
    settings.operators = [{ id: 'a', name: 'Martin', active: true, dailyHours: 10, hourlyCost: 20, weeklySchedule: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, active: dayOfWeek !== 0, intervals: [1,2,6].includes(dayOfWeek) ? [{startTime: '07:00', endTime: '12:00'}, {startTime: '14:00', endTime: '19:00'}] : [{startTime: '19:00', endTime: '23:00'}] })) }]
    quote.monthKey = '2026-10'
    const budget = calculateQuoteHourBudget(quote, settings)
    expect(budget.structure.productiveHours).toBe(186)
    expect(budget.structure.allInRate).toBeCloseTo(10000 / 186)
    expect(budget.baseMaxMinutes).toBe(133)
    settings.holidays = ['2026-10-10']
    const holiday = calculateQuoteHourBudget(quote, settings)
    expect(holiday.structure.productiveHours).toBe(176)
    expect(holiday.baseMaxMinutes).toBe(126)
    settings.internalCostSettings!.monthlyCostItems![0].monthlyAmount = 12000
    expect(calculateQuoteHourBudget(quote, settings).baseMaxMinutes).toBeLessThan(126)
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
