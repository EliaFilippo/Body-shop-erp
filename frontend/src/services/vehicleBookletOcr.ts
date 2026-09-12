import type { VehicleBookletOcrResponse } from '../types'

export const VEHICLE_BOOKLET_OCR_ENDPOINT = '/api/ocr/libretto'
export const VEHICLE_BOOKLET_OCR_GENERIC_ERROR = 'Non e stato possibile leggere automaticamente il libretto. Puoi inserire o correggere i dati manualmente.'

export async function readVehicleBooklet(file: File): Promise<VehicleBookletOcrResponse> {
  const formData = new FormData()
  formData.set('document', file)

  const response = await fetch(VEHICLE_BOOKLET_OCR_ENDPOINT, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(VEHICLE_BOOKLET_OCR_GENERIC_ERROR)
  }

  const payload = await response.json() as Partial<VehicleBookletOcrResponse>
  if (payload.success !== true || !payload.fields) {
    throw new Error(VEHICLE_BOOKLET_OCR_GENERIC_ERROR)
  }

  return payload as VehicleBookletOcrResponse
}
