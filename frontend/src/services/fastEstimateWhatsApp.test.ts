import { emptyData } from './erp'
import { createEstimate } from './workflow'
import { fastEstimateWhatsAppLink } from './fastEstimateWhatsApp'
import { describe,it,expect } from 'vitest'
import { normalizeWhatsAppPhone } from './fastEstimateWhatsApp'
describe('numeri WhatsApp dei preventivi fast',()=>{
 it('aggiunge il prefisso italiano e conserva quelli esteri espliciti',()=>{
  expect(normalizeWhatsAppPhone('333 123 4567')).toBe('393331234567')
  expect(normalizeWhatsAppPhone('+39 (333) 123-4567')).toBe('393331234567')
  expect(normalizeWhatsAppPhone('0044 7700 900123')).toBe('447700900123')
  expect(normalizeWhatsAppPhone('+44 7700 900123')).toBe('447700900123')
 })
 it('rifiuta numeri mancanti, troppo corti o contenenti testo',()=>{
  for(const value of ['', '333', 'Mario 3331234567','+0000000000'])expect(()=>normalizeWhatsAppPhone(value)).toThrow()
 })
})

it('prepara solo un accompagnamento al PDF senza riepilogo economico',()=>{
 const data=createEstimate(structuredClone(emptyData),{customerId:'c',plate:'GL587FB',companyName:'Cliente',contactName:'',date:'2026-10-27',notes:'',selectedPhases:[],lines:[{description:'Ripristino porta',category:'carrozzeria',quantity:2,unitPrice:150,discount:20,vatRate:22}]})
 const message=new URL(fastEstimateWhatsAppLink(data.estimates![0],'3331234567')).searchParams.get('text')!
 expect(message).toContain('in allegato il preventivo');expect(message).toContain('GL587FB');expect(message).not.toContain('280,00');expect(message).not.toContain('Ripristino porta');expect(message).not.toContain('IVA')
})
