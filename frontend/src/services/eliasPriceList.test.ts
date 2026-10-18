import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { ELIAS_PRICE_LIST, ELIAS_MINOR_TIMES, panelTaskDescription, eliasPricesForPanel } from './eliasPriceList'
import { chooseEliasPrice, acceptanceEstimateLines, makeMinorDamagePreset, minorDamageLines, recalculateDamageLine } from './damageQuote'
import { buildAcceptanceQuoteSummary, createDefaultQuote, updateConsumptionLine } from './acceptance'
import { defaultPlannerSettings, emptyData } from './erp'
import { approveEstimateAndCreateJob, createEstimate } from './workflow'
import { createQuoteDocument } from './documents'
import { loadDatabase, saveDatabase } from './database'
import { QUOTE_PANELS } from '../features/workflow/vehiclePanels'

const settings = structuredClone(defaultPlannerSettings)
const panel = { id: 'porta-ant-sx', name: 'Porta anteriore SX' }
const entry = (id: string) => ELIAS_PRICE_LIST.find((item) => item.id === id)!

describe('listino Elias dalla foto', () => {
  it('rende raggiungibili tutte le voci singole dai pannelli, con alternative e senza tempi inventati', () => {
    expect(ELIAS_PRICE_LIST).toHaveLength(30)
    for (const item of ELIAS_PRICE_LIST) {
      const part = QUOTE_PANELS.find((candidate) => eliasPricesForPanel(candidate.id).some((price) => price.id === item.id))!
      expect(part, item.name).toBeDefined()
      for (const price of item.prices) {
        const [line] = chooseEliasPrice(settings, [], part, item, price, 22, 'lieve', 60)
        expect(line).toMatchObject({ unitPrice: item.manualPricing ? 0 : price, estimatedMinutes: Object.values(ELIAS_MINOR_TIMES[item.timeSourceId ?? item.id] ?? {}).reduce((sum, minutes) => sum + (minutes ?? 0), 0), materialsIncluded: true })
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
    const line = recalculateDamageLine({ ...base, estimatedMinutes: 90, minorDamageTimes: undefined }, settings)
    const data = structuredClone(emptyData)
    data.plannerSettings.minorDamagePresets = [makeMinorDamagePreset(panel, [line])]
    await saveDatabase(data)
    const loaded = await loadDatabase()
    expect(minorDamageLines(loaded.plannerSettings, panel, 22)[0]).toMatchObject({ unitPrice: 150, estimatedMinutes: 90, materialsIncluded: true })
    expect(() => acceptanceEstimateLines({ ...createDefaultQuote(settings, '2026-10'), damageLines: [{ ...base, estimatedMinutes: 0 }] })).toThrow('Completa tempo')
  })
})

it('separa anteriore/posteriore e applica il tempario soltanto ai singoli pannelli scelti', () => {
 const front={id:'paraurti-anteriore',name:'Paraurti anteriore'}
 const rear={id:'paraurti-posteriore',name:'Paraurti posteriore'}
 let lines=chooseEliasPrice(settings,[],front,entry('mezzo-paraurti'),80,22,'lieve',60)
 expect(lines).toHaveLength(1)
 expect(lines[0]).toMatchObject({standardWorkName:'½ paraurti anteriore',estimatedMinutes:90,unitPrice:80,quantity:1})
 lines=chooseEliasPrice(settings,lines,rear,entry('mezzo-paraurti'),80,22,'lieve',60)
 expect(lines.map(l=>l.standardWorkName)).toEqual(['½ paraurti anteriore','½ paraurti posteriore'])
 expect(lines.map(l=>l.estimatedMinutes)).toEqual([90,90])
 const quote={...createDefaultQuote(settings,'2026-10'),damageLines:lines}
 const estimated=createEstimate(structuredClone(emptyData),{customerId:'c',plate:'PANEL01',companyName:'',contactName:'',date:'2026-10-18',notes:'',lines:acceptanceEstimateLines(quote)})
 const job=approveEstimateAndCreateJob(estimated,estimated.estimates![0].id).jobs![0]
 expect(job.taxableAmount).toBe(160)
 expect(job.phases.reduce((sum,p)=>sum+p.estimatedMinutes,0)).toBe(180)
 const left={id:'parafango-ant-sx',name:'Parafango anteriore SX'}
 const right={id:'rear-fender-right',name:'Parafango posteriore DX'}
 expect(chooseEliasPrice(settings,[],left,entry('parafango'),150,22,'lieve',60)[0]).toMatchObject({standardWorkName:left.name,estimatedMinutes:175})
 expect(chooseEliasPrice(settings,[],right,entry('parafango'),150,22,'lieve',60)[0]).toMatchObject({standardWorkName:right.name,estimatedMinutes:175})
})
it('normalizza il pannello delle vecchie descrizioni sul tablet senza inventare un lato o modificare il dato originale', () => {
 const old='½ paraurti anteriore/posteriore · Paraurti posteriore (lieve) · materiali inclusi'
 expect(panelTaskDescription(old,'Paraurti posteriore')).toBe('½ paraurti posteriore (lieve) · materiali inclusi')
 expect(panelTaskDescription('Parafango anteriore/posteriore · Parafango anteriore SX (lieve)','Parafango anteriore SX')).toBe('Parafango anteriore SX (lieve)')
 expect(panelTaskDescription(old)).toBe(old)
})
it('rende profilo e maniglia due alternative individuali con il tempo del singolo pezzo', () => {
 const panel={id:'maniglia-ant-sx',name:'Profilo/maniglia porta anteriore SX'}
 const options=eliasPricesForPanel(panel.id,panel.name)
 expect(options.map(o=>o.name)).toEqual(['Maniglia porta anteriore SX','Profilo porta anteriore SX'])
 let lines=chooseEliasPrice(settings,[],panel,options[0],35,22,'lieve',60)
 lines=chooseEliasPrice(settings,lines,panel,options[1],35,22,'lieve',60)
 expect(lines).toHaveLength(1)
 expect(lines[0]).toMatchObject({standardWorkName:'Profilo porta anteriore SX',estimatedMinutes:30,unitPrice:35})
})
