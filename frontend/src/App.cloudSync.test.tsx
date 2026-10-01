import 'fake-indexeddb/auto'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { emptyData } from './services/erp'
import { DB_NAME, loadDatabase, saveDatabase } from './services/database'
import { createCloudSnapshot, loadCloudSnapshot, updateCloudSnapshot, type CloudSnapshot } from './services/cloudSync'

const pendingSaves = vi.hoisted(() => [] as Promise<void>[])
vi.mock('./services/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/database')>()
  return {
    ...actual,
    saveDatabase: (...args: Parameters<typeof actual.saveDatabase>) => {
      const result = actual.saveDatabase(...args)
      pendingSaves.push(result)
      return result
    },
  }
})

vi.mock('./services/cloudAuth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./services/cloudAuth')>(),
  getCloudAuthConfig: () => ({ url: 'https://test.supabase.co', anonKey: 'test-public-key' }),
  bootstrapCloudCompany: vi.fn(async () => ({ companyId: 'company-1', companyName: 'Carrozzeria di prova', role: 'owner' })),
}))

vi.mock('./services/cloudSync', async (importOriginal) => ({
  ...await importOriginal<typeof import('./services/cloudSync')>(),
  loadCloudSnapshot: vi.fn(),
  createCloudSnapshot: vi.fn(),
  updateCloudSnapshot: vi.fn(),
}))

const session = { accessToken: 'test-token', refreshToken: 'test-refresh', userId: 'user-1', email: 'prova@example.test', expiresIn: 3600 }
const customer = { id: 'customer-cloud', type: 'Privato' as const, name: 'Cliente cloud', phone: '123', email: '', taxId: '', address: '', createdAt: '2026-09-27T10:00:00Z' }

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  sessionStorage.setItem('body-shop-erp.cloud-session.v1', JSON.stringify(session))
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  const local = structuredClone(emptyData)
  local.dbRevision = 11
  await saveDatabase(local)
  let remote: CloudSnapshot = {
    companyId: 'company-1', revision: 3, updatedAt: '2026-09-27T10:00:00Z',
    payload: { ...structuredClone(emptyData), dbRevision: 10, customers: [customer] },
  }
  vi.mocked(loadCloudSnapshot).mockImplementation(async () => structuredClone(remote))
  vi.mocked(updateCloudSnapshot).mockImplementation(async (_company, revision, payload) => {
    remote = { ...remote, revision: revision + 1, payload: structuredClone(payload) }
    return structuredClone(remote)
  })
  vi.mocked(createCloudSnapshot).mockImplementation(async (_company, payload) => ({ ...remote, revision: 1, payload }))
})

afterEach(async () => {
  cleanup()
  await act(async () => { await Promise.allSettled(pendingSaves) })
  pendingSaves.length = 0
})

describe('avvio e salvataggio cloud', () => {
  it('carica il cloud con revisione locale 12 e payload remoto 10, anche in StrictMode', async () => {
    render(<StrictMode><App /></StrictMode>)
    expect(await screen.findByText('Archivio sincronizzato dal cloud.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clienti' }))
    expect(await screen.findByText('Cliente cloud')).toBeInTheDocument()
    expect((await loadDatabase()).customers).toEqual([customer])
    expect(screen.queryByText(/conflitto revisione/)).not.toBeInTheDocument()
  })

  it('attende il caricamento cloud prima di aprire le modifiche e avviare autosave', async () => {
    let resolveRemote!: (value: CloudSnapshot | null) => void
    vi.mocked(loadCloudSnapshot).mockReturnValue(new Promise((resolve) => { resolveRemote = resolve }))
    render(<App />)
    await waitFor(() => expect(loadCloudSnapshot).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Nuovo cliente' })).not.toBeInTheDocument()
    expect((await loadDatabase()).dbRevision).toBe(12)
    expect(updateCloudSnapshot).not.toHaveBeenCalled()
    await act(async () => resolveRemote(null))
    expect(await screen.findByText('Archivio collegato e salvato nel cloud.')).toBeInTheDocument()
  })

  it('consente di riprovare dopo un errore iniziale senza modificare l’archivio locale', async () => {
    vi.mocked(loadCloudSnapshot).mockRejectedValueOnce(new Error('Connessione temporaneamente non disponibile.'))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Connessione temporaneamente non disponibile.')
    expect((await loadDatabase()).dbRevision).toBe(12)
    fireEvent.click(screen.getByRole('button', { name: 'Riprova sincronizzazione' }))
    expect(await screen.findByText('Archivio sincronizzato dal cloud.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('riprende gli invii dopo un errore e ricarica il cliente dal cloud con un archivio locale vuoto', async () => {
    vi.mocked(updateCloudSnapshot).mockRejectedValueOnce(new Error('Invio temporaneamente non riuscito.'))
    const app = render(<App />)
    expect(await screen.findByText('Invio temporaneamente non riuscito.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Nuovo cliente' }))
    fireEvent.change(screen.getByLabelText('Nome / ragione sociale'), { target: { value: 'Cliente salvato online' } })
    fireEvent.change(screen.getByLabelText('Telefono'), { target: { value: '456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }))
    await waitFor(() => expect(vi.mocked(updateCloudSnapshot).mock.calls.some(([, , payload]) => payload.customers.some((item) => item.name === 'Cliente salvato online'))).toBe(true))
    app.unmount()
    await act(async () => { await Promise.allSettled(pendingSaves) })
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    render(<App />)
    expect(await screen.findByText('Archivio sincronizzato dal cloud.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clienti' }))
    expect(await screen.findByText('Cliente salvato online')).toBeInTheDocument()
  })

  it('mostra un conflitto reale di un’altra scheda senza sovrascriverne i dati', async () => {
    vi.mocked(loadCloudSnapshot).mockImplementationOnce(async () => {
      const changed = await loadDatabase()
      changed.customers.push({ ...customer, id: 'other-tab', name: 'Cliente altra scheda' })
      await saveDatabase(changed)
      return { companyId: 'company-1', revision: 3, updatedAt: '', payload: structuredClone(emptyData) }
    })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Le modifiche sono conservate')
    expect((await loadDatabase()).customers[0].name).toBe('Cliente altra scheda')
    expect(updateCloudSnapshot).not.toHaveBeenCalled()
  })

  it('invia subito vettura e modifiche al cloud, conserva coni e consegna su un altro archivio', async () => {
    const app = render(<App />)
    await screen.findByText('Archivio sincronizzato dal cloud.')
    await waitFor(() => expect(updateCloudSnapshot).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Nuova vettura' }))
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: customer.id } })
    fireEvent.change(screen.getByLabelText('Targa'), { target: { value: 'CL123UD' } })
    fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Fiat' } })
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'Panda' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salva vettura' }))
    await screen.findByText('Vettura salvata')
    const latestRemote = async () => (await loadCloudSnapshot('company-1', session, { url: 'https://test.supabase.co', anonKey: 'test-public-key' }))!.payload
    await waitFor(async () => expect((await latestRemote()).vehicles).toEqual([
      expect.objectContaining({ plate: 'CL123UD', model: 'Panda' }),
    ]))

    fireEvent.click(screen.getByRole('button', { name: 'Modifica' }))
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'Panda Hybrid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salva vettura' }))
    await waitFor(async () => expect((await latestRemote()).vehicles[0].model).toBe('Panda Hybrid'))

    const row = screen.getByText('CL123UD').closest('tr')!
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'da-pianificare' } })
    await waitFor(async () => expect((await latestRemote()).vehicles[0].coneNumber).toBe(1))
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'consegnata' } })
    await waitFor(async () => {
      const remote = await latestRemote()
      expect(remote.vehicles[0]).toMatchObject({ status: 'consegnata', coneNumber: null })
      expect(remote.coneHistory).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'Assegnato', coneNumber: 1 }),
        expect.objectContaining({ action: 'Liberato', coneNumber: 1 }),
      ]))
    })

    app.unmount()
    await act(async () => { await Promise.allSettled(pendingSaves) })
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    render(<App />)
    await screen.findByText('Archivio sincronizzato dal cloud.')
    fireEvent.click(screen.getByRole('button', { name: 'Veicoli' }))
    expect(await screen.findByText('CL123UD')).toBeInTheDocument()
    expect((await loadDatabase()).vehicles[0]).toMatchObject({ model: 'Panda Hybrid', status: 'consegnata', coneNumber: null })
  })

  it('invia anche il cliente salvato esplicitamente dalla schermata Accettazione', async () => {
    render(<App />)
    await screen.findByText('Archivio sincronizzato dal cloud.')
    await waitFor(() => expect(updateCloudSnapshot).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    const customerPanel = screen.getByRole('heading', { name: 'Cliente' }).closest<HTMLElement>('.panel.table-panel')!
    fireEvent.click(within(customerPanel).getByRole('button', { name: 'Inserisci manualmente' }))
    fireEvent.change(screen.getByLabelText('Nome / ragione sociale'), { target: { value: 'Cliente accettazione cloud' } })
    fireEvent.change(screen.getByLabelText('Telefono'), { target: { value: '789' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }))
    await screen.findByText('Cliente salvato')
    await waitFor(() => expect(vi.mocked(updateCloudSnapshot).mock.calls.some(([, , payload]) =>
      payload.customers.some((item) => item.name === 'Cliente accettazione cloud'),
    )).toBe(true))
  })

  it('segnala un invio vettura fallito, conserva il salvataggio locale e riprende al successivo', async () => {
    render(<App />)
    await screen.findByText('Archivio sincronizzato dal cloud.')
    await waitFor(() => expect(updateCloudSnapshot).toHaveBeenCalled())
    vi.mocked(updateCloudSnapshot).mockRejectedValueOnce(new Error('Connessione cloud interrotta.'))
    fireEvent.click(screen.getByRole('button', { name: 'Nuova vettura' }))
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: customer.id } })
    fireEvent.change(screen.getByLabelText('Targa'), { target: { value: 'RT123RY' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salva vettura' }))
    await screen.findByText('Connessione cloud interrotta.')
    expect((await loadDatabase()).vehicles[0].plate).toBe('RT123RY')
    fireEvent.click(screen.getByRole('button', { name: 'Modifica' }))
    fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Fiat' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salva vettura' }))
    await waitFor(async () => {
      const remote = await loadCloudSnapshot('company-1', session, { url: 'https://test.supabase.co', anonKey: 'test-public-key' })
      expect(remote!.payload.vehicles).toEqual([expect.objectContaining({ plate: 'RT123RY', make: 'Fiat' })])
    })
  })
})
