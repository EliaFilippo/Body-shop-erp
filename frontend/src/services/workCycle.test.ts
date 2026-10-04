import { describe,it,expect } from 'vitest'
import { emptyData } from './erp'
import { createEstimate, approveEstimateAndCreateJob } from './workflow'
import { WORK_CYCLE, buildSelectedWorkCycle } from './workCycle'
const input={customerId:'c1',plate:'AA123BB',companyName:'',contactName:'',date:'2026-10-04',notes:'',selectedPhases:['Incartatura','Scartatura','Lavaggio interni'],lines:[{description:'Porta',category:'verniciatura' as const,quantity:1,unitPrice:150,discount:0,vatRate:22,standardWorkName:'Verniciatura',estimatedMinutes:90,lineTotalMinutes:90}]}
describe('ciclo richiesto carrozzeria',()=>{
 it('conserva l’ordine, include le righe e salta solo gli interventi non richiesti',()=>{
  const data=createEstimate(structuredClone(emptyData),input);const job=approveEstimateAndCreateJob(data,data.estimates![0].id).jobs![0]
  expect(job.workflowCycle).toBe('elias-v1');expect(job.phases.map(p=>p.name)).toEqual([...WORK_CYCLE])
  expect(job.phases.filter(p=>!p.notRequired).map(p=>p.name)).toEqual(['Incartatura','Verniciatura','Scartatura','Lavaggio interni','Consegna'])
  const paint=job.phases.find(p=>p.name==='Verniciatura')!;expect(paint.estimatedMinutes).toBe(90);expect(paint.technicalWaitMinutes).toBe(60)
  expect(paint.technicalWaitBlocksPhaseNames).toContain('Scartatura')
  expect(job.phases.find(p=>p.name==='Incartatura')!.estimatedMinutes).toBe(0)
 })
 it('non trasforma le commesse senza selezione fasi e rifiuta fasi inesistenti',()=>{
  const data=createEstimate(structuredClone(emptyData),{...input,selectedPhases:undefined});const job=approveEstimateAndCreateJob(data,data.estimates![0].id).jobs![0]
  expect(job.workflowCycle).toBeUndefined();expect(job.phases.some(p=>p.name==='Preparazione')).toBe(true)
  expect(()=>buildSelectedWorkCycle([],['inventata'])).toThrow('non valida')
 })
})
