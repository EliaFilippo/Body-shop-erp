import { describe, expect, it, vi } from 'vitest'
import { bootstrapCloudCompany, getCloudAuthConfig, signInWithPassword, signOutCloud } from './cloudAuth'

const config = { url: 'https://project.supabase.co', anonKey: 'public-anon-key' }

describe('autenticazione cloud', () => {
  it('richiede una configurazione completa senza esporre chiavi private', () => {
    expect(getCloudAuthConfig({})).toBeNull()
    expect(getCloudAuthConfig({ VITE_SUPABASE_URL: `${config.url}/`, VITE_SUPABASE_ANON_KEY: config.anonKey })).toEqual(config)
  })

  it('accede con email/password e normalizza la sessione', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ access_token: 'token', refresh_token: 'refresh', expires_in: 3600, user: { id: 'auth-1', email: 'filippo@example.it' } }), { status: 200 })) as unknown as typeof fetch
    await expect(signInWithPassword(' Filippo@Example.it ', 'password-sicura', config, fetcher)).resolves.toEqual({ accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600, userId: 'auth-1', email: 'filippo@example.it' })
    expect(fetcher).toHaveBeenCalledWith(`${config.url}/auth/v1/token?grant_type=password`, expect.objectContaining({ method: 'POST' }))
  })

  it('non salva la password e restituisce un errore leggibile per credenziali errate', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error_description: 'Credenziali non valide' }), { status: 400 })) as unknown as typeof fetch
    await expect(signInWithPassword('filippo@example.it', 'errata', config, fetcher)).rejects.toThrow('Credenziali non valide')
  })

  it('chiude la sessione usando il token corrente', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    await expect(signOutCloud({ accessToken: 'token' }, config, fetcher)).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith(`${config.url}/auth/v1/logout`, expect.objectContaining({ method: 'POST' }))
  })

  it('crea o recupera l’azienda del primo utente autenticato', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ company_id: 'company-1', company_name: 'Carrozzeria Elias', role: 'owner' }]), { status: 200 })) as unknown as typeof fetch
    await expect(bootstrapCloudCompany({ accessToken: 'token' }, ' Carrozzeria Elias ', ' Filippo Elia ', config, fetcher)).resolves.toEqual({ companyId: 'company-1', companyName: 'Carrozzeria Elias', role: 'owner' })
    expect(fetcher).toHaveBeenCalledWith(`${config.url}/rest/v1/rpc/bootstrap_company`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ p_company_name: 'Carrozzeria Elias', p_member_display_name: 'Filippo Elia' }),
    }))
  })

  it('mostra l’errore restituito dal bootstrap cloud', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ message: 'Autenticazione richiesta' }), { status: 401 })) as unknown as typeof fetch
    await expect(bootstrapCloudCompany({ accessToken: 'token' }, 'Carrozzeria Elias', 'Filippo Elia', config, fetcher)).rejects.toThrow('Autenticazione richiesta')
  })
})
