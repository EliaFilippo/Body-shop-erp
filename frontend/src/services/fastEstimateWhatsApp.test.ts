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
