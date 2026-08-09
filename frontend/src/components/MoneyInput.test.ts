import { describe, expect, it } from 'vitest'
import { parseMoneyDraft } from './money'

describe('parseMoneyDraft', () => {
  it('accetta interi e decimali con virgola o punto', () => {
    expect(parseMoneyDraft('6000')).toBe(6000)
    expect(parseMoneyDraft('6000,50')).toBe(6000.5)
    expect(parseMoneyDraft('6000.50')).toBe(6000.5)
  })

  it('gestisce formati con separatori migliaia', () => {
    expect(parseMoneyDraft('6.000,50')).toBe(6000.5)
    expect(parseMoneyDraft('6,000.50')).toBe(6000.5)
  })

  it('restituisce null su input vuoto o non numerico', () => {
    expect(parseMoneyDraft('')).toBeNull()
    expect(parseMoneyDraft('abc')).toBeNull()
    expect(parseMoneyDraft('€')).toBeNull()
  })

  it('tronca oltre 2 decimali a livello di parsing normalizzato', () => {
    expect(parseMoneyDraft('100,999')).toBe(100.99)
  })
})
