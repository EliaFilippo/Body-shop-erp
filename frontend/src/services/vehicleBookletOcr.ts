import type { VehicleBookletOcrResponse } from '../types'

export const VEHICLE_BOOKLET_OCR_ENDPOINT = '/api/ocr/libretto'
export const VEHICLE_BOOKLET_OCR_GENERIC_ERROR = 'Non e stato possibile leggere automaticamente il libretto. Puoi inserire o correggere i dati manualmente.'

const MAX_OCR_IMAGE_BYTES = 3_500_000
const MAX_OCR_IMAGE_SIDE = 2500

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Impossibile preparare la foto del libretto.'))
    }, 'image/jpeg', quality)
  })
}

async function loadImage(file: File) {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Impossibile leggere la foto del libretto.'))
    })
    image.src = url
    return await loaded
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function normalizeBookletImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  const image = await loadImage(file)
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight)
  const scale = Math.min(1, MAX_OCR_IMAGE_SIDE / Math.max(1, longestSide))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Impossibile preparare la foto del libretto.')

  context.drawImage(image, 0, 0, width, height)

  let quality = 0.86
  let blob = await canvasToBlob(canvas, quality)
  while (blob.size > MAX_OCR_IMAGE_BYTES && quality > 0.55) {
    quality -= 0.1
    blob = await canvasToBlob(canvas, quality)
  }

  return new File([blob], 'libretto-ocr.jpg', {
    type: 'image/jpeg',
    lastModified: Date.now(),
  })
}

export async function readVehicleBooklet(file: File): Promise<VehicleBookletOcrResponse> {
  const normalizedFile = await normalizeBookletImage(file)
  const formData = new FormData()
  formData.set('document', normalizedFile)

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
