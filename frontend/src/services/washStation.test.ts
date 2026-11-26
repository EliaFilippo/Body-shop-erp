import { expect,it } from 'vitest'
import { findWashStationStart,isWashingPhase,currentWashReservations } from './washStation'
it('una postazione dedicata al lavaggio esterno senza attesa aggiuntiva',()=>{
 const end=(s:string)=>new Date(Date.parse(s)+25*60000).toISOString()
 const reservations=[{jobId:'first',startAt:'2026-10-26T08:00:00.000Z',endAt:'2026-10-26T08:25:00.000Z'}]
 expect(findWashStationStart('2026-10-26T08:00:00.000Z','second',reservations,end)).toBe('2026-10-26T08:25:00.000Z')
 expect(isWashingPhase('Lavaggio interni')).toBe(false)
 expect(isWashingPhase('Verniciatura')).toBe(false)
})

it('manual-only washing never reserves a virtual station; mixed work still does',()=>{
 const floor='2026-10-26T08:00:00.000Z'
 const end='2026-10-26T08:25:00.000Z'
 const job=(id:string,manualOnlyStationWork?:boolean)=>({id,status:'Pianificata',phases:[{id:'wash',name:'Lavaggio esterno',status:'In lavorazione',manualOnlyStationWork}]})
 const data={vehicles:[],jobs:[job('manual',true),job('mixed',false),job('legacy')]} as unknown as Parameters<typeof currentWashReservations>[0]
 expect(currentWashReservations(data,floor,()=>end).map(r=>r.jobId)).toEqual(['mixed','legacy'])
})
