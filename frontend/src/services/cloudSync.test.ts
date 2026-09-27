import { describe, expect, it, vi } from 'vitest'
import { CloudSnapshotConflictError, createCloudSnapshot, loadCloudSnapshot, updateCloudSnapshot } from './cloudSync'
import { emptyData } from './erp'

const config = { url: 'https://project.supabase.co', anonKey: 'public-key' }
const session = { accessToken: 'token', userId: 'user-1' }

describe('sincronizzazione snapshot cloud', () => {
  it('restituisce null quando l’azienda non ha ancora uno snapshot', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]', { status: 200 }))
    await expect(loadCloudSnapshot('company-1', session, config, fetcher as unknown as typeof fetch)).resolves.toBeNull()
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('company_id=eq.company-1')
  })

  it('legge e normalizza lo snapshot esistente', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([{ company_id: 'company-1', revision: 4, payload: emptyData, updated_at: '2026-09-27T10:00:00Z' }])))
    await expect(loadCloudSnapshot('company-1', session, config, fetcher as unknown as typeof fetch)).resolves.toMatchObject({ companyId: 'company-1', revision: 4 })
  })

  it('crea il primo snapshot associandolo all’utente autenticato', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([{ company_id: 'company-1', revision: 1, payload: emptyData, updated_at: '2026-09-27T10:00:00Z' }]), { status: 201 }))
    await expect(createCloudSnapshot('company-1', emptyData, session, config, fetcher as unknown as typeof fetch)).resolves.toMatchObject({ revision: 1 })
    const request = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({ company_id: 'company-1', revision: 1, updated_by: 'user-1' })
  })

  it('aggiorna solo la revisione attesa', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([{ company_id: 'company-1', revision: 8, payload: emptyData, updated_at: '2026-09-27T10:00:00Z' }])))
    await expect(updateCloudSnapshot('company-1', 7, emptyData, session, config, fetcher as unknown as typeof fetch)).resolves.toMatchObject({ revision: 8 })
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('revision=eq.7')
  })

  it('segnala un conflitto se un altro dispositivo ha già salvato', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]', { status: 200 }))
    await expect(updateCloudSnapshot('company-1', 7, emptyData, session, config, fetcher as unknown as typeof fetch)).rejects.toBeInstanceOf(CloudSnapshotConflictError)
  })
})
