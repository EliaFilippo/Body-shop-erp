import type { IdentityDocumentOcrResponse } from '../types'

export const DOCUMENT_IDENTITY_OCR_ENDPOINT = '/api/ocr/documento-identita'
export const DOCUMENT_IDENTITY_OCR_GENERIC_ERROR = 'Non è stato possibile leggere automaticamente il documento. Puoi inserire o correggere i dati manualmente.'

export interface DocumentIdentityOcrDiagnostic {
  endpoint: string
  responseReceived?: boolean
  httpStatus?: number | null
  errorMessage?: string
}

export async function readIdentityDocument(file: File, onDiagnostic?: (diagnostic: DocumentIdentityOcrDiagnostic) => void): Promise<IdentityDocumentOcrResponse> {
  const formData = new FormData()
  formData.set('document', file)

  onDiagnostic?.({ endpoint: DOCUMENT_IDENTITY_OCR_ENDPOINT, responseReceived: false, httpStatus: null })

  const response = await fetch(DOCUMENT_IDENTITY_OCR_ENDPOINT, {
    method: 'POST',
    body: formData,
  })

  onDiagnostic?.({ endpoint: DOCUMENT_IDENTITY_OCR_ENDPOINT, responseReceived: true, httpStatus: response.status })

  if (!response.ok) {
    onDiagnostic?.({ endpoint: DOCUMENT_IDENTITY_OCR_ENDPOINT, responseReceived: true, httpStatus: response.status, errorMessage: DOCUMENT_IDENTITY_OCR_GENERIC_ERROR })
    throw new Error(DOCUMENT_IDENTITY_OCR_GENERIC_ERROR)
  }

  const payload = await response.json() as Partial<IdentityDocumentOcrResponse>
  if (payload.success !== true || !payload.fields) {
    onDiagnostic?.({ endpoint: DOCUMENT_IDENTITY_OCR_ENDPOINT, responseReceived: true, httpStatus: response.status, errorMessage: DOCUMENT_IDENTITY_OCR_GENERIC_ERROR })
    throw new Error(DOCUMENT_IDENTITY_OCR_GENERIC_ERROR)
  }

  onDiagnostic?.({ endpoint: DOCUMENT_IDENTITY_OCR_ENDPOINT, responseReceived: true, httpStatus: response.status })

  return payload as IdentityDocumentOcrResponse
}