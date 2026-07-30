import { describe, expect, it } from 'vitest'
import { addPlan, correctTime, deliveryRisk, emptyProduction, movePhase, startTimer, stopTimer, toggleQuality, type ProductionJob, type ProductionState } from './production'

const job:ProductionJob={vehicleId:'v1',phase:'Accettata',priority:'Alta',promisedDate:'2099-01-01',ownerId:'op1',estimatedHours:8,notes:'',authorization:'Autorizzata',quality:[{key:'q',label:'Q',required:true,done:false}],reopenedAt:''}
const state=():ProductionState=>({...structuredClone(emptyProduction),jobs:[structuredClone(job)],operators:[{id:'op1',name:'Filippo',role:'Titolare',dailyHours:8,skills:['Accettata'],active:true}]})

describe('produzione',()=>{
 it('registra avanzamento e storico',()=>{const next=movePhase(state(),'v1','Smontaggio','Filippo');expect(next.jobs[0].phase).toBe('Smontaggio');expect(next.phaseHistory[0].from).toBe('Accettata')})
 it('blocca pronta consegna senza checklist',()=>expect(()=>movePhase(state(),'v1','Pronta consegna','Filippo')).toThrow(/checklist/i))
 it('consente pronta consegna con checklist completa',()=>{const ready=toggleQuality(state(),'v1','q');expect(movePhase(ready,'v1','Pronta consegna','Filippo').jobs[0].phase).toBe('Pronta consegna')})
 it('impedisce timer multipli per operatore',()=>{const running=startTimer(state(),'v1','Accettata','op1');expect(()=>startTimer(running,'v1','Accettata','op1')).toThrow(/timer attivo/i)})
 it('ferma timer e impedisce tempi negativi',()=>{const running=startTimer(state(),'v1','Accettata','op1');const stopped=stopTimer(running,running.timeEntries[0].id);expect(stopped.timeEntries[0].minutes).toBeGreaterThan(0);expect(()=>correctTime(stopped,stopped.timeEntries[0].id,-1,'errore')).toThrow(/negativo/i)})
 it('richiede motivazione per correzione',()=>{const running=startTimer(state(),'v1','Accettata','op1');expect(()=>correctTime(running,running.timeEntries[0].id,20,'')).toThrow(/motivazione/i)})
 it('blocca sovraccarico operatore',()=>{const first=addPlan(state(),{vehicleId:'v1',operatorId:'op1',date:'2026-07-31',hours:8,phase:'Accettata',manual:true});expect(()=>addPlan(first,{vehicleId:'v1',operatorId:'op1',date:'2026-07-31',hours:1,phase:'Accettata',manual:true})).toThrow(/sovraccarico/i)})
 it('individua consegna a rischio per autorizzazione mancante',()=>{const s=state();s.jobs[0].authorization='Da richiedere';expect(deliveryRisk(s,s.jobs[0])).toBe('A rischio')})
})
