import {expect,it} from 'vitest'
import {emptyData} from './erp'
import {practiceQueueEntries} from './practiceQueues'
it('indexes approved fast estimates even without intake sheets, once per document rather than per plate',()=>{
 const data=structuredClone(emptyData)
 data.estimates=[{id:'e1',plate:'AA111AA',number:'P1',customerId:'c',status:'Approvato',date:'2026-10-31',total:100},{id:'e2',plate:'AA111AA',number:'P2',customerId:'c',status:'Bozza',date:'2026-10-31',total:200}] as never
 data.quotes=[{id:'q1',estimateId:'e1',status:'bozza',issueDate:'2026-10-31'},{id:'q2',estimateId:'e2',status:'bozza',issueDate:'2026-10-31'}] as never
 const before=JSON.stringify(data),entries=practiceQueueEntries(data)
 expect(entries).toHaveLength(2)
 expect(entries.filter(e=>e.confirmed).map(e=>e.number)).toEqual(['P1'])
 expect(entries.filter(e=>!e.confirmed).map(e=>e.number)).toEqual(['P2'])
 expect(JSON.stringify(data)).toBe(before)
})
it('keeps original intake editors, links by IDs and does not duplicate linked documents',()=>{
 const data=structuredClone(emptyData)
 data.acceptances=[{id:'a',customerId:'c',vehicleId:'v',status:'draft',createdAt:'2026-10-31',updatedAt:'2026-10-31'}] as never
 data.estimates=[{id:'e',number:'P',plate:'AA',status:'Approvato',date:'2026-10-31'}] as never
 data.quotes=[{id:'q',acceptanceId:'a',estimateId:'e',status:'accettato',issueDate:'2026-10-31'}] as never
 const entries=practiceQueueEntries(data)
 expect(entries).toHaveLength(1)
 expect(entries[0].acceptance).toBe(data.acceptances[0])
 expect(entries[0].confirmed).toBe(true)
})
it('shows quote-only drafts while excluding rejected/expired estimates and rejected quotes',()=>{
 const data=structuredClone(emptyData)
 data.estimates=[{id:'e',status:'Rifiutato',date:'2026-10-31'},{id:'old',status:'Scaduto',date:'2026-10-31'}] as never
 data.quotes=[{id:'q',number:'Q',status:'inviato',issueDate:'2026-10-31'},{id:'no',status:'rifiutato'}] as never
 expect(practiceQueueEntries(data).map(e=>e.id)).toEqual(['quote:q'])
})
