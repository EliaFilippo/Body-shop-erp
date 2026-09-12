export interface CapturePoint {
  x: number
  y: number
}

export interface CaptureQualityReport {
  resolutionOk: boolean
  blurOk: boolean
  documentSizeOk: boolean
  blurScore: number
  documentAreaRatio: number
  issues: string[]
}

export interface CaptureAnalysisResult {
  originalFile: File
  originalDataUrl: string
  width: number
  height: number
  detectedCorners: [CapturePoint, CapturePoint, CapturePoint, CapturePoint] | null
  defaultCorners: [CapturePoint, CapturePoint, CapturePoint, CapturePoint]
  quality: CaptureQualityReport
}

export interface CaptureProcessedResult {
  file: File
  dataUrl: string
}

const TARGET_RATIO = 1.58
const MIN_RESOLUTION_SIDE = 1200
const MIN_DOCUMENT_AREA_RATIO = 0.18
const MIN_BLUR_SCORE = 105
const MAX_ANALYSIS_SIDE = 2200
const MAX_OUTPUT_WIDTH = 2200
const MIN_OUTPUT_WIDTH = 1200

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function distance(a: CapturePoint, b: CapturePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function polygonArea(points: CapturePoint[]) {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.x * next.y - next.x * current.y
  }
  return Math.abs(sum) / 2
}

function grayFromImageData(data: Uint8ClampedArray) {
  const gray = new Float32Array(data.length / 4)
  for (let index = 0, out = 0; index < data.length; index += 4, out += 1) {
    gray[out] = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
  }
  return gray
}

function normalizeQuadOrder(points: CapturePoint[]): [CapturePoint, CapturePoint, CapturePoint, CapturePoint] {
  const [p1, p2, p3, p4] = points
  const tl = [p1, p2, p3, p4].reduce((best, current) => current.x + current.y < best.x + best.y ? current : best)
  const br = [p1, p2, p3, p4].reduce((best, current) => current.x + current.y > best.x + best.y ? current : best)
  const tr = [p1, p2, p3, p4].reduce((best, current) => current.x - current.y > best.x - best.y ? current : best)
  const bl = [p1, p2, p3, p4].reduce((best, current) => current.x - current.y < best.x - best.y ? current : best)
  return [tl, tr, br, bl]
}

function createFallbackFrame(width: number, height: number): [CapturePoint, CapturePoint, CapturePoint, CapturePoint] {
  const fitByWidth = width / TARGET_RATIO
  const fitByHeight = height
  const frameHeight = Math.min(fitByWidth, fitByHeight) * 0.88
  const frameWidth = frameHeight * TARGET_RATIO
  const left = (width - frameWidth) / 2
  const top = (height - frameHeight) / 2
  return [
    { x: left, y: top },
    { x: left + frameWidth, y: top },
    { x: left + frameWidth, y: top + frameHeight },
    { x: left, y: top + frameHeight },
  ]
}

function detectCorners(imageData: ImageData) {
  const { width, height, data } = imageData
  const gray = grayFromImageData(data)
  const magnitude = new Float32Array(width * height)
  let maxMagnitude = 0

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const gx =
        -gray[index - width - 1] - 2 * gray[index - 1] - gray[index + width - 1]
        + gray[index - width + 1] + 2 * gray[index + 1] + gray[index + width + 1]
      const gy =
        -gray[index - width - 1] - 2 * gray[index - width] - gray[index - width + 1]
        + gray[index + width - 1] + 2 * gray[index + width] + gray[index + width + 1]
      const value = Math.hypot(gx, gy)
      magnitude[index] = value
      if (value > maxMagnitude) maxMagnitude = value
    }
  }

  const threshold = maxMagnitude * 0.33
  const points: CapturePoint[] = []
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (magnitude[y * width + x] > threshold) points.push({ x, y })
    }
  }

  if (points.length < 700) return null

  return normalizeQuadOrder([
    points.reduce((best, current) => current.x + current.y < best.x + best.y ? current : best),
    points.reduce((best, current) => current.x - current.y > best.x - best.y ? current : best),
    points.reduce((best, current) => current.x + current.y > best.x + best.y ? current : best),
    points.reduce((best, current) => current.x - current.y < best.x - best.y ? current : best),
  ])
}

function calculateBlurScore(imageData: ImageData) {
  const { width, height, data } = imageData
  const gray = grayFromImageData(data)
  const laplace = new Float32Array(width * height)

  let sum = 0
  let count = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const value =
        gray[index - width] + gray[index - 1] + gray[index + 1] + gray[index + width] - 4 * gray[index]
      laplace[index] = value
      sum += value
      count += 1
    }
  }

  const mean = count ? sum / count : 0
  let variance = 0
  for (let index = 0; index < laplace.length; index += 1) {
    const diff = laplace[index] - mean
    variance += diff * diff
  }
  return count ? variance / count : 0
}

function evaluateQuality(width: number, height: number, corners: [CapturePoint, CapturePoint, CapturePoint, CapturePoint] | null, blurScore: number): CaptureQualityReport {
  const maxSide = Math.max(width, height)
  const resolutionOk = maxSide >= MIN_RESOLUTION_SIDE
  const documentAreaRatio = corners ? polygonArea(corners) / (width * height) : 0
  const documentSizeOk = documentAreaRatio >= MIN_DOCUMENT_AREA_RATIO
  const blurOk = blurScore >= MIN_BLUR_SCORE

  const issues: string[] = []
  if (!resolutionOk) issues.push('Risoluzione insufficiente. Avvicina il documento e riprova.')
  if (!documentSizeOk) issues.push('Documento troppo piccolo nell\'immagine. Inquadra piu da vicino.')
  if (!blurOk) issues.push('Immagine troppo sfocata. Tieni fermo il telefono e migliora la luce.')
  if (!corners) issues.push('Documento non rilevato chiaramente. Posizionalo dentro la cornice.')

  return {
    resolutionOk,
    blurOk,
    documentSizeOk,
    blurScore,
    documentAreaRatio,
    issues,
  }
}

async function fileToDataUrl(file: File) {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Immagine non valida.'))
    image.src = dataUrl
  })
}

function drawScaledCanvas(image: HTMLImageElement, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas non disponibile.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height)
  return { canvas, ctx, width, height }
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length
  const a = matrix.map((row, rowIndex) => [...row, vector[rowIndex]])

  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(a[row][pivot]) > Math.abs(a[maxRow][pivot])) maxRow = row
    }
    const swap = a[pivot]
    a[pivot] = a[maxRow]
    a[maxRow] = swap

    const divisor = a[pivot][pivot] || 1e-9
    for (let col = pivot; col <= size; col += 1) a[pivot][col] /= divisor

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue
      const factor = a[row][pivot]
      for (let col = pivot; col <= size; col += 1) a[row][col] -= factor * a[pivot][col]
    }
  }

  return a.map((row) => row[size])
}

function createHomography(destination: [CapturePoint, CapturePoint, CapturePoint, CapturePoint], source: [CapturePoint, CapturePoint, CapturePoint, CapturePoint]) {
  const matrix: number[][] = []
  const vector: number[] = []

  for (let index = 0; index < 4; index += 1) {
    const d = destination[index]
    const s = source[index]
    matrix.push([d.x, d.y, 1, 0, 0, 0, -d.x * s.x, -d.y * s.x])
    vector.push(s.x)
    matrix.push([0, 0, 0, d.x, d.y, 1, -d.x * s.y, -d.y * s.y])
    vector.push(s.y)
  }

  const [a, b, c, d, e, f, g, h] = solveLinearSystem(matrix, vector)
  return (x: number, y: number) => {
    const denominator = g * x + h * y + 1
    return {
      x: (a * x + b * y + c) / denominator,
      y: (d * x + e * y + f) / denominator,
    }
  }
}

function sampleBilinear(src: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const x0 = clamp(Math.floor(x), 0, width - 1)
  const y0 = clamp(Math.floor(y), 0, height - 1)
  const x1 = clamp(x0 + 1, 0, width - 1)
  const y1 = clamp(y0 + 1, 0, height - 1)
  const dx = x - x0
  const dy = y - y0

  const i00 = (y0 * width + x0) * 4
  const i10 = (y0 * width + x1) * 4
  const i01 = (y1 * width + x0) * 4
  const i11 = (y1 * width + x1) * 4

  const out = [0, 0, 0, 255]
  for (let channel = 0; channel < 3; channel += 1) {
    const top = src[i00 + channel] * (1 - dx) + src[i10 + channel] * dx
    const bottom = src[i01 + channel] * (1 - dx) + src[i11 + channel] * dx
    out[channel] = Math.round(top * (1 - dy) + bottom * dy)
  }
  return out
}

function autoTrimMargins(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const { width, height } = canvas
  const image = ctx.getImageData(0, 0, width, height)
  const luma = grayFromImageData(image.data)

  const border = Math.max(6, Math.round(Math.min(width, height) * 0.04))
  let borderSum = 0
  let borderCount = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < border || y < border || x >= width - border || y >= height - border) {
        borderSum += luma[y * width + x]
        borderCount += 1
      }
    }
  }

  const borderAvg = borderCount ? borderSum / borderCount : 128
  const threshold = 18
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.abs(luma[y * width + x] - borderAvg) < threshold) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (minX >= maxX || minY >= maxY) return canvas

  const padX = Math.round((maxX - minX) * 0.02)
  const padY = Math.round((maxY - minY) * 0.02)
  minX = clamp(minX - padX, 0, width - 1)
  minY = clamp(minY - padY, 0, height - 1)
  maxX = clamp(maxX + padX, 1, width)
  maxY = clamp(maxY + padY, 1, height)

  const cropW = Math.max(1, maxX - minX)
  const cropH = Math.max(1, maxY - minY)
  const out = document.createElement('canvas')
  out.width = cropW
  out.height = cropH
  const outCtx = out.getContext('2d')
  if (!outCtx) return canvas
  outCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH)
  return out
}

function enhanceLightly(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const src = new Uint8ClampedArray(image.data)

  for (let y = 1; y < canvas.height - 1; y += 1) {
    for (let x = 1; x < canvas.width - 1; x += 1) {
      const index = (y * canvas.width + x) * 4
      const left = index - 4
      const right = index + 4
      const up = index - canvas.width * 4
      const down = index + canvas.width * 4

      for (let channel = 0; channel < 3; channel += 1) {
        const base = src[index + channel]
        const blur = (src[left + channel] + src[right + channel] + src[up + channel] + src[down + channel]) / 4
        const sharpened = base + (base - blur) * 0.22
        const contrasted = (sharpened - 128) * 1.06 + 128
        image.data[index + channel] = clamp(Math.round(contrasted), 0, 255)
      }
      image.data[index + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas
}

function resizeIfNeeded(canvas: HTMLCanvasElement) {
  const longest = Math.max(canvas.width, canvas.height)
  const scale = longest > MAX_OUTPUT_WIDTH
    ? MAX_OUTPUT_WIDTH / longest
    : longest < MIN_OUTPUT_WIDTH
      ? MIN_OUTPUT_WIDTH / longest
      : 1

  if (Math.abs(scale - 1) < 0.01) return canvas

  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(canvas.width * scale))
  out.height = Math.max(1, Math.round(canvas.height * scale))
  const outCtx = out.getContext('2d')
  if (!outCtx) return canvas
  outCtx.imageSmoothingEnabled = true
  outCtx.imageSmoothingQuality = 'high'
  outCtx.drawImage(canvas, 0, 0, out.width, out.height)
  return out
}

async function canvasToFile(canvas: HTMLCanvasElement, sourceName: string) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((item) => {
      if (!item) {
        reject(new Error('Conversione immagine non riuscita.'))
        return
      }
      resolve(item)
    }, 'image/jpeg', 0.97)
  })
  const base = sourceName.replace(/\.[a-z0-9]+$/i, '')
  return new File([blob], `${base}-documento.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}

export async function analyzeDocumentCapture(file: File): Promise<CaptureAnalysisResult> {
  const originalDataUrl = await fileToDataUrl(file)
  const image = await loadImage(originalDataUrl)
  const scaled = drawScaledCanvas(image, MAX_ANALYSIS_SIDE)
  const imageData = scaled.ctx.getImageData(0, 0, scaled.width, scaled.height)

  const detected = detectCorners(imageData)
  const blurScore = calculateBlurScore(imageData)
  const quality = evaluateQuality(scaled.width, scaled.height, detected, blurScore)
  const fallbackFrame = createFallbackFrame(scaled.width, scaled.height)

  return {
    originalFile: file,
    originalDataUrl,
    width: scaled.width,
    height: scaled.height,
    detectedCorners: detected,
    defaultCorners: detected ?? fallbackFrame,
    quality,
  }
}

export async function buildProcessedDocument(
  sourceDataUrl: string,
  corners: [CapturePoint, CapturePoint, CapturePoint, CapturePoint],
  sourceName: string,
): Promise<CaptureProcessedResult> {
  const image = await loadImage(sourceDataUrl)
  const canvasInfo = drawScaledCanvas(image, MAX_ANALYSIS_SIDE)
  const sourceCanvas = canvasInfo.canvas

  const top = distance(corners[0], corners[1])
  const bottom = distance(corners[2], corners[3])
  const left = distance(corners[0], corners[3])
  const right = distance(corners[1], corners[2])

  const avgWidth = (top + bottom) / 2
  const avgHeight = (left + right) / 2
  let ratio = avgWidth / Math.max(1, avgHeight)
  if (!Number.isFinite(ratio) || ratio < 1.1 || ratio > 2.5) ratio = TARGET_RATIO

  const outWidth = Math.round(clamp(avgWidth, MIN_OUTPUT_WIDTH, MAX_OUTPUT_WIDTH))
  const outHeight = Math.round(clamp(outWidth / ratio, 680, 1500))

  const output = document.createElement('canvas')
  output.width = outWidth
  output.height = outHeight
  const outCtx = output.getContext('2d')
  const srcCtx = sourceCanvas.getContext('2d')
  if (!outCtx || !srcCtx) throw new Error('Canvas non disponibile.')

  const sourceImage = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
  const outImage = outCtx.createImageData(outWidth, outHeight)
  const destination: [CapturePoint, CapturePoint, CapturePoint, CapturePoint] = [
    { x: 0, y: 0 },
    { x: outWidth - 1, y: 0 },
    { x: outWidth - 1, y: outHeight - 1 },
    { x: 0, y: outHeight - 1 },
  ]

  const map = createHomography(destination, corners)
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const src = map(x, y)
      const index = (y * outWidth + x) * 4
      if (src.x < 0 || src.y < 0 || src.x >= sourceCanvas.width || src.y >= sourceCanvas.height) {
        outImage.data[index] = 24
        outImage.data[index + 1] = 24
        outImage.data[index + 2] = 24
        outImage.data[index + 3] = 255
        continue
      }
      const pixel = sampleBilinear(sourceImage.data, sourceCanvas.width, sourceCanvas.height, src.x, src.y)
      outImage.data[index] = pixel[0]
      outImage.data[index + 1] = pixel[1]
      outImage.data[index + 2] = pixel[2]
      outImage.data[index + 3] = 255
    }
  }

  outCtx.putImageData(outImage, 0, 0)

  let resultCanvas = autoTrimMargins(output)
  resultCanvas = enhanceLightly(resultCanvas)
  resultCanvas = resizeIfNeeded(resultCanvas)

  const processedFile = await canvasToFile(resultCanvas, sourceName)
  const processedDataUrl = await fileToDataUrl(processedFile)

  return {
    file: processedFile,
    dataUrl: processedDataUrl,
  }
}

export function pointsToNormalized(
  points: [CapturePoint, CapturePoint, CapturePoint, CapturePoint],
  width: number,
  height: number,
): [CapturePoint, CapturePoint, CapturePoint, CapturePoint] {
  return [
    { x: clamp(points[0].x / width, 0, 1), y: clamp(points[0].y / height, 0, 1) },
    { x: clamp(points[1].x / width, 0, 1), y: clamp(points[1].y / height, 0, 1) },
    { x: clamp(points[2].x / width, 0, 1), y: clamp(points[2].y / height, 0, 1) },
    { x: clamp(points[3].x / width, 0, 1), y: clamp(points[3].y / height, 0, 1) },
  ]
}

export function normalizedToPoints(
  normalized: [CapturePoint, CapturePoint, CapturePoint, CapturePoint],
  width: number,
  height: number,
): [CapturePoint, CapturePoint, CapturePoint, CapturePoint] {
  return [
    { x: clamp(normalized[0].x, 0, 1) * width, y: clamp(normalized[0].y, 0, 1) * height },
    { x: clamp(normalized[1].x, 0, 1) * width, y: clamp(normalized[1].y, 0, 1) * height },
    { x: clamp(normalized[2].x, 0, 1) * width, y: clamp(normalized[2].y, 0, 1) * height },
    { x: clamp(normalized[3].x, 0, 1) * width, y: clamp(normalized[3].y, 0, 1) * height },
  ]
}

export function summarizeQuality(report: CaptureQualityReport) {
  if (!report.issues.length) return 'Qualita immagine buona.'
  return normalizeWhitespace(report.issues.join(' '))
}
