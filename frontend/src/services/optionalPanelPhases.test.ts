import 'fake-indexeddb/auto'
import { describe,it,expect } from 'vitest'
import { emptyData } from './erp'
import { chooseEliasPrice, makeMinorDamagePreset, minorDamageLines, acceptanceEstimateLines } from './damageQuote'
import { ELIAS_PRICE_LIST } from './eliasPriceList'
import { optionalPanelPhases,setOptionalPanelPhase } from './optionalPanelPhases'
import { createDefaultQuote } from './acceptance'
import { createEstimate,approveEstimateAndCreateJob } from './workflow'
import { saveDatabase,loadDatabase } from './database'
const panel={id:'parafango-ant-dx',name:'Parafango anteriore DX'}
const entry=(id:string)=>ELIAS_PRICE_LIST.find(e=>e.id===id)!
const setup=()=>{
 const data=structuredClone(emptyData)
 const [line]=chooseEliasPrice(data.plannerSettings,[],panel,entry('parafango'),150,22,'lieve',60)
 return {data,line}
}
describe('lavorazioni facoltative per singolo pezzo',()=>{
 it('toglie soltanto S/R e lucidatura del pannello scelto senza cambiare prezzo o altro pannello',()=>{
  const {data,line}=setup();const second={...line,id:'other',panelId:'parafango-ant-sx',panelName:'Parafango anteriore SX'}
  let updated=setOptionalPanelPhase(line,'sr',false,data.plannerSettings)
  updated=setOptionalPanelPhase(updated,'lc',false,data.plannerSettings)
  expect(updated).toMatchObject({unitPrice:150,total:183,estimatedMinutes:100,minorDamageTimes:{sr:0,is:40,v:60,lc:0}})
  const quote={...createDefaultQuote(data.plannerSettings,'2026-10'),damageLines:[updated,second],manualOnlyPricing:true,selectedPhases:[]}
  const estimated=createEstimate(data,{customerId:'c',plate:'TEST123',companyName:'',contactName:'',date:'2026-10-18',notes:'',selectedPhases:[],lines:acceptanceEstimateLines(quote)})
  const job=approveEstimateAndCreateJob(estimated,estimated.estimates![0].id).jobs![0]
  expect(job.taxableAmount).toBe(300)
  expect(job.phases.reduce((sum,p)=>sum+p.estimatedMinutes,0)).toBe(275)
  expect(job.phases.find(p=>p.name==='Smontaggio')!.estimatedMinutes).toBe(60)
  expect(job.phases.find(p=>p.name==='Lucidatura')!.estimatedMinutes).toBe(15)
  expect(line.estimatedMinutes).toBe(175)
 })
 it('non assegna le fasi escluse e mantiene separato il servizio lucidatura totale',()=>{
  const {data,line}=setup()
  const without=setOptionalPanelPhase(setOptionalPanelPhase(line,'sr',false,data.plannerSettings),'lc',false,data.plannerSettings)
  const whole={id:'vettura-intera',name:'Vettura intera / interni'}
  const [polish]=chooseEliasPrice(data.plannerSettings,[],whole,entry('lucidatura-totale'),150,22,'lieve',60)
  expect(optionalPanelPhases(polish,data.plannerSettings)).toEqual([])
  const make=(lines:typeof line[])=>{
   const estimated=createEstimate(data,{customerId:'c',plate:'TEST123',companyName:'',contactName:'',date:'2026-10-18',notes:'',selectedPhases:[],lines})
   return approveEstimateAndCreateJob(estimated,estimated.estimates![0].id).jobs![0]
  }
  const only=make([without])
  expect(only.phases.find(p=>p.name==='Smontaggio')!.notRequired).toBe(true)
  expect(only.phases.find(p=>p.name==='Rimontaggio')!.notRequired).toBe(true)
  expect(only.phases.find(p=>p.name==='Lucidatura')!.notRequired).toBe(true)
  const all=make([without,polish])
  expect(all.phases.find(p=>p.name==='Lucidatura')!.estimatedMinutes).toBe(120)
  expect(all.taxableAmount).toBe(300)
 })
 it('ricarica le scelte memorizzate e ripristina il tempo originale quando riattivate',async()=>{
  const {data,line}=setup()
  const without=setOptionalPanelPhase(setOptionalPanelPhase(line,'sr',false,data.plannerSettings),'lc',false,data.plannerSettings)
  data.plannerSettings.minorDamagePresets=[makeMinorDamagePreset(panel,[without])]
  await saveDatabase(data);const loaded=await loadDatabase()
  const [restored]=minorDamageLines(loaded.plannerSettings,panel,22)
  expect(restored.estimatedMinutes).toBe(100)
  const withSr=setOptionalPanelPhase(restored,'sr',true,loaded.plannerSettings)
  expect(setOptionalPanelPhase(withSr,'lc',true,loaded.plannerSettings)).toMatchObject({estimatedMinutes:175,unitPrice:150})
 })
})
