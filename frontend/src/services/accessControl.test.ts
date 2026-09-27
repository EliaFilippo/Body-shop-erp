import { describe, expect, it } from 'vitest'
import { canAccessView, createAppUser, getDefaultActiveUser, setUserActive, upsertAppUser } from './accessControl'

describe('utenti, ruoli e autorizzazioni', () => {
  it('consente al titolare ogni area e protegge finanza/impostazioni dalla produzione', () => {
    expect(canAccessView('owner', 'database-diagnostics')).toBe(true)
    expect(canAccessView('office', 'finance')).toBe(true)
    expect(canAccessView('production', 'today-shop')).toBe(true)
    expect(canAccessView('production', 'finance')).toBe(false)
    expect(canAccessView('production', 'settings')).toBe(false)
  })

  it('crea utenti reali senza nomi vuoti e impedisce duplicati', () => {
    const stefania = createAppUser('  Stefania  ', 'office', '2026-09-27T14:00:00.000Z')
    expect(stefania.displayName).toBe('Stefania')
    expect(() => createAppUser('   ', 'production')).toThrow('nome')
    expect(() => upsertAppUser([stefania], { ...stefania, id: 'secondo' })).toThrow('già')
  })

  it('seleziona il titolare attivo come profilo iniziale', () => {
    const production = createAppUser('Giorgio', 'production')
    const owner = createAppUser('Filippo Elia', 'owner')
    expect(getDefaultActiveUser([production, owner])?.id).toBe(owner.id)
  })

  it('impedisce di disattivare l’unico titolare attivo', () => {
    const owner = createAppUser('Filippo Elia', 'owner')
    expect(() => setUserActive([owner], owner.id, false)).toThrow('unico titolare')
  })
})
