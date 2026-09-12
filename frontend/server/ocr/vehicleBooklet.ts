import type { VehicleBookletOcrResponse } from '../../src/types.js'
import { getAzureDocumentIntelligenceConfig } from './documentIdentity.js'

const AZURE_DOCUMENT_INTELLIGENCE_API_VERSION = '2024-11-30'
const AZURE_VEHICLE_BOOKLET_MODEL_ID = 'prebuilt-read'
const DEFAULT_POLL_INTERVAL_MS = 1000
const DEFAULT_MAX_POLL_ATTEMPTS = 15

export const VEHICLE_BOOKLET_OCR_GENERIC_ERROR = 'Non e stato possibile leggere automaticamente il libretto. Puoi inserire o correggere i dati manualmente.'

interface AzureAnalyzeResultPayload {
  status?: string
  error?: {
    code?: string
    message?: string
    parameter?: string
    target?: string
    innererror?: {
      code?: string
      message?: string
      parameter?: string
      target?: string
    }
  }
  analyzeResult?: {
    content?: string
  }
}

class VehicleBookletOcrError extends Error {
  stage: string
  code: string | null

  constructor(stage: string, code: string | null, message: string) {
    super(message)
    this.stage = stage
    this.code = code
  }
}

type BookletField = VehicleBookletOcrResponse['fields'][keyof VehicleBookletOcrResponse['fields']]

function emptyField(): BookletField {
  return { value: '', confidence: null, source: 'manual' }
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeCodeLabel(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function normalizeDate(value: string) {
  const normalized = compact(value)
  if (!normalized) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized
  const match = normalized.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (!match) return ''
  const [, dayRaw, monthRaw, yearRaw] = match
  const day = dayRaw.padStart(2, '0')
  const month = monthRaw.padStart(2, '0')
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw
  return `${year}-${month}-${day}`
}

function extractLabelValue(content: string, labels: string[]) {
  const rows = content.split(/\r?\n/).map((row) => row.trim()).filter(Boolean)
  for (const row of rows) {
    for (const label of labels) {
      const withSeparator = new RegExp(`^${label}\\s*[:=-]\\s*(.+)$`, 'i')
      const inline = new RegExp(`^${label}\\s+(.+)$`, 'i')
      const m1 = row.match(withSeparator)
      if (m1?.[1]) return compact(m1[1])
      const m2 = row.match(inline)
      if (m2?.[1]) return compact(m2[1])
    }
  }
  return ''
}

function codeTokenPattern(code: string) {
  return code
    .trim()
    .toUpperCase()
    .split('')
    .map((char) => {
      if (char === '.') return '\\s*[._-]?\\s*'
      return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('\\s*')
}

function extractCodeValue(content: string, code: string | string[]) {
  const codes = Array.isArray(code) ? code : [code]
  const rows = content.split(/\r?\n/).map((row) => row.trim()).filter(Boolean)

  // Italian registration certificates frequently place several coded fields
  // on the same OCR line, e.g. “(P.1) 4806 (P.2) 294.00 (P.3) BENZINA”.
  // Capture only the text belonging to the requested field and stop at the
  // next official field marker instead of consuming the rest of the row.
  const nextCodeBoundary = '(?=\\s*\\(?[A-Z]\\s*(?:[._-]?\\s*\\d(?:\\s*[._-]?\\s*\\d)?)?\\)?\\s*[:)=\\-]?\\s+|$)'

  for (const requestedCode of codes) {
    const token = codeTokenPattern(requestedCode)
    const expression = new RegExp(`(?:^|\\s|\\()${token}\\)?\\s*[:)=\\-]?\\s*(.+?)${nextCodeBoundary}`, 'i')

    for (const row of rows) {
      const match = row.match(expression)
      const value = match?.[1] ? compact(match[1]) : ''
      if (value) return value
    }
  }

  // Some OCR engines split a marker and its value across adjacent lines.
  for (let index = 0; index < rows.length - 1; index += 1) {
    const rowCode = normalizeCodeLabel(rows[index])
    const expected = codes.map(normalizeCodeLabel)
    if (expected.includes(rowCode)) {
      const next = compact(rows[index + 1])
      if (next) return next
    }
  }

  return ''
}

function normalizePlate(value: string) {
  const direct = compact(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(direct)) return direct
  const fallback = value.toUpperCase().match(/\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b/)
  return fallback ? fallback[0].replace(/\s+/g, '') : ''
}

function normalizeVin(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '')
  const match = normalized.match(/[A-HJ-NPR-Z0-9]{17}/)
  return match?.[0] ?? ''
}

function normalizeEngineDisplacement(value: string) {
  const normalized = compact(value)
  const explicit = normalized.match(/(\d{3,5})\s*(CC|CM3|CM\^3|CM³)\b/i)
  const raw = explicit?.[1] ?? normalized.match(/\b(\d{3,5})\b/)?.[1] ?? ''
  if (!raw) return ''
  const displacement = Number(raw)
  if (!Number.isFinite(displacement) || displacement < 400 || displacement > 12000) return ''
  return `${Math.round(displacement)} cm3`
}

function normalizePower(value: string) {
  const normalized = compact(value).replace(',', '.')
  const explicit = normalized.match(/(\d{1,4}(?:\.\d{1,2})?)\s*(KW|CV)\b/i)
  const raw = explicit?.[1] ?? normalized.match(/\b(\d{1,4}(?:\.\d{1,2})?)\b/)?.[1] ?? ''
  if (!raw) return ''
  const power = Number(raw)
  if (!Number.isFinite(power) || power < 10 || power > 1000) return ''
  const unit = explicit?.[2]?.toLowerCase() ?? 'kw'
  return `${raw} ${unit}`
}

function normalizeOwner(value: string) {
  const normalized = compact(value)
  if (!normalized) return ''
  const withLetters = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(normalized)
  if (!withLetters) return ''
  if (normalized.length < 4) return ''
  return normalized
}

function toField(value: string, confidence: number): BookletField {
  const normalized = compact(value)
  if (!normalized) return emptyField()
  return { value: normalized, confidence, source: 'azure' }
}

function normalizeFuel(value: string) {
  const normalized = compact(value).toUpperCase()
  if (!normalized) return ''
  if (normalized.includes('DIESEL') || normalized.includes('GASOLIO')) return 'Diesel'
  if (normalized.includes('BENZINA')) return 'Benzina'
  if (normalized.includes('GPL')) return 'GPL'
  if (normalized.includes('METANO')) return 'Metano'
  if (normalized.includes('ELETTR')) return 'Elettrico'
  if (normalized.includes('IBRID')) return 'Ibrido'
  return ''
}

interface AzureErrorDetails {
  bodyPresent: boolean
  code: string | null
  message: string | null
  innerCode: string | null
  innerMessage: string | null
  parameter: string | null
  target: string | null
  sanitizedBody: string | null
}

async function readAzureErrorPayload(response: Response): Promise<AzureErrorDetails> {
  const raw = await response.text()
  const rawText = raw.trim()

  const sanitizeStructuredBody = (parsed: AzureAnalyzeResultPayload) => {
    const error = parsed.error
    if (!error) return null

    return {
      error: {
        code: typeof error.code === 'string' ? error.code : null,
        message: typeof error.message === 'string' ? error.message : null,
        parameter: typeof error.parameter === 'string' ? error.parameter : null,
        target: typeof error.target === 'string' ? error.target : null,
        innererror: error.innererror
          ? {
              code: typeof error.innererror.code === 'string' ? error.innererror.code : null,
              message: typeof error.innererror.message === 'string' ? error.innererror.message : null,
              parameter: typeof error.innererror.parameter === 'string' ? error.innererror.parameter : null,
              target: typeof error.innererror.target === 'string' ? error.innererror.target : null,
            }
          : null,
      },
    }
  }

  try {
    const parsed = JSON.parse(raw) as AzureAnalyzeResultPayload
    const sanitizedBody = sanitizeStructuredBody(parsed)
    return {
      bodyPresent: true,
      code: typeof parsed.error?.code === 'string' ? parsed.error.code : null,
      message: typeof parsed.error?.message === 'string' ? parsed.error.message : null,
      innerCode: typeof parsed.error?.innererror?.code === 'string' ? parsed.error.innererror.code : null,
      innerMessage: typeof parsed.error?.innererror?.message === 'string' ? parsed.error.innererror.message : null,
      parameter: typeof parsed.error?.parameter === 'string' ? parsed.error.parameter : null,
      target: typeof parsed.error?.target === 'string' ? parsed.error.target : null,
      sanitizedBody: sanitizedBody ? JSON.stringify(sanitizedBody) : null,
    }
  } catch {
    return {
      bodyPresent: Boolean(rawText),
      code: null,
      message: null,
      innerCode: null,
      innerMessage: null,
      parameter: null,
      target: null,
      sanitizedBody: rawText ? JSON.stringify({ body: rawText.slice(0, 800) }) : null,
    }
  }
}

async function pollAnalyzeResult(operationLocation: string, key: string, fetchImpl: typeof fetch, sleep: (ms: number) => Promise<void>) {
  for (let attempt = 0; attempt < DEFAULT_MAX_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(DEFAULT_POLL_INTERVAL_MS)

    console.info('LIBRETTO OCR STEP 5 - POLL START')
    const pollResponse = await fetchImpl(operationLocation, {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
      },
    })
    console.info(`LIBRETTO OCR STEP 6 - POLL HTTP STATUS: ${pollResponse.status}`)

    if (!pollResponse.ok) {
      const azureError = await readAzureErrorPayload(pollResponse)
      throw new VehicleBookletOcrError('POLL_HTTP', azureError.code, `Polling Azure non riuscito (${pollResponse.status}${azureError.code ? ` ${azureError.code}` : ''}).`)
    }

    const payload = await pollResponse.json() as AzureAnalyzeResultPayload
    const status = String(payload.status ?? '').toLowerCase()
    console.info(`LIBRETTO OCR STEP 7 - AZURE STATUS: ${status || 'unknown'}`)
    if (status === 'succeeded') return payload
    if (status === 'failed' || payload.error) {
      const code = payload.error?.code ? ` ${payload.error.code}` : ''
      throw new VehicleBookletOcrError('POLL_AZURE_STATUS', payload.error?.code ?? null, `Azure non ha letto il libretto.${code}`)
    }
  }

  throw new VehicleBookletOcrError('POLL_TIMEOUT', null, 'Timeout lettura libretto Azure.')
}

export function normalizeAzureVehicleBookletResult(payload: AzureAnalyzeResultPayload): VehicleBookletOcrResponse {
  const content = String(payload.analyzeResult?.content ?? '')
  const warnings: string[] = []

  if (!content.trim()) {
    return {
      success: true,
      fields: {
        plate: emptyField(),
        vin: emptyField(),
        make: emptyField(),
        model: emptyField(),
        firstRegistration: emptyField(),
        fuel: emptyField(),
        engineDisplacement: emptyField(),
        power: emptyField(),
        owner: emptyField(),
      },
      warnings: ['Testo OCR del libretto non disponibile.'],
    }
  }

  const uppercaseContent = content.toUpperCase()
  const plateValue = normalizePlate(extractCodeValue(content, 'A') || uppercaseContent)
  const vinValue = normalizeVin(extractCodeValue(content, 'E') || uppercaseContent)
  const makeValue = compact(extractCodeValue(content, 'D.1') || extractLabelValue(content, ['MARCA', 'FABBRICA']))
  const modelValue = compact(
    extractCodeValue(content, 'D.3')
      || extractCodeValue(content, 'D.2')
      || extractLabelValue(content, ['DENOMINAZIONE\\s+COMMERCIALE', 'MODELLO', 'TIPO']),
  )
  const firstRegistrationRaw = extractCodeValue(content, 'B') || extractLabelValue(content, ['DATA\\s+IMMATRICOLAZIONE', 'IMMATRICOLAZIONE', 'PRIMA\\s+IMMATRICOLAZIONE'])
  const firstRegistrationValue = normalizeDate(firstRegistrationRaw)
  const fuelValue = normalizeFuel(extractCodeValue(content, 'P.3') || extractLabelValue(content, ['ALIMENTAZIONE', 'CARBURANTE']))
  const displacementValue = normalizeEngineDisplacement(extractCodeValue(content, 'P.1'))
  const powerValue = normalizePower(extractCodeValue(content, 'P.2'))
  const ownerValue = normalizeOwner(
    extractCodeValue(content, ['C.1', 'C.1.1', 'C.1.2'])
      || extractLabelValue(content, ['INTESTATARIO', 'PROPRIETARIO']),
  )

  const fields: VehicleBookletOcrResponse['fields'] = {
    plate: toField(plateValue, 0.95),
    vin: toField(vinValue, 0.93),
    make: toField(makeValue, 0.82),
    model: toField(modelValue, 0.82),
    firstRegistration: toField(firstRegistrationValue, 0.8),
    fuel: toField(fuelValue, 0.8),
    engineDisplacement: toField(displacementValue, 0.9),
    power: toField(powerValue, 0.9),
    owner: toField(ownerValue, 0.74),
  }

  const recognizedCount = Object.values(fields).filter((field) => field.value.trim()).length
  if (!recognizedCount) warnings.push('Nessun campo libretto riconosciuto con confidenza sufficiente.')

  return {
    success: true,
    fields,
    warnings,
  }
}

export async function analyzeVehicleBookletWithAzure(
  input: { name: string; contentType: string; bytes: Uint8Array },
  options: {
    env?: NodeJS.ProcessEnv
    fetchImpl?: typeof fetch
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<VehicleBookletOcrResponse> {
  try {
    const env = options.env ?? process.env
    const { endpoint, key } = getAzureDocumentIntelligenceConfig(env)
    const fetchImpl = options.fetchImpl ?? fetch
    const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

    const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${AZURE_VEHICLE_BOOKLET_MODEL_ID}:analyze?_overload=analyzeDocument&api-version=${AZURE_DOCUMENT_INTELLIGENCE_API_VERSION}`
    console.info('LIBRETTO OCR STEP 2 - AZURE ANALYZE START')
    const analyzeResponse = await fetchImpl(analyzeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': key,
      },
      body: JSON.stringify({ base64Source: Buffer.from(input.bytes).toString('base64') }),
    })
    console.info(`LIBRETTO OCR STEP 3 - ANALYZE HTTP STATUS: ${analyzeResponse.status}`)

    if (!analyzeResponse.ok) {
      const azureError = await readAzureErrorPayload(analyzeResponse)
      console.info(`AZURE ANALYZE HTTP STATUS: ${analyzeResponse.status}`)
      console.info(`AZURE ERROR CODE: ${azureError.code ?? 'N/A'}`)
      console.info(`AZURE ERROR MESSAGE: ${azureError.message ?? 'N/A'}`)
      console.info(`AZURE INNER ERROR CODE: ${azureError.innerCode ?? 'N/A'}`)
      console.info(`AZURE INNER ERROR MESSAGE: ${azureError.innerMessage ?? 'N/A'}`)
      console.info(`AZURE RAW ERROR STATUS: ${analyzeResponse.status}`)
      console.info(`AZURE RAW ERROR CODE: ${azureError.code ?? 'N/A'}`)
      console.info(`AZURE RAW ERROR MESSAGE: ${azureError.message ?? 'N/A'}`)
      console.info(`AZURE RAW INNER ERROR CODE: ${azureError.innerCode ?? 'N/A'}`)
      console.info(`AZURE RAW INNER ERROR MESSAGE: ${azureError.innerMessage ?? 'N/A'}`)
      console.info(`AZURE RAW ERROR PARAMETER: ${azureError.parameter ?? 'N/A'}`)
      console.info(`AZURE RAW ERROR TARGET: ${azureError.target ?? 'N/A'}`)
      console.info(`AZURE RESPONSE BODY PRESENT: ${azureError.bodyPresent ? 'SI' : 'NO'}`)
      if (azureError.sanitizedBody) {
        console.info(`AZURE RAW ERROR BODY SANITIZED: ${azureError.sanitizedBody}`)
      }
      throw new VehicleBookletOcrError('ANALYZE_HTTP', azureError.code, `Invio libretto ad Azure non riuscito (${analyzeResponse.status}${azureError.code ? ` ${azureError.code}` : ''}).`)
    }

    const operationLocation = analyzeResponse.headers.get('operation-location')
    console.info(`LIBRETTO OCR STEP 4 - OPERATION LOCATION PRESENT: ${operationLocation ? 'SI' : 'NO'}`)
    if (!operationLocation) throw new VehicleBookletOcrError('ANALYZE_OPERATION_LOCATION', null, 'Azure non ha restituito l operazione OCR libretto.')

    const payload = await pollAnalyzeResult(operationLocation, key, fetchImpl, sleep)
    const content = String(payload.analyzeResult?.content ?? '')
    console.info(`LIBRETTO OCR STEP 8 - TEXT RECEIVED: ${content.trim() ? 'SI' : 'NO'}`)
    console.info('LIBRETTO OCR STEP 9 - PARSER START')
    const normalized = normalizeAzureVehicleBookletResult(payload)
    console.info('LIBRETTO OCR STEP 10 - PARSER SUCCESS: SI')
    return normalized
  } catch (error) {
    const stage = error instanceof VehicleBookletOcrError ? error.stage : 'UNKNOWN'
    const code = error instanceof VehicleBookletOcrError ? error.code : null
    const message = error instanceof Error ? error.message : 'Errore OCR libretto non gestito.'
    console.info('LIBRETTO OCR STEP 10 - PARSER SUCCESS: NO')
    console.error(`LIBRETTO OCR ERROR STAGE: ${stage}`)
    console.error(`LIBRETTO OCR ERROR CODE: ${code ?? 'N/A'}`)
    console.error(`LIBRETTO OCR ERROR MESSAGE: ${message}`)
    throw error
  }
}
