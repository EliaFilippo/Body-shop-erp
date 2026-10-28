import { describe,it,expect } from 'vitest'
import { emptyData } from './erp'
import { sameCloudArchive,assertCloudPreservesLocalRecords,recoverMissingBusinessRecords } from './localRecovery'
import type { ErpData } from '../types'
const customer={id:'c',name:'Cliente',type:'Privato' as const,phone:'',email:'',taxId:'',address:'',createdAt:'2026-10-28T07:00:00Z'}
const vehicle={id:'v',plate:'AA123BB',customerId:'c',make:'Fiat',model:'Panda',vin:'',color:'',status:'in-lavorazione',coneNumber:13,createdAt:'2026-10-28T07:00:00Z'} as ErpData['vehicles'][number]
const data=()=>({...structuredClone(emptyData),customers:[customer],vehicles:[vehicle]})
describe('protezione inserimenti e recupero locale',()=>{
 it('blocca record scomparsi anche se un altro record mantiene uguale il conteggio',()=>{const local=data();const cloud=data();cloud.vehicles=[{...vehicle,id:'different'}];expect(()=>assertCloudPreservesLocalRecords(local,cloud)).toThrow('inserimenti assenti')})
 it('recupera nuovi inserimenti senza sostituire dati cloud, tariffe, timer o storico',()=>{const cloud=data();cloud.customers[0]={...customer,name:'Nome aggiornato'};cloud.nightlyPlanning={enabled:true,plannedFor:'today',generatedAt:'now',hour:3};const source=data();source.vehicles.push({...vehicle,id:'new',plate:'CC456DD',coneNumber:14});source.workflowCounters={estimate:14,job:13};const recovered=recoverMissingBusinessRecords(cloud,source);expect(recovered.customers[0].name).toBe('Nome aggiornato');expect(recovered.vehicles).toHaveLength(2);expect(recovered.vehicles[1].coneNumber).toBe(14);expect(recovered.nightlyPlanning).toEqual(cloud.nightlyPlanning);expect(recovered.workflowCounters?.estimate).toBe(14);expect(cloud.vehicles).toHaveLength(1);expect(recoverMissingBusinessRecords(recovered,source)).toEqual(recovered)})
 it('non duplica una targa o un numero di cono occupato',()=>{const cloud=data();const source=data();source.vehicles.push({...vehicle,id:'new',plate:'CC456DD'});expect(recoverMissingBusinessRecords(cloud,source).vehicles[1].coneNumber).toBeNull();source.vehicles[1].plate=vehicle.plate;expect(()=>recoverMissingBusinessRecords(cloud,source)).toThrow('identificativi diversi')})
 it('rifiuta riferimenti orfani prima di modificare gli archivi',()=>{const source=data();source.vehicles[0]={...vehicle,customerId:'missing'};expect(()=>recoverMissingBusinessRecords(structuredClone(emptyData),source)).toThrow('Cliente mancante')})
})

it('riconosce un invio già presente nel cloud senza ignorare modifiche ai record',()=>{
 const local=data(),remote=data();local.dbRevision=14;remote.dbRevision=12;remote.dbUpdatedAt='older'
 expect(sameCloudArchive(local,remote)).toBe(true)
 remote.vehicles[0]={...vehicle,model:'Different'}
 expect(sameCloudArchive(local,remote)).toBe(false)
})
