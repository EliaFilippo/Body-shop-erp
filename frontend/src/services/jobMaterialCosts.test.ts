import 'fake-indexeddb/auto'
import { describe,it,expect } from 'vitest'
import { emptyData } from './erp'
import { createEstimate,approveEstimateAndCreateJob } from './workflow'
import { calculateJobMaterialMargin,setJobMaterialActualCost } from './jobMaterialCosts'
import { loadDatabase,saveDatabase } from './database'
const setup=()=>{
 const data=structuredClone(emptyData)
 const estimated=createEstimate(data,{customerId:'c',plate:'TEST123',companyName:'',contactName:'',date:'2026-10-18',notes:'',selectedPhases:[],
  lines:[{description:'Riparazione',category:'carrozzeria',quantity:1,unitPrice:500,discount:0,vatRate:22,estimatedMinutes:120,internalHourlyRateUsed:30,budgetStructureRate:10,budgetOperatorRate:20,budgetMaterialsCost:100,budgetMaterialsPercent:20}]})
 return approveEstimateAndCreateJob(estimated,estimated.estimates![0].id)
}
describe('materiali a consuntivo',()=>{
 it('sostituisce il 20% senza sommarlo e aggiorna il margine senza cambiare preventivo o tariffe',()=>{
  const data=setup();const job=data.jobs![0]
  expect(calculateJobMaterialMargin(job)).toMatchObject({estimatedMaterials:100,actualMaterials:null,otherCosts:60,margin:340})
  const before=JSON.stringify({estimates:data.estimates,quotes:data.quotes,lines:job.lines,phases:job.phases,total:job.total})
  const next=setJobMaterialActualCost(data,job.id,80,'Consumo reale')
  expect(calculateJobMaterialMargin(next.jobs![0])).toMatchObject({estimatedMaterials:100,actualMaterials:80,margin:360,materialsSaving:20,marginPercent:72})
  expect(JSON.stringify({estimates:next.estimates,quotes:next.quotes,lines:next.jobs![0].lines,phases:next.jobs![0].phases,total:next.jobs![0].total})).toBe(before)
  expect(calculateJobMaterialMargin(setJobMaterialActualCost(next,job.id,150).jobs![0]).margin).toBe(290)
 })
 it('accetta zero, conserva le revisioni ed evita duplicati su salvataggi identici',()=>{
  const data=setup();const job=data.jobs![0]
  const next=setJobMaterialActualCost(data,job.id,0,'Nessun consumo')
  expect(calculateJobMaterialMargin(next.jobs![0])).toMatchObject({appliedMaterials:0,margin:440})
  expect(setJobMaterialActualCost(next,job.id,0,'Nessun consumo')).toBe(next)
  const revised=setJobMaterialActualCost(next,job.id,25,'Correzione')
  expect(revised.jobs![0].materialCostHistory).toHaveLength(2)
  expect(revised.jobs![0].materialCostHistory![0]).toMatchObject({before:0,amount:25})
  expect(()=>setJobMaterialActualCost(data,job.id,-1)).toThrow('valido')
  expect(()=>setJobMaterialActualCost(data,job.id,NaN)).toThrow('valido')
 })
 it('mantiene separati i ricambi e sostituisce anche i consumabili manuali già preventivati',()=>{
  const job=setup().jobs![0]
  job.lines.push({...job.lines[0],id:'parts',category:'ricambi',budgetDirectUnitCost:50,quantity:2,unitPrice:75,taxableAmount:150},
   {...job.lines[0],id:'manual',category:'materiali',budgetDirectUnitCost:10,quantity:1,unitPrice:20,taxableAmount:20})
  job.taxableAmount=670
  expect(calculateJobMaterialMargin({...job,materialActualCost:{amount:80,at:'',note:''}})).toMatchObject({estimatedMaterials:110,otherCosts:160,margin:430})
 })
 it('ricarica i materiali reali salvati e distingue costi mancanti da un margine reale',async()=>{
  const data=setup();const next=setJobMaterialActualCost(data,data.jobs![0].id,80,'Nota')
  await saveDatabase(next);const loaded=await loadDatabase()
  expect(calculateJobMaterialMargin(loaded.jobs![0]).margin).toBe(360)
  expect(loaded.jobs![0].materialCostHistory![0].note).toBe('Nota')
  const missing={...loaded.jobs![0],lines:loaded.jobs![0].lines.map(l=>({...l,internalHourlyRateUsed:undefined,internalCostAmount:undefined}))}
  expect(calculateJobMaterialMargin(missing)).toMatchObject({actualMaterials:80,margin:null,missingCosts:true})
 })
})
