import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCustomer, emptyData } from './services/erp'
import type { ErpData } from './types'

let persistedData: ErpData

vi.mock('./services/database', () => ({
  loadDatabase: vi.fn(async () => structuredClone(persistedData)),
  saveDatabase: vi.fn(async (data: ErpData) => {
    persistedData = structuredClone(data)
  }),
}))

vi.mock('./services/documentImagePreprocess', () => ({
  preprocessIdentityDocumentImage: vi.fn(async (file: File) => ({
    originalDataUrl: 'data:image/jpeg;base64,b3JpZ2luYWw=',
    autoDataUrl: 'data:image/jpeg;base64,YXV0bw==',
    autoFile: new File(['auto'], `auto-${file.name}`, { type: 'image/jpeg' }),
    reliability: 0.82,
    usedFallback: false,
    reason: 'Ritaglio automatico pronto',
  })),
}))

import App from './App'

const makeVehicle = (): NonNullable<ErpData['vehicles']>[number] => ({
  id: 'v-acceptance-1',
  customerId: 'c-acceptance-1',
  plate: 'AA123BB',
  make: 'Fiat',
  model: 'Panda',
  color: 'Bianco',
  year: '2023',
  vin: 'VIN-ACCEPT-1',
  mileage: '12000',
  status: 'accettata',
  coneNumber: null,
  priority: 'Normale',
  deliveryDate: '',
  estimatedHours: 0,
  workedHours: 0,
  plannedEntryDate: '',
  requestedDeliveryDate: '',
  calculatedDeliveryDate: '',
  expectedRevenue: 0,
  expectedMargin: 0,
  partsStatus: 'Disponibili',
  blockReason: '',
  manualPlanningDate: '',
  createdAt: '2026-08-15T00:00:00.000Z',
})

describe('Acceptance flow', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn(() => 'blob:acceptance-preview'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    })

    persistedData = {
      ...structuredClone(emptyData),
      customers: [createCustomer({
        type: 'Privato',
        name: 'Mario Rossi',
        phone: '3331234567',
        email: 'mario.rossi@example.com',
        taxId: 'RSSMRA80A01H501U',
        address: 'Via Roma 1',
      })],
      vehicles: [makeVehicle()],
    }
    persistedData.customers[0].id = 'c-acceptance-1'
  })

  it('mostra selezione cliente/veicolo e crea una pratica di accettazione riusando i dati esistenti', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))

    expect(screen.getByRole('heading', { name: 'Nuova accettazione' })).toBeInTheDocument()
    expect(screen.queryByText('Mario Rossi')).not.toBeInTheDocument()
    expect(screen.queryByText('AA123BB')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Acquisisci documento' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cliente esistente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Acquisisci libretto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Veicolo esistente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avanti → Preventivo' })).toBeInTheDocument()
    expect(screen.queryByText('Tariffa oraria')).not.toBeInTheDocument()
    expect(screen.queryByText('Margine previsto')).not.toBeInTheDocument()
    expect(screen.queryByText('Pratiche esistenti')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pratiche da confermare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pratiche confermate' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Aggiungi foto' })).toBeInTheDocument()
    })

    expect(persistedData.acceptances?.[0]?.customerId).toBe('c-acceptance-1')
  })

  it('salva un nuovo cliente da Accettazione, lo rilegge dal database e lo seleziona nella stessa pratica', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Inserisci manualmente' })[0])

    expect(screen.getByRole('heading', { name: 'Nuovo cliente' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Nome / ragione sociale'), { target: { value: 'Giulia Bianchi' } })
    fireEvent.change(screen.getByLabelText('Telefono'), { target: { value: '3391112233' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'giulia.bianchi@example.com' } })
    fireEvent.change(screen.getByLabelText('Codice fiscale / P.IVA'), { target: { value: 'BNCGLI90A41F205X' } })
    fireEvent.change(screen.getByLabelText('Indirizzo'), { target: { value: 'Via Torino 20' } })

    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }))

    await waitFor(() => {
      expect(screen.getByText('Cliente salvato')).toBeInTheDocument()
      expect(screen.getByText(/Giulia Bianchi/i)).toBeInTheDocument()
    })

    expect(persistedData.customers.some((customer) => customer.name === 'Giulia Bianchi')).toBe(true)
    expect(persistedData.customers[0]?.name).toBe('Giulia Bianchi')
  })

  it('esegue azioni diverse per acquisizione, selezione esistente e inserimento manuale di cliente e veicolo', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))

    fireEvent.click(screen.getByRole('button', { name: 'Acquisisci documento' }))
    fireEvent.change(screen.getByLabelText('Carica documento cliente'), {
      target: {
        files: [new File(['documento'], 'documento-cliente.jpg', { type: 'image/jpeg' })],
      },
    })

    expect(screen.getByText('Documento acquisito')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Anteprima documento cliente' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Nome, telefono o email')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))

    expect(screen.getByPlaceholderText('Nome, telefono o email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Inserisci manualmente' })[0])

    expect(screen.getByRole('heading', { name: 'Nuovo cliente' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }))

    fireEvent.click(screen.getByRole('button', { name: 'Acquisisci libretto' }))
    fireEvent.change(screen.getByLabelText('Carica libretto veicolo'), {
      target: {
        files: [new File(['libretto'], 'libretto-veicolo.jpg', { type: 'image/jpeg' })],
      },
    })

    expect(screen.getByText('Libretto acquisito')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Anteprima libretto veicolo' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Targa, marca, modello o telaio')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))

    expect(screen.getByPlaceholderText('Targa, marca, modello o telaio')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Inserisci manualmente' })[1])

    expect(screen.getByRole('heading', { name: 'Nuova vettura' })).toBeInTheDocument()
  })

  it('salva una nuova vettura da Accettazione, la rilegge dal database e la collega al cliente/pratica corrente', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Inserisci manualmente' })[1])

    expect(screen.getByRole('heading', { name: 'Nuova vettura' })).toBeInTheDocument()
    expect(screen.getByLabelText('Cliente')).toHaveValue('c-acceptance-1')

    fireEvent.change(screen.getByLabelText('Targa'), { target: { value: 'ZX901PL' } })
    fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Peugeot' } })
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: '208' } })

    fireEvent.click(screen.getByRole('button', { name: 'Salva vettura' }))

    await waitFor(() => {
      expect(screen.getByText('Vettura salvata')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Nuova accettazione' })).toBeInTheDocument()
      expect(screen.getByText(/ZX901PL/i)).toBeInTheDocument()
      expect(screen.getByText(/Peugeot/i)).toBeInTheDocument()
      expect(screen.getByText(/208/i)).toBeInTheDocument()
    })

    expect(persistedData.vehicles.some((vehicle) => vehicle.plate === 'ZX901PL')).toBe(true)
    expect(persistedData.vehicles.find((vehicle) => vehicle.plate === 'ZX901PL')?.customerId).toBe('c-acceptance-1')

    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    expect(persistedData.acceptances?.[0]?.customerId).toBe('c-acceptance-1')
    expect(persistedData.acceptances?.[0]?.vehicleId).toBe(persistedData.vehicles.find((vehicle) => vehicle.plate === 'ZX901PL')?.id)
  })

  it('renderizza i campi completi solo nei pannelli Verifica / modifica dati cliente/vettura', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('heading', { name: 'Documento ID' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Conferma dati documento' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Libretto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Conferma dati libretto' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Chilometraggio')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Livello carburante')).not.toBeInTheDocument()
    expect(screen.queryByText('NAME')).not.toBeInTheDocument()
    expect(screen.queryByText('SURNAME')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('heading', { name: 'Verifica / modifica dati cliente' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Documento ID' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Conferma dati documento' })).toBeInTheDocument()
      expect(screen.getByText('Nome')).toBeInTheDocument()
      expect(screen.getByText('Cognome')).toBeInTheDocument()
      expect(screen.getByText('Codice fiscale')).toBeInTheDocument()
      expect(screen.getAllByText('Affidabilita bassa · Inserito manualmente').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('heading', { name: 'Verifica / modifica dati cliente' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Documento ID' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Conferma dati documento' })).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('heading', { name: 'Verifica / modifica dati vettura' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Libretto' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Conferma dati libretto' })).toBeInTheDocument()
      expect(screen.getByLabelText('Chilometraggio')).toBeInTheDocument()
      expect(screen.getByLabelText('Livello carburante')).toBeInTheDocument()
      expect(screen.getByText('Targa')).toBeInTheDocument()
      expect(screen.getByText('Telaio')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('heading', { name: 'Verifica / modifica dati vettura' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Libretto' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Conferma dati libretto' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Chilometraggio')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Livello carburante')).not.toBeInTheDocument()
    })
  })

  it('precompila i campi documento via OCR e preserva i dati gia presenti nella pratica', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      documentType: 'identity_card',
      fields: {
        firstName: { value: 'Mario', confidence: 0.98, source: 'azure' },
        lastName: { value: 'Rossi', confidence: 0.98, source: 'azure' },
        taxCode: { value: 'RSSMRA80A01H501U', confidence: 0.97, source: 'azure' },
        birthDate: { value: '1980-01-01', confidence: 0.95, source: 'azure' },
        birthPlace: { value: 'Roma', confidence: 0.88, source: 'azure' },
        residence: { value: 'Via Roma 1 Torino', confidence: 0.92, source: 'azure' },
        documentNumber: { value: 'CA1234567', confidence: 0.94, source: 'azure' },
        issueDate: { value: '2020-05-10', confidence: 0.91, source: 'azure' },
        expiryDate: { value: '2030-05-10', confidence: 0.91, source: 'azure' },
        issuingAuthority: { value: 'Comune di Torino', confidence: 0.87, source: 'azure' },
      },
      warnings: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await screen.findByRole('heading', { name: 'Foto e accettazione' })
    fireEvent.change(screen.getByLabelText('Note / danni / richieste cliente'), {
      target: { value: 'Graffio sul paraurti anteriore' },
    })

    fireEvent.click(screen.getAllByText('Verifica / modifica dati cliente').at(-1) as HTMLElement)
    await waitFor(() => {
      expect(screen.getByLabelText('Documento identita')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('Documento identita'), {
      target: {
        files: [new File(['documento'], 'carta-identita.jpg', { type: 'image/jpeg' })],
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Usa ritaglio automatico' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Usa ritaglio automatico' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Mario')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Rossi')).toBeInTheDocument()
      expect(screen.getByDisplayValue('RSSMRA80A01H501U')).toBeInTheDocument()
      expect(screen.getByText('Documento letto automaticamente. Controlla i dati prima del salvataggio.')).toBeInTheDocument()
    })

    expect(screen.getByLabelText('Note / danni / richieste cliente')).toHaveValue('Graffio sul paraurti anteriore')
    expect(persistedData.acceptances?.[0]?.intake?.damageDescription).toBe('Graffio sul paraurti anteriore')
  })

  it('gestisce l\'errore OCR senza perdere i dati gia inseriti nella pratica', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ko', { status: 502 }))

    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await screen.findByRole('heading', { name: 'Foto e accettazione' })
    fireEvent.change(screen.getByLabelText('Note / danni / richieste cliente'), {
      target: { value: 'Cliente chiede controllo faro sinistro' },
    })

    fireEvent.click(screen.getAllByText('Verifica / modifica dati cliente').at(-1) as HTMLElement)
    await waitFor(() => {
      expect(screen.getByLabelText('Documento identita')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('Documento identita'), {
      target: {
        files: [new File(['documento'], 'carta-identita.jpg', { type: 'image/jpeg' })],
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Usa foto originale' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Usa foto originale' }))

    await waitFor(() => {
      expect(screen.getByText('Non è stato possibile leggere automaticamente il documento. Puoi inserire o correggere i dati manualmente.')).toBeInTheDocument()
    })

    expect(screen.getByLabelText('Note / danni / richieste cliente')).toHaveValue('Cliente chiede controllo faro sinistro')
    expect(persistedData.acceptances?.[0]?.intake?.damageDescription).toBe('Cliente chiede controllo faro sinistro')
    expect(persistedData.acceptances?.[0]?.customerDraft?.[0]?.fields.name.value).toBe('')
  })

  it('permette di selezionare una foto png dei danni e la associa subito alla pratica', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    const damageInput = screen.getByLabelText('Carica foto ingresso') as HTMLInputElement
    expect(damageInput.accept).toContain('.png')
    expect(damageInput.accept).toContain('.jpg')

    fireEvent.change(damageInput, {
      target: {
        files: [new File(['png-image'], 'danno-lato.png', { type: 'image/png' })],
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Danno 1' })).toBeInTheDocument()
    })

    const thumbnail = screen.getByRole('img', { name: 'Danno 1' }) as HTMLImageElement
    expect(thumbnail.getAttribute('src')).toMatch(/^data:image\/png;base64,|^blob:/)

    expect(screen.getAllByText('danno-lato.png').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Danno 1' }))

    await waitFor(() => {
      expect(screen.getAllByRole('img', { name: 'danno-lato.png' }).length).toBeGreaterThan(0)
    })

    expect(persistedData.acceptances?.[0]?.photos?.some((photo) => photo.name === 'danno-lato.png')).toBe(true)
  })

  it('permette di caricare, visualizzare e rimuovere la foto quadro strumenti separata dalle foto danni', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Classifica foto'), { target: { value: 'quadro' } })

    fireEvent.change(screen.getByLabelText('Carica foto ingresso'), {
      target: {
        files: [new File(['dashboard-image'], 'quadro-km.png', { type: 'image/png' })],
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Quadro 1' })).toBeInTheDocument()
    })

    expect(persistedData.acceptances?.[0]?.photos?.some((photo) => photo.name === 'quadro-km.png' && photo.category === 'ingresso')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Quadro 1' }))

    await waitFor(() => {
      expect(screen.getAllByRole('img', { name: 'quadro-km.png' }).length).toBeGreaterThan(0)
    })

    const dashboardImage = screen.getByRole('img', { name: 'Quadro 1' })
    const dashboardCard = dashboardImage.closest('.damage-photo-card')
    const deleteDashboardButton = dashboardCard?.querySelector('button.danger') as HTMLButtonElement | null
    expect(deleteDashboardButton).toBeTruthy()
    fireEvent.click(deleteDashboardButton as HTMLButtonElement)

    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'Quadro 1' })).not.toBeInTheDocument()
    })
  })

  it('blocca file non immagine nei danni e mostra un messaggio chiaro', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Carica foto ingresso'), {
      target: {
        files: [new File(['email'], 'messaggio.eml', { type: 'message/rfc822' })],
      },
    })

    expect(screen.getByText('Seleziona un file immagine valido')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Danno 1' })).not.toBeInTheDocument()
    expect(persistedData.acceptances?.[0]?.photos?.some((photo) => photo.name === 'messaggio.eml')).not.toBe(true)
  })

  it('aggiorna automaticamente Danni registrati da foto o nota e torna non completato quando entrambe vengono rimosse', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    const damageChecklist = screen.getByLabelText('Danni registrati') as HTMLInputElement
    expect(damageChecklist).not.toBeChecked()

    fireEvent.change(screen.getByLabelText('Carica foto ingresso'), {
      target: {
        files: [new File(['png-image'], 'danno-porta.png', { type: 'image/png' })],
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Danno 1' })).toBeInTheDocument()
      expect(damageChecklist).toBeChecked()
    })

    const damageImage = screen.getByRole('img', { name: 'Danno 1' })
    const damageCard = damageImage.closest('.damage-photo-card')
    const deleteDamageButton = damageCard?.querySelector('button.danger') as HTMLButtonElement | null
    expect(deleteDamageButton).toBeTruthy()
    fireEvent.click(deleteDamageButton as HTMLButtonElement)

    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'Danno 1' })).not.toBeInTheDocument()
      expect(damageChecklist).not.toBeChecked()
    })

    fireEvent.change(screen.getByLabelText('Note / danni / richieste cliente'), {
      target: { value: 'Ala posteriore destra graffiata' },
    })

    await waitFor(() => {
      expect(damageChecklist).toBeChecked()
    })

    fireEvent.change(screen.getByLabelText('Note / danni / richieste cliente'), {
      target: { value: '' },
    })

    await waitFor(() => {
      expect(damageChecklist).not.toBeChecked()
    })
  })

  it('conferma gli accessori della pratica e aggiorna automaticamente Accessori verificati', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    const accessoriesChecklist = screen.getByLabelText('Accessori verificati') as HTMLInputElement
    expect(accessoriesChecklist).not.toBeChecked()

    fireEvent.click(screen.getByText('Accessori alla consegna'))
    fireEvent.change(screen.getByLabelText('Numero chiavi'), { target: { value: '2' } })
    fireEvent.click(screen.getByLabelText('Carta/libretto presente'))
    fireEvent.click(screen.getByLabelText('Triangolo'))
    fireEvent.change(screen.getByLabelText('Altro / note'), { target: { value: 'Porta telefono in abitacolo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verifica accessori' }))

    await waitFor(() => {
      expect(accessoriesChecklist).toBeChecked()
    })

    expect(persistedData.acceptances?.[0]?.intake?.accessoriesDraft?.confirmed).toBe(true)
    expect(persistedData.acceptances?.[0]?.intake?.accessories).toContain('Numero chiavi: 2')
    expect(persistedData.acceptances?.[0]?.intake?.accessories).toContain('Carta/libretto presente')
    expect(persistedData.acceptances?.[0]?.intake?.accessories).toContain('Triangolo')
    expect(persistedData.acceptances?.[0]?.intake?.accessories).toContain('Altro: Porta telefono in abitacolo')
  })

  it('acquisisce una firma reale, consente cancella e annulla, aggiorna checklist e la associa alla pratica corrente', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Firma cliente' }))
    const signaturePad = screen.getByLabelText('Area firma cliente')
    fireEvent.pointerDown(signaturePad, { pointerId: 1, clientX: 30, clientY: 40 })
    fireEvent.pointerMove(signaturePad, { pointerId: 1, clientX: 90, clientY: 80 })
    fireEvent.pointerUp(signaturePad, { pointerId: 1, clientX: 90, clientY: 80 })

    const confirmButton = screen.getByRole('button', { name: 'Conferma firma' })
    expect(confirmButton).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancella' }))
    expect(confirmButton).toBeDisabled()

    fireEvent.pointerDown(signaturePad, { pointerId: 1, clientX: 40, clientY: 60 })
    fireEvent.pointerMove(signaturePad, { pointerId: 1, clientX: 130, clientY: 100 })
    fireEvent.pointerUp(signaturePad, { pointerId: 1, clientX: 130, clientY: 100 })
    expect(confirmButton).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }))
    expect(screen.queryByLabelText('Area firma cliente')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Firma digitale' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Firma cliente' }))
    const reopenedPad = screen.getByLabelText('Area firma cliente')
    fireEvent.pointerDown(reopenedPad, { pointerId: 2, clientX: 50, clientY: 70 })
    fireEvent.pointerMove(reopenedPad, { pointerId: 2, clientX: 150, clientY: 120 })
    fireEvent.pointerUp(reopenedPad, { pointerId: 2, clientX: 150, clientY: 120 })

    fireEvent.click(screen.getByRole('button', { name: 'Conferma firma' }))

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Firma digitale' })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Rifai firma' })).toBeInTheDocument()
    expect(screen.getByLabelText('Firma cliente acquisita')).toBeChecked()
    expect(persistedData.acceptances?.[0]?.intake?.signatureDataUrl).toMatch(/^data:image\/svg\+xml/)
    expect(persistedData.acceptances?.[0]?.signatureDataUrl).toMatch(/^data:image\/svg\+xml/)
  })

  it('autosalva la bozza di accettazione e la ripristina dopo reload senza classificarla tra le confermate', async () => {
    const firstSession = render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Carica foto ingresso'), {
      target: {
        files: [new File(['png-image'], 'autosave-danno.png', { type: 'image/png' })],
      },
    })

    fireEvent.change(screen.getByLabelText('Note / danni / richieste cliente'), {
      target: { value: 'Paraurti anteriore rigato' },
    })

    await waitFor(() => {
      expect(persistedData.acceptances?.[0]?.intake?.damageDescription).toBe('Paraurti anteriore rigato')
    })

    fireEvent.click(screen.getByText('Accessori alla consegna'))
    fireEvent.change(screen.getByLabelText('Numero chiavi'), { target: { value: '2' } })
    fireEvent.click(screen.getByLabelText('Carta/libretto presente'))
    fireEvent.click(screen.getByRole('button', { name: 'Verifica accessori' }))

    fireEvent.click(screen.getByRole('button', { name: 'Firma cliente' }))
    const signaturePad = screen.getByLabelText('Area firma cliente')
    fireEvent.pointerDown(signaturePad, { pointerId: 3, clientX: 30, clientY: 40 })
    fireEvent.pointerMove(signaturePad, { pointerId: 3, clientX: 100, clientY: 90 })
    fireEvent.pointerUp(signaturePad, { pointerId: 3, clientX: 100, clientY: 90 })
    fireEvent.click(screen.getByRole('button', { name: 'Conferma firma' }))

    await waitFor(() => {
      expect(persistedData.acceptances?.[0]?.status).toBe('draft')
      expect(persistedData.acceptances?.[0]?.photos?.some((photo) => photo.name === 'autosave-danno.png')).toBe(true)
      expect(persistedData.acceptances?.[0]?.intake?.damageDescription).toBe('Paraurti anteriore rigato')
      expect(persistedData.acceptances?.[0]?.intake?.accessoriesDraft?.confirmed).toBe(true)
      expect(persistedData.acceptances?.[0]?.intake?.signatureDataUrl).toMatch(/^data:image\/svg\+xml/)
    })

    firstSession.unmount()

    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))

    await waitFor(() => {
      expect(screen.getByText('Bozza ripristinata automaticamente')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Danno 1' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Firma digitale' })).toBeInTheDocument()
      expect(screen.getByLabelText('Note / danni / richieste cliente')).toHaveValue('Paraurti anteriore rigato')
      expect(screen.getByLabelText('Accessori verificati')).toBeChecked()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Pratiche confermate' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pratiche approvate dal cliente' })).toBeInTheDocument()
      expect(screen.getByText('Nessuna pratica confermata.')).toBeInTheDocument()
    })
  })

  it('elimina solo la bozza senza cancellare cliente e vettura gia presenti in anagrafica', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
      expect(persistedData.acceptances?.length).toBe(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Elimina bozza' }))

    await waitFor(() => {
      expect(persistedData.acceptances?.length).toBe(0)
      expect(screen.queryByRole('heading', { name: 'Foto e accettazione' })).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clienti' }))
    await waitFor(() => {
      expect(screen.getByText('Mario Rossi')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Veicoli' }))
    await waitFor(() => {
      expect(screen.getByText('AA123BB')).toBeInTheDocument()
    })
  })

  it('smista automaticamente la stessa pratica tra da confermare e confermate in base allo stato', async () => {
    render(<App />)

    await screen.findByText('Archivio pronto')
    fireEvent.click(screen.getByRole('button', { name: 'Accettazione' }))

    fireEvent.click(screen.getByRole('button', { name: 'Cliente esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /Mario Rossi.*mario\.rossi@example\.com/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Veicolo esistente' }))
    fireEvent.click(screen.getByRole('button', { name: /AA123BB.*Fiat.*Panda.*Mario Rossi/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Avanti → Preventivo' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foto e accettazione' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Pratiche da confermare' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pratiche aperte da completare' })).toBeInTheDocument()
      expect(screen.getByText('Mario Rossi')).toBeInTheDocument()
      expect(screen.getByText('Bozza')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Registra conferma cliente' }))

    await waitFor(() => {
      expect(screen.getByText('Pratica aggiornata.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Pratiche confermate' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pratiche approvate dal cliente' })).toBeInTheDocument()
      expect(screen.getByText('Mario Rossi')).toBeInTheDocument()
      expect(screen.getByText('Confermata')).toBeInTheDocument()
    })
  })
})
