import { it,expect } from 'vitest'
import { expectedPaymentDate } from './paymentTerms'
it('distingue consegna, giorni dalla fatturazione e data concordata esplicita',()=>{
 expect(expectedPaymentDate({method:'Bonifico',days:0,endOfMonth:false,expectedInvoiceDate:'',atDelivery:true},'2026-10-26')).toBe('2026-10-26')
 expect(expectedPaymentDate({method:'R.I.B.A.',days:60,endOfMonth:false,expectedInvoiceDate:'2026-10-26'})).toBe('2026-12-25')
 expect(expectedPaymentDate({method:'R.I.B.A.',days:30,endOfMonth:true,expectedInvoiceDate:'2026-10-26'})).toBe('2026-11-30')
 expect(expectedPaymentDate({method:'R.I.B.A.',days:90,endOfMonth:false,expectedInvoiceDate:'2026-10-26',expectedCollectionDate:'2027-02-01'})).toBe('2027-02-01')
})

it('calcola i 40 giorni con o senza fine mese',()=>{
 expect(expectedPaymentDate({method:'R.I.B.A.',days:40,endOfMonth:false,expectedInvoiceDate:'2026-10-26'})).toBe('2026-12-05')
 expect(expectedPaymentDate({method:'R.I.B.A.',days:40,endOfMonth:true,expectedInvoiceDate:'2026-10-26'})).toBe('2026-12-31')
})

it('calcola i 75 giorni anche passando all’anno successivo',()=>{
 expect(expectedPaymentDate({method:'R.I.B.A.',days:75,endOfMonth:false,expectedInvoiceDate:'2026-10-26'})).toBe('2027-01-09')
 expect(expectedPaymentDate({method:'R.I.B.A.',days:75,endOfMonth:true,expectedInvoiceDate:'2026-10-26'})).toBe('2027-01-31')
})
