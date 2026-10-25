import { confirmedQuoteForecasts } from './cashflow'
import 'fake-indexeddb/auto'
import { describe,expect,it } from 'vitest'
import { emptyData } from './erp'
import { createDefaultQuote } from './acceptance'
import { chooseEliasPrice, makeMinorDamagePreset, minorDamageLines } from './damageQuote'
import { eliasPricesForPanel, ELIAS_PRICE_LIST } from './eliasPriceList'
import { createFastEstimate } from './fastEstimate'
import { loadDatabase,saveDatabase } from './database'
const panel={id:'porta-ant-sx',name:'Porta anteriore SX'}
const setup=()=>{
 const data=structuredClone(emptyData)
 data.plannerSettings.eliasPriceOverrides={porta:{prices:[300],times:{sr:30,is:30,v:60}}}
 const lines=chooseEliasPrice(data.plannerSettings,[],panel,eliasPricesForPanel(panel.id,panel.name,data.plannerSettings).find(e=>e.id==='porta')!,300,22,'lieve',60)
 return {data,quote:{...createDefaultQuote(data.plannerSettings,'2026-10'),manualOnlyPricing:true,damageLines:lines,selectedPhases:[]}}
}
const input={plate:'ab 123 cd',newCustomer:{name:'Mario Rossi',phone:'3331234567'},confirmed:false}
describe('preventivo fast',()=>{
 it('conserva un tempario manuale memorizzato quando cambia soltanto il prezzo di base',()=>{
  const {data,quote}=setup()
  const manual={...quote.damageLines[0],estimatedMinutes:95,lineTotalMinutes:95,minorDamageTimes:undefined}
  data.plannerSettings.minorDamagePresets=[makeMinorDamagePreset(panel,[manual])]
  data.plannerSettings.eliasPriceOverrides={porta:{prices:[320]}}
  const entry=eliasPricesForPanel(panel.id,panel.name,data.plannerSettings).find(e=>e.id==='porta')!
  expect(chooseEliasPrice(data.plannerSettings,[],panel,entry,320,22,'lieve',60)[0]).toMatchObject({unitPrice:320,estimatedMinutes:95})
  expect(minorDamageLines(data.plannerSettings,panel,22)[0]).toMatchObject({unitPrice:320,estimatedMinutes:95})
 })

 it('crea in un passaggio anagrafiche e preventivo numerato senza commessa né incasso',()=>{
  const {data,quote}=setup();const next=createFastEstimate(data,{...input,quote})
  expect(next.customers).toHaveLength(1);expect(next.vehicles[0].plate).toBe('AB123CD')
  expect(next.estimates![0]).toMatchObject({number:'PREV-00001',total:366,lines:[{estimatedMinutes:120,unitPrice:300}]})
  expect(next.quotes![0]).toMatchObject({estimateId:next.estimates![0].id,total:366,status:'bozza'})
  expect(next.jobs||[]).toHaveLength(0);expect(next.invoices||[]).toHaveLength(0)
  expect(data.customers).toHaveLength(0)
 })
 it('riconosce la vettura, conserva pagamenti e richiede conferma esplicita per la commessa',()=>{
  const {data,quote}=setup();const draft=createFastEstimate(data,{...input,quote})
  const base={...draft,estimates:[],quotes:[]}
  base.customers[0]={...base.customers[0],usualPaymentMethod:'R.I.B.A.',paymentDays:60,endOfMonth:true}
  base.plannerSettings.eliasExteriorWashMinutes=40
  const next=createFastEstimate(base,{plate:'AB123CD',quote:{...quote,selectedPhases:['Lavaggio esterno']},confirmed:true})
  expect(next.customers).toHaveLength(1);expect(next.vehicles).toHaveLength(1)
  expect(next.estimates![0].paymentTerms).toMatchObject({method:'R.I.B.A.',days:60,endOfMonth:true})
  expect(next.jobs).toHaveLength(1)
  expect(next.quotes![0].status).toBe('accettato')
  expect(next.jobs![0].phases.find(p=>p.name==='Lavaggio esterno')!.estimatedMinutes).toBe(40)
  expect(next.jobs![0].phases.reduce((s,p)=>s+p.estimatedMinutes,0)).toBe(160)
  expect(next.estimates![0].convertedJobId).toBe(next.jobs![0].id)
 })
 it('blocca duplicati e righe manuali incomplete senza modificare lo snapshot iniziale',()=>{
  const {data,quote}=setup();const next=createFastEstimate(data,{...input,quote})
  expect(()=>createFastEstimate(next,{...input,quote})).toThrow('preventivo aperto')
  const before=JSON.stringify(data)
  expect(()=>createFastEstimate(data,{...input,quote:{...quote,damageLines:[{...quote.damageLines[0],estimatedMinutes:0}]}})).toThrow('Completa tempo')
  expect(JSON.stringify(data)).toBe(before)
 })
 it('salva e ricarica eccezioni, tempario e prezzi, mantenendo lo storico dei preventivi',async()=>{
  const {data,quote}=setup();const next=createFastEstimate(data,{...input,quote})
  next.plannerSettings.eliasPriceOverrides!['porta-ant-sx:porta']={prices:[400],times:{v:45}}
  next.plannerSettings.eliasExteriorWashMinutes=25
  await saveDatabase(next);const loaded=await loadDatabase()
  expect(loaded.plannerSettings.eliasPriceOverrides).toEqual(next.plannerSettings.eliasPriceOverrides)
  expect(loaded.estimates![0].lines[0]).toMatchObject({unitPrice:300,estimatedMinutes:120})
  const [future]=chooseEliasPrice(loaded.plannerSettings,[],panel,ELIAS_PRICE_LIST.find(e=>e.id==='porta')!,400,22,'lieve',60)
  expect(future).toMatchObject({unitPrice:400,estimatedMinutes:45})
  const right={id:'porta-ant-dx',name:'Porta anteriore DX'}
  const [other]=chooseEliasPrice(loaded.plannerSettings,[],right,ELIAS_PRICE_LIST.find(e=>e.id==='porta')!,300,22,'lieve',60)
  expect(other).toMatchObject({unitPrice:300,estimatedMinutes:120})
 })
})

describe('validazione testo manuale',()=>{
 it('rifiuta una descrizione vuota anche quando prezzo e tempo sono compilati',()=>{
  const {data,quote}=setup()
  expect(()=>createFastEstimate(data,{...input,quote:{...quote,damageLines:[{...quote.damageLines[0],customerDescription:'  '}]}})).toThrow('descrizione')
 })
})

it('salva il pagamento Fast e la previsione di incasso senza creare RIBA bancarie',()=>{
 const {data,quote}=setup()
 const next=createFastEstimate(data,{...input,quote,confirmed:true,paymentTerms:{method:'R.I.B.A.',days:60,endOfMonth:false,expectedInvoiceDate:'2026-10-26',expectedCollectionDate:'2026-12-28'}})
 expect(next.estimates![0].paymentTerms?.expectedCollectionDate).toBe('2026-12-28')
 expect(next.quotes![0].paymentTerms?.method).toBe('R.I.B.A.')
 expect(confirmedQuoteForecasts(next)).toEqual([{amount:366,dueDate:'2026-12-28'}])
 expect(next.ribaBatches).toHaveLength(0)
})
