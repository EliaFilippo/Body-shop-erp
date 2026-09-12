import { analyzeVehicleBookletWithAzure, VEHICLE_BOOKLET_OCR_GENERIC_ERROR } from '../ocr/vehicleBooklet.js'

export const VEHICLE_BOOKLET_OCR_ENDPOINT = '/api/ocr/libretto'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function handleVehicleBookletOcrRequest(request: Request): Promise<Response> {
  console.info('LIBRETTO OCR STEP 1 - REQUEST RECEIVED')
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
    const result = await analyzeVehicleBookletWithAzure({
      name: document.name,
      contentType: document.type || 'application/octet-stream',
      bytes,
    })

    return json(result)
  } catch {
    return json({ success: false, message: VEHICLE_BOOKLET_OCR_GENERIC_ERROR }, 502)
  }
}
