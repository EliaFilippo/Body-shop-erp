import { describe,it,expect } from 'vitest'
import { liveTimeAlert, type LiveFeed } from './liveProduction'
const feed=(remaining=300):LiveFeed=>({companyId:'c',serverNow:'',role:'production',operatorName:'Stefania',members:[],jobs:[{
 jobId:'j',plate:'TEST123',number:'COMM-1',remainingSeconds:1,remainingPercent:1,activeCount:1,ownStatus:'running',ownPhaseId:'wash',operators:[],
 phases:[{id:'wash',name:'Lavaggio esterno',status:'In lavorazione',notRequired:false,checkedBy:null,checkedAt:null,canComplete:true,
 standardClock:{label:'Lavaggio esterno',totalMinutes:25,remainingSeconds:remaining,ownRemainingSeconds:remaining,ownBurnFactor:1,remainingPercent:remaining/1500*100,activeCount:1}}]
}]})
describe('avviso rosso a schermo intero',()=>{
 it('su 25 minuti si attiva a 5 minuti residui e anche dopo l’esaurimento',()=>{
  expect(liveTimeAlert(feed(301),0)).toBeNull()
  expect(liveTimeAlert(feed(300),0)).toMatchObject({seconds:300,exhausted:false})
  expect(liveTimeAlert(feed(301),2)).toMatchObject({seconds:299})
  expect(liveTimeAlert(feed(0),0)).toMatchObject({seconds:0,exhausted:true})
 })
 it('non usa il limite economico al posto del tempo tecnico e non inventa tempi mancanti',()=>{
  expect(liveTimeAlert(feed(900),0)).toBeNull()
  const missing=feed();missing.jobs[0].phases![0].standardClock={...missing.jobs[0].phases![0].standardClock!,remainingSeconds:null,ownRemainingSeconds:null,totalMinutes:0}
  expect(liveTimeAlert(missing,0)).toBeNull()
 })
 it('si spegne in pausa, alla fine e con dati non aggiornati senza reagire ai timer altrui',()=>{
  const paused=feed();paused.jobs[0].ownStatus='paused';expect(liveTimeAlert(paused,0)).toBeNull()
  paused.jobs[0].ownStatus='finished';expect(liveTimeAlert(paused,0)).toBeNull()
  expect(liveTimeAlert(feed(),0,true)).toBeNull()
  const other=feed();other.jobs[0].ownStatus=null;expect(liveTimeAlert(other,0)).toBeNull()
 })
})
