import { phaseResidualMinutes } from './planner'
import { describe,it,expect } from 'vitest'
import { emptyData } from './erp'
import { createEstimate, approveEstimateAndCreateJob } from './workflow'
import { chooseEliasPrice, acceptanceEstimateLines } from './damageQuote'
import { ELIAS_PRICE_LIST } from './eliasPriceList'
import { createDefaultQuote } from './acceptance'
import { WORK_CYCLE, buildSelectedWorkCycle } from './workCycle'
const input={customerId:'c1',plate:'AA123BB',companyName:'',contactName:'',date:'2026-10-04',notes:'',selectedPhases:['Incartatura','Scartatura','Lavaggio interni'],lines:[{description:'Porta',category:'verniciatura' as const,quantity:1,unitPrice:150,discount:0,vatRate:22,standardWorkName:'Verniciatura',estimatedMinutes:90,lineTotalMinutes:90}]}
describe('ciclo richiesto carrozzeria',()=>{
 it('conserva l’ordine, include le righe e salta solo gli interventi non richiesti',()=>{
  const data=createEstimate(structuredClone(emptyData),input);const job=approveEstimateAndCreateJob(data,data.estimates![0].id).jobs![0]
  expect(job.workflowCycle).toBe('elias-v1');expect(job.phases.map(p=>p.name)).toEqual([...WORK_CYCLE])
  expect(job.phases.filter(p=>!p.notRequired).map(p=>p.name)).toEqual(['Stuccatura','Incartatura','Verniciatura','Scartatura','Lavaggio interni','Consegna'])
  const paint=job.phases.find(p=>p.name==='Verniciatura')!;expect(paint.estimatedMinutes).toBe(0);expect(paint.technicalWaitMinutes).toBe(60)
  expect(paint.technicalWaitBlocksPhaseNames).toContain('Scartatura')
  expect(job.phases.find(p=>p.name==='Incartatura')!.estimatedMinutes).toBe(0)
 })
 it('non trasforma le commesse senza selezione fasi e rifiuta fasi inesistenti',()=>{
  const data=createEstimate(structuredClone(emptyData),{...input,selectedPhases:undefined});const job=approveEstimateAndCreateJob(data,data.estimates![0].id).jobs![0]
  expect(job.workflowCycle).toBeUndefined();expect(job.phases.some(p=>p.name==='Preparazione')).toBe(true)
  expect(()=>buildSelectedWorkCycle([],['inventata'])).toThrow('non valida')
 })
})

describe('tempario lieve condiviso', () => {
 it('porta il tempario dalla scelta del prezzo fino alla commessa senza moltiplicare tempi o prezzi', () => {
  const data = structuredClone(emptyData)
  const bumper = { id: 'paraurti-anteriore', name: 'Paraurti anteriore' }
  const entry = ELIAS_PRICE_LIST.find(e => e.id === bumper.id)!
  const lines = chooseEliasPrice(data.plannerSettings, [], bumper, entry, 185, 22, 'lieve', 60)
  const quote = { ...createDefaultQuote(data.plannerSettings, '2026-10'), damageLines: lines }
  const estimated = createEstimate(data, { ...input, selectedPhases: undefined, lines: acceptanceEstimateLines(quote) })
  const job = approveEstimateAndCreateJob(estimated, estimated.estimates![0].id).jobs![0]
  expect(job.workflowCycle).toBe('elias-v1')
  expect(job.taxableAmount).toBe(185)
  expect(job.phases.reduce((sum,p)=>sum+p.estimatedMinutes,0)).toBe(225)
  expect(job.phases.find(p=>p.name==='Smontaggio')).toMatchObject({ estimatedMinutes:90, sharedTimeMinutes:90, sharedTimeKey:'sr' })
  expect(job.phases.find(p=>p.name==='Rimontaggio')).toMatchObject({ estimatedMinutes:0, sharedTimeMinutes:90, sharedTimeKey:'sr', notRequired:false })
  expect(job.phases.find(p=>p.name==='Stuccatura')).toMatchObject({ estimatedMinutes:75, sharedTimeMinutes:75, sharedTimeKey:'v', notRequired:false })
  expect(job.phases.find(p=>p.name==='Verniciatura')).toMatchObject({ estimatedMinutes:0, sharedTimeMinutes:75, technicalWaitMinutes:60, notRequired:false })
  expect(job.phases.find(p=>p.name==='Lattoneria')?.notRequired).toBe(true)
 })
 it('mantiene manuali danni gravi e lavaggio con sedili; non applica il tempario a preventivi esistenti', () => {
  const settings = structuredClone(emptyData.plannerSettings)
  const panel = {id:'vettura-intera',name:'Vettura intera'}
  const manual = ELIAS_PRICE_LIST.find(e=>e.id==='interni-smontaggio')!
  const [line] = chooseEliasPrice(settings,[],panel,manual,100,22,'lieve',60)
  expect(line).toMatchObject({unitPrice:0,estimatedMinutes:0})
  const wash = ELIAS_PRICE_LIST.find(e=>e.id==='interni')!
  const [washing] = chooseEliasPrice(settings,[],panel,wash,50,22,'lieve',60)
  expect(washing).toMatchObject({estimatedMinutes:120,minorDamageTimes:{la:120}})
  const [grave] = chooseEliasPrice(settings,[],panel,wash,50,22,'grave',60)
  expect(grave.estimatedMinutes).toBe(0); expect(grave.minorDamageTimes).toBeUndefined()
  const [old] = chooseEliasPrice(settings,[{...washing,estimatedMinutes:45,minorDamageTimes:undefined}],panel,wash,50,22,'lieve',60)
  expect(old.estimatedMinutes).toBe(45);expect(old.minorDamageTimes).toBeUndefined()
 })
})

it('usa 25 minuti di lavaggio esterno per vettura, anche con più pannelli, conservando un tempo manuale esplicito', () => {
 const estimated=createEstimate(structuredClone(emptyData),{...input,selectedPhases:['Lavaggio esterno'],lines:[...input.lines,{...input.lines[0],description:'Cofano'}]})
 const job=approveEstimateAndCreateJob(estimated,estimated.estimates![0].id).jobs![0]
 expect(job.phases.find(p=>p.name==='Lavaggio esterno')).toMatchObject({estimatedMinutes:25,notRequired:false,notes:''})
 expect(job.phases.reduce((sum,p)=>sum+p.estimatedMinutes,0)).toBe(205)
 const manual=buildSelectedWorkCycle([{...job.lines[0],standardWorkName:'Lavaggio esterno',estimatedMinutes:40,lineTotalMinutes:40}],['Lavaggio esterno'])
 expect(manual.find(p=>p.name==='Lavaggio esterno')!.estimatedMinutes).toBe(40)
})

it('condivide i minuti manuali tra stuccatura e verniciatura senza raddoppiarli',()=>{
 const source=buildSelectedWorkCycle([{id:'s',description:'Stuccatura',standardWorkName:'Stuccatura',category:'carrozzeria',quantity:1,unitPrice:100,discount:0,vatRate:22,estimatedMinutes:20,lineTotalMinutes:20,taxableAmount:100,vatAmount:22,total:122},
 {id:'v',description:'Verniciatura',standardWorkName:'Verniciatura',category:'verniciatura',quantity:1,unitPrice:100,discount:0,vatRate:22,estimatedMinutes:40,lineTotalMinutes:40,taxableAmount:100,vatAmount:22,total:122}],['Stuccatura'])
 expect(source.filter(p=>!p.notRequired).map(p=>p.name)).toEqual(['Stuccatura','Verniciatura','Consegna'])
 expect(source.find(p=>p.name==='Verniciatura')).toMatchObject({estimatedMinutes:0,sharedTimeMinutes:60,technicalWaitMinutes:60})
})

it('ripartisce i tempi manuali della singola riga senza moltiplicare il prezzo',()=>{
 const data=createEstimate(structuredClone(emptyData),{...input,selectedPhases:[],lines:[{
  description:'Paraurti manuale',category:'verniciatura',quantity:1,unitPrice:185,discount:0,vatRate:22,
  estimatedMinutes:90,manualPhaseTimes:[{phase:'Incartatura',minutes:20},{phase:'Verniciatura',minutes:60},{phase:'Scartatura',minutes:10}]
 }]})
 const job=approveEstimateAndCreateJob(data,data.estimates![0].id).jobs![0]
 expect(job.taxableAmount).toBe(185)
 expect(job.phases.filter(phase=>!phase.notRequired).map(phase=>[phase.name,phase.estimatedMinutes])).toEqual([['Stuccatura',60],['Incartatura',20],['Verniciatura',0],['Scartatura',10],['Consegna',0]])
})

it('detrarre 55 minuti di preparazione lascia 35 minuti alla verniciatura dello stesso V90',()=>{
 const initial=createEstimate(structuredClone(emptyData),{...input,selectedPhases:[],lines:input.lines})
 const job=approveEstimateAndCreateJob(initial,initial.estimates![0].id).jobs![0]
 const phases=job.phases.map(p=>p.name==='Stuccatura'?{...p,status:'Completata' as const,actualMinutes:55}:p)
 const painted=phases.find(p=>p.name==='Verniciatura')!
 expect(phaseResidualMinutes(painted,'2026-10-26T10:00:00Z',{...job,phases})).toBe(35)
 expect(phases.reduce((sum,p)=>sum+p.estimatedMinutes,0)).toBe(90)
 expect(phases.find(p=>p.name==='Incartatura')!.sharedTimeKey).not.toBe('v')
})

it('includes transport only when requested, with its own manual time before office delivery',()=>{
 const lines=[{...input.lines[0],category:'altre' as const,standardWorkName:'Trasporto',estimatedMinutes:45,lineTotalMinutes:45}]
 const phases=buildSelectedWorkCycle(lines,[])
 expect(phases.filter(p=>!p.notRequired).map(p=>p.name)).toEqual(['Trasporto','Consegna'])
 expect(phases.find(p=>p.name==='Trasporto')).toMatchObject({estimatedMinutes:45,requiredSkill:'Trasporto',notRequired:false})
 expect(buildSelectedWorkCycle([],[]).find(p=>p.name==='Trasporto')?.notRequired).toBe(true)
})
