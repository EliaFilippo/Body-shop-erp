interface Point {
  x: number
  y: number
}

export interface IdentityDocumentPreprocessResult {
  originalDataUrl: string
  autoDataUrl: string | null
  autoFile: File | null
  reliability: number
  usedFallback: boolean
  reason: string
}

interface QuadDetectionResult {
  corners: [Point, Point, Point, Point]
  reliability: number
}

const TARGET_RATIO = 1.58
const MIN_EDGE_PIXELS = 600
const MAX_INPUT_SIDE = 1900
const MIN_OUTPUT_WIDTH = 1000
const MAX_OUTPUT_WIDTH = 1600

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function distance(a: Point, b: Point) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

function polygonArea(points: Point[]) {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.x * next.y - next.x * current.y
  }
  return Math.abs(sum) / 2
}

export function normalizeQuadOrder(points: Point[]): [Point, Point, Point, Point] {
  const [p1, p2, p3, p4] = points
  const tl = [p1, p2, p3, p4].reduce((best, current) => current.x + current.y < best.x + best.y ? current : best)
  const br = [p1, p2, p3, p4].reduce((best, current) => current.x + current.y > best.x + best.y ? current : best)
  const tr = [p1, p2, p3, p4].reduce((best, current) => current.x - current.y > best.x - best.y ? current : best)
  const bl = [p1, p2, p3, p4].reduce((best, current) => current.x - current.y < best.x - best.y ? current : best)
  return [tl, tr, br, bl]
}

export function estimateDocumentQuadReliability(corners: [Point, Point, Point, Point], width: number, height: number) {
  const areaRatio = polygonArea(corners) / (width * height)
  const top = distance(corners[0], corners[1])
  const right = distance(corners[1], corners[2])
  const bottom = distance(corners[2], corners[3])
  const left = distance(corners[3], corners[0])
  const avgHorizontal = (top + bottom) / 2
  const avgVertical = (left + right) / 2
  const ratio = avgHorizontal / Math.max(1, avgVertical)

  const areaScore = clamp((areaRatio - 0.16) / 0.54, 0, 1)
  const ratioDistance = Math.abs(ratio - TARGET_RATIO)
  const ratioScore = clamp(1 - ratioDistance / 1.2, 0, 1)
  const symmetryScore = clamp(1 - (Math.abs(top - bottom) + Math.abs(left - right)) / (avgHorizontal + avgVertical + 1), 0, 1)
  const edgePadding = Math.min(
    corners[0].x,
    corners[0].y,
    width - corners[1].x,
    corners[1].y,
    width - corners[2].x,
    height - corners[2].y,
    corners[3].x,
    height - corners[3].y,
  )
  const paddingScore = clamp(edgePadding / Math.min(width, height) / 0.08, 0, 1)

  return clamp(areaScore * 0.45 + ratioScore * 0.3 + symmetryScore * 0.15 + paddingScore * 0.1, 0, 1)
}

function loadImageFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Impossibile leggere immagine.'))
    image.src = dataUrl
  })
}

async function fileToDataUrl(file: File) {
  const bytes = await file.arrayBuffer()
  let binary = ''
  const view = new Uint8Array(bytes)
  for (let index = 0; index < view.length; index += 1) {
    binary += String.fromCharCode(view[index])
  }
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

function drawImageScaled(image: HTMLImageElement, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas non disponibile.')
  ctx.drawImage(image, 0, 0, width, height)
  return { canvas, ctx, width, height }
}

function extractGray(data: Uint8ClampedArray) {
  const gray = new Float32Array(data.length / 4)
  for (let index = 0, out = 0; index < data.length; index += 4, out += 1) {
    gray[out] = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
  }
  return gray
}

function detectDocumentQuad(imageData: ImageData): QuadDetectionResult | null {
  const { width, height, data } = imageData
  const gray = extractGray(data)
  const magnitude = new Float32Array(width * height)

  let maxMagnitude = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      const gx =
        -gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1]
        + gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1]
      const gy =
        -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1]
        + gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1]
      const edge = Math.hypot(gx, gy)
      magnitude[i] = edge
      if (edge > maxMagnitude) maxMagnitude = edge
    }
  }

  const threshold = maxMagnitude * 0.33
  const points: Point[] = []
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const edge = magnitude[y * width + x]
      if (edge > threshold) points.push({ x, y })
    }
  }

  if (points.length < MIN_EDGE_PIXELS) return null

  const raw = normalizeQuadOrder([
    points.reduce((best, current) => current.x + current.y < best.x + best.y ? current : best),
    points.reduce((best, current) => current.x - current.y > best.x - best.y ? current : best),
    points.reduce((best, current) => current.x + current.y > best.x + best.y ? current : best),
    points.reduce((best, current) => current.x - current.y < best.x - best.y ? current : best),
  ])

  const reliability = estimateDocumentQuadReliability(raw, width, height)
  if (reliability < 0.35) return null

  return { corners: raw, reliability }
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length
  const a = matrix.map((row, rowIndex) => [...row, vector[rowIndex]])

  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(a[row][pivot]) > Math.abs(a[maxRow][pivot])) maxRow = row
    }
    const temp = a[pivot]
    a[pivot] = a[maxRow]
    a[maxRow] = temp

    const divisor = a[pivot][pivot] || 1e-8
    for (let col = pivot; col <= size; col += 1) a[pivot][col] /= divisor

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue
      const factor = a[row][pivot]
      for (let col = pivot; col <= size; col += 1) {
        a[row][col] -= factor * a[pivot][col]
      }
    }
  }

  return a.map((row) => row[size])
}

function createHomography(dst: [Point, Point, Point, Point], src: [Point, Point, Point, Point]) {
  const matrix: number[][] = []
  const vector: number[] = []

  for (let index = 0; index < 4; index += 1) {
    const d = dst[index]
    const s = src[index]
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

function warpQuadToCanvas(source: HTMLCanvasElement, corners: [Point, Point, Point, Point]) {
  const srcCtx = source.getContext('2d')
  if (!srcCtx) throw new Error('Canvas sorgente non disponibile.')
  const srcImage = srcCtx.getImageData(0, 0, source.width, source.height)

  const top = distance(corners[0], corners[1])
  const bottom = distance(corners[3], corners[2])
  const left = distance(corners[0], corners[3])
  const right = distance(corners[1], corners[2])

  const avgWidth = (top + bottom) / 2
  const avgHeight = (left + right) / 2
  let ratio = avgWidth / Math.max(1, avgHeight)
  if (!Number.isFinite(ratio) || ratio < 1.15 || ratio > 2.4) ratio = TARGET_RATIO

  let outWidth = Math.round(clamp(avgWidth, MIN_OUTPUT_WIDTH, MAX_OUTPUT_WIDTH))
  let outHeight = Math.round(outWidth / ratio)
  outHeight = Math.round(clamp(outHeight, 620, 1200))

  const output = document.createElement('canvas')
  output.width = outWidth
  output.height = outHeight
  const outCtx = output.getContext('2d')
  if (!outCtx) throw new Error('Canvas output non disponibile.')

  const destination: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: outWidth - 1, y: 0 },
    { x: outWidth - 1, y: outHeight - 1 },
    { x: 0, y: outHeight - 1 },
  ]

  const map = createHomography(destination, corners)
  const outImage = outCtx.createImageData(outWidth, outHeight)

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const src = map(x, y)
      const index = (y * outWidth + x) * 4
      if (src.x < 0 || src.x >= source.width || src.y < 0 || src.y >= source.height) {
        outImage.data[index] = 24
        outImage.data[index + 1] = 24
        outImage.data[index + 2] = 24
        outImage.data[index + 3] = 255
        continue
      }
      const pixel = sampleBilinear(srcImage.data, source.width, source.height, src.x, src.y)
      outImage.data[index] = pixel[0]
      outImage.data[index + 1] = pixel[1]
      outImage.data[index + 2] = pixel[2]
      outImage.data[index + 3] = 255
    }
  }

  outCtx.putImageData(outImage, 0, 0)
  return output
}

function autoTrimMargins(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const { width, height } = canvas
  const image = ctx.getImageData(0, 0, width, height)
  const luminance = new Float32Array(width * height)

  let borderSum = 0
  let borderCount = 0
  const border = Math.max(4, Math.round(Math.min(width, height) * 0.04))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4
      const l = image.data[idx] * 0.299 + image.data[idx + 1] * 0.587 + image.data[idx + 2] * 0.114
      luminance[y * width + x] = l
      if (x < border || x >= width - border || y < border || y >= height - border) {
        borderSum += l
        borderCount += 1
      }
    }
  }

  const borderAverage = borderCount ? borderSum / borderCount : 128
  const threshold = 16
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const l = luminance[y * width + x]
      if (Math.abs(l - borderAverage) < threshold) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (minX >= maxX || minY >= maxY) return canvas

  const paddingX = Math.round((maxX - minX) * 0.02)
  const paddingY = Math.round((maxY - minY) * 0.02)
  minX = clamp(minX - paddingX, 0, width - 1)
  minY = clamp(minY - paddingY, 0, height - 1)
  maxX = clamp(maxX + paddingX, 1, width)
  maxY = clamp(maxY + paddingY, 1, height)

  const cropWidth = Math.max(1, maxX - minX)
  const cropHeight = Math.max(1, maxY - minY)

  const out = document.createElement('canvas')
  out.width = cropWidth
  out.height = cropHeight
  const outCtx = out.getContext('2d')
  if (!outCtx) return canvas
  outCtx.drawImage(canvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  return out
}

function enhanceForOcr(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const source = new Uint8ClampedArray(image.data)

  for (let y = 1; y < canvas.height - 1; y += 1) {
    for (let x = 1; x < canvas.width - 1; x += 1) {
      const i = (y * canvas.width + x) * 4
      const left = i - 4
      const right = i + 4
      const up = i - canvas.width * 4
      const down = i + canvas.width * 4

      for (let channel = 0; channel < 3; channel += 1) {
        const base = source[i + channel]
        const blur = (source[left + channel] + source[right + channel] + source[up + channel] + source[down + channel]) / 4
        const sharpened = base + (base - blur) * 0.25
        const contrasted = (sharpened - 128) * 1.08 + 128
        image.data[i + channel] = clamp(Math.round(contrasted), 0, 255)
      }
      image.data[i + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas
}

function resizeQuality(canvas: HTMLCanvasElement) {
  const longest = Math.max(canvas.width, canvas.height)
  const scale =
    longest > MAX_OUTPUT_WIDTH
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

async function canvasToJpegFile(canvas: HTMLCanvasElement, sourceName: string) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((item) => {
      if (!item) {
        reject(new Error('Conversione immagine non riuscita.'))
        return
      }
      resolve(item)
    }, 'image/jpeg', 0.92)
  })

  const normalizedName = sourceName.replace(/\.[a-z0-9]+$/i, '')
  return new File([blob], `${normalizedName}-ocr.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}

export async function preprocessIdentityDocumentImage(file: File): Promise<IdentityDocumentPreprocessResult> {
  const originalDataUrl = await fileToDataUrl(file)
  const image = await loadImageFromDataUrl(originalDataUrl)
  const scaled = drawImageScaled(image, MAX_INPUT_SIDE)
  const imageData = scaled.ctx.getImageData(0, 0, scaled.width, scaled.height)
  const quad = detectDocumentQuad(imageData)

  if (!quad) {
    return {
      originalDataUrl,
      autoDataUrl: null,
      autoFile: null,
      reliability: 0,
      usedFallback: true,
      reason: 'Rilevamento automatico non affidabile',
    }
  }

  let resultCanvas = warpQuadToCanvas(scaled.canvas, quad.corners)
  resultCanvas = autoTrimMargins(resultCanvas)
  resultCanvas = enhanceForOcr(resultCanvas)
  resultCanvas = resizeQuality(resultCanvas)

  const autoFile = await canvasToJpegFile(resultCanvas, file.name)
  const autoDataUrl = await fileToDataUrl(autoFile)

  return {
    originalDataUrl,
    autoDataUrl,
    autoFile,
    reliability: quad.reliability,
    usedFallback: quad.reliability < 0.55,
    reason: quad.reliability < 0.55 ? 'Ritaglio automatico disponibile ma poco affidabile' : 'Ritaglio automatico pronto',
  }
}
