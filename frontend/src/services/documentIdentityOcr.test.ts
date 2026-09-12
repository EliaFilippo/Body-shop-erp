import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_IDENTITY_OCR_ENDPOINT, DOCUMENT_IDENTITY_OCR_GENERIC_ERROR, readIdentityDocument } from './documentIdentityOcr'

describe('readIdentityDocument', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('chiama solo l\'endpoint locale senza esporre la chiave Azure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      documentType: 'identity_card',
      fields: {
        firstName: { value: 'Mario', confidence: 0.98, source: 'azure' },
        lastName: { value: 'Rossi', confidence: 0.98, source: 'azure' },
        taxCode: { value: '', confidence: null, source: 'azure' },
        birthDate: { value: '', confidence: null, source: 'azure' },
        birthPlace: { value: '', confidence: null, source: 'azure' },
        residence: { value: '', confidence: null, source: 'azure' },
        documentNumber: { value: '', confidence: null, source: 'azure' },
        issueDate: { value: '', confidence: null, source: 'azure' },
        expiryDate: { value: '', confidence: null, source: 'azure' },
        issuingAuthority: { value: '', confidence: null, source: 'azure' },
      },
      warnings: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await readIdentityDocument(new File(['doc'], 'documento.jpg', { type: 'image/jpeg' }))

    expect(fetchSpy).toHaveBeenCalledWith(DOCUMENT_IDENTITY_OCR_ENDPOINT, expect.objectContaining({
      method: 'POST',
      body: expect.any(FormData),
    }))
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(requestInit?.headers).toBeUndefined()
  })

  it('propaga un errore OCR generico quando il backend fallisce', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ko', { status: 502 }))

    await expect(readIdentityDocument(new File(['doc'], 'documento.jpg', { type: 'image/jpeg' }))).rejects.toThrow(DOCUMENT_IDENTITY_OCR_GENERIC_ERROR)
  })
})