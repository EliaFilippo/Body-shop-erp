import {
  analyzeIdentityDocumentWithAzure,
  GENERIC_DOCUMENT_IDENTITY_OCR_MESSAGE,
  type OcrRequestDiagnostic,
  OcrDiagnosticError,
} from '../ocr/documentIdentity.js'

export const DOCUMENT_IDENTITY_OCR_ENDPOINT = '/api/ocr/documento-identita'
export const DOCUMENT_IDENTITY_OCR_DIAGNOSTICS_ENDPOINT = '/api/ocr/documento-identita/diagnostics/latest'

let latestOcrDiagnostic: OcrRequestDiagnostic | null = null

function diagnosticsResponseBody() {
  return latestOcrDiagnostic ?? {
    requestArrivedBackend: false,
    endpointConfigured: false,
    keyConfigured: false,
    azureRequestStarted: false,
    modelId: 'prebuilt-idDocument',
    apiVersion: '2024-11-30',
    azureRequestContentType: '',
    azureAnalyzeHttpStatus: null,
    azurePollHttpStatus: null,
    azureErrorCode: null,
    azureErrorMessage: null,
    azureOperationStatus: null,
    phase: 'failed',
  }
}

function updateLatestDiagnostic(next: OcrRequestDiagnostic) {
  latestOcrDiagnostic = { ...next }
  console.info('[OCR_DIAG]', JSON.stringify(latestOcrDiagnostic))
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function handleDocumentIdentityOcrRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === DOCUMENT_IDENTITY_OCR_DIAGNOSTICS_ENDPOINT) {
    return json(diagnosticsResponseBody())
  }

  if (request.method !== 'POST') {
    return json({ success: false, message: 'Metodo non consentito.' }, 405)
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return json({ success: false, message: 'Richiesta non valida.' }, 400)
  }

  try {
    const formData = await request.formData()
    const document = formData.get('document')
    if (!(document instanceof File) || !document.size) {
      return json({ success: false, message: 'Documento non valido.' }, 400)
    }

    const bytes = new Uint8Array(await document.arrayBuffer())
    const { result, diagnostic } = await analyzeIdentityDocumentWithAzure({
      name: document.name,
      contentType: document.type || 'application/octet-stream',
      bytes,
    })
    updateLatestDiagnostic(diagnostic)

    return json(result)
  } catch (error) {
    if (error instanceof OcrDiagnosticError) {
      updateLatestDiagnostic(error.diagnostic)
    }
    return json({ success: false, message: GENERIC_DOCUMENT_IDENTITY_OCR_MESSAGE }, 502)
  }
}