import type { IdentityDocumentOcrDocumentType, IdentityDocumentOcrField, IdentityDocumentOcrResponse } from '../../src/types.js'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AZURE_DOCUMENT_INTELLIGENCE_API_VERSION = '2024-11-30'
const AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID = 'prebuilt-idDocument'
export const AZURE_OCR_AUTOFILL_CONFIDENCE_THRESHOLD = 0.8
export const GENERIC_DOCUMENT_IDENTITY_OCR_MESSAGE = 'Non è stato possibile leggere automaticamente il documento. Puoi inserire o correggere i dati manualmente.'
const DEFAULT_POLL_INTERVAL_MS = 1000
const DEFAULT_MAX_POLL_ATTEMPTS = 15

const OCR_SERVER_DIR = dirname(fileURLToPath(import.meta.url))
const FRONTEND_ENV_PATH = resolve(OCR_SERVER_DIR, '../../.env')

function hydrateProcessEnvFromFrontendDotEnv(env: NodeJS.ProcessEnv = process.env) {
  if (!existsSync(FRONTEND_ENV_PATH)) return

  const content = readFileSync(FRONTEND_ENV_PATH, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    if (!key || env[key]) continue

    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    env[key] = value
  }
}

interface AzureAddressValue {
  streetAddress?: string
  city?: string
  state?: string
  postalCode?: string
  countryRegion?: string
}

interface AzureDocumentField {
  content?: string
  confidence?: number
  valueString?: string
  valueDate?: string
  valueCountryRegion?: string
  valueAddress?: AzureAddressValue
}

interface AzureAnalyzedDocument {
  docType?: string
  fields?: Record<string, AzureDocumentField | undefined>
}

interface AzureAnalyzeResultPayload {
  status?: string
  error?: {
    code?: string
    message?: string
  }
  analyzeResult?: {
    content?: string
    documents?: AzureAnalyzedDocument[]
  }
}

interface RecognizedFieldCandidate {
  value: string
  confidence: number | null
  sourceProperty: string
  sourceType: 'structured' | 'content-fallback'
}

type ManagedIdentityField = keyof IdentityDocumentOcrResponse['fields']

interface FieldConfidencePolicy {
  minAutofill: number
  highConfidence: number
}

interface AzureFieldObservation {
  property: string
  present: boolean
  nonEmpty: boolean
  confidence: number | null
}

interface ManagedFieldDiagnostic {
  managedField: ManagedIdentityField
  azurePropertyUsed: string | null
  present: boolean
  nonEmpty: boolean
  confidence: number | null
  sourceType: 'structured' | 'content-fallback' | 'none'
}

interface IdentityNormalizationDiagnostics {
  detectedDocumentType: IdentityDocumentOcrDocumentType
  azureReturnedFields: AzureFieldObservation[]
  mappedFields: ManagedFieldDiagnostic[]
}

interface IdentityNormalizationOutcome {
  response: IdentityDocumentOcrResponse
  diagnostics: IdentityNormalizationDiagnostics
}

export interface AzureDocumentIdentityInput {
  name: string
  contentType: string
  bytes: Uint8Array
}

export class AzureDocumentIdentityConfigError extends Error {}
export class AzureDocumentIdentityRequestError extends Error {}

export type OcrDiagnosticPhase =
  | 'request-received'
  | 'validation'
  | 'config'
  | 'azure-analyze'
  | 'azure-poll'
  | 'mapping'
  | 'completed'
  | 'failed'

export interface OcrRequestDiagnostic {
  requestArrivedBackend: boolean
  endpointConfigured: boolean
  keyConfigured: boolean
  azureRequestStarted: boolean
  modelId: string
  apiVersion: string
  azureRequestContentType: string
  azureAnalyzeHttpStatus: number | null
  azurePollHttpStatus: number | null
  azureErrorCode: string | null
  azureErrorMessage: string | null
  azureOperationStatus: string | null
  detectedDocumentType?: IdentityDocumentOcrDocumentType
  azureReturnedFields?: AzureFieldObservation[]
  mappedFields?: ManagedFieldDiagnostic[]
  phase: OcrDiagnosticPhase
}

export class OcrDiagnosticError extends Error {
  diagnostic: OcrRequestDiagnostic

  constructor(message: string, diagnostic: OcrRequestDiagnostic) {
    super(message)
    this.diagnostic = diagnostic
  }
}

function sanitizeDiagnosticMessage(message: string) {
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b\d{5,}\b/g, '[redacted-number]')
    .replace(/\b[a-z0-9]{24,}\b/gi, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .trim()
}

function createBaseDiagnostic(contentType: string): OcrRequestDiagnostic {
  return {
    requestArrivedBackend: true,
    endpointConfigured: false,
    keyConfigured: false,
    azureRequestStarted: false,
    modelId: AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID,
    apiVersion: AZURE_DOCUMENT_INTELLIGENCE_API_VERSION,
    azureRequestContentType: contentType || 'application/octet-stream',
    azureAnalyzeHttpStatus: null,
    azurePollHttpStatus: null,
    azureErrorCode: null,
    azureErrorMessage: null,
    azureOperationStatus: null,
    detectedDocumentType: undefined,
    azureReturnedFields: [],
    mappedFields: [],
    phase: 'request-received',
  }
}

async function readAzureErrorPayload(response: Response) {
  const raw = await response.text()
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string } }
    return {
      code: typeof parsed.error?.code === 'string' ? parsed.error.code : null,
      message: typeof parsed.error?.message === 'string' ? sanitizeDiagnosticMessage(parsed.error.message) : null,
    }
  } catch {
    return {
      code: null,
      message: raw ? sanitizeDiagnosticMessage(raw.slice(0, 400)) : null,
    }
  }
}

export function getAzureDocumentIntelligenceConfig(env: NodeJS.ProcessEnv = process.env) {
  hydrateProcessEnvFromFrontendDotEnv(env)
  const endpoint = String(env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ?? '').trim().replace(/\/+$/, '')
  const key = String(env.AZURE_DOCUMENT_INTELLIGENCE_KEY ?? '').trim()
  if (!endpoint || !key) {
    throw new AzureDocumentIdentityConfigError('Azure Document Intelligence non configurato.')
  }
  return { endpoint, key }
}

function emptyField(confidence: number | null = null): IdentityDocumentOcrField {
  return { value: '', confidence, source: 'azure' }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function isItalianTaxCode(value: string) {
  return /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/i.test(value)
}

function normalizeTaxCode(value: string) {
  const normalized = normalizeWhitespace(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return isItalianTaxCode(normalized) ? normalized : ''
}

function normalizeDate(value: string) {
  const normalized = normalizeWhitespace(value)
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

function addressToText(address?: AzureAddressValue) {
  if (!address) return ''
  return normalizeWhitespace([
    address.streetAddress,
    address.city,
    address.state,
    address.postalCode,
    address.countryRegion,
  ].filter(Boolean).join(' '))
}

function fieldText(field?: AzureDocumentField) {
  if (!field) return ''
  if (typeof field.valueDate === 'string' && field.valueDate.trim()) return normalizeDate(field.valueDate)
  if (typeof field.valueString === 'string' && field.valueString.trim()) return normalizeWhitespace(field.valueString)
  if (typeof field.valueCountryRegion === 'string' && field.valueCountryRegion.trim()) return normalizeWhitespace(field.valueCountryRegion)
  if (field.valueAddress) return addressToText(field.valueAddress)
  if (typeof field.content === 'string' && field.content.trim()) return normalizeWhitespace(field.content)
  return ''
}

function fieldConfidence(field?: AzureDocumentField) {
  return typeof field?.confidence === 'number' ? field.confidence : null
}

const FIELD_CONFIDENCE_POLICY: Record<ManagedIdentityField, FieldConfidencePolicy> = {
  firstName: { minAutofill: 0.5, highConfidence: 0.85 },
  lastName: { minAutofill: 0.5, highConfidence: 0.85 },
  taxCode: { minAutofill: 0.72, highConfidence: 0.9 },
  birthDate: { minAutofill: 0.62, highConfidence: 0.88 },
  birthPlace: { minAutofill: 0.55, highConfidence: 0.83 },
  residence: { minAutofill: 0.55, highConfidence: 0.83 },
  documentNumber: { minAutofill: 0.62, highConfidence: 0.88 },
  issueDate: { minAutofill: 0.62, highConfidence: 0.88 },
  expiryDate: { minAutofill: 0.62, highConfidence: 0.88 },
  issuingAuthority: { minAutofill: 0.55, highConfidence: 0.83 },
}

const STRUCTURED_ALIASES: Record<ManagedIdentityField, string[]> = {
  firstName: ['FirstName', 'GivenName', 'GivenNames', 'FirstNames', 'Name'],
  lastName: ['LastName', 'Surname', 'FamilyName', 'LastNames'],
  taxCode: ['PersonalNumber', 'FiscalCode', 'TaxCode', 'NationalIdentityNumber'],
  birthDate: ['DateOfBirth', 'BirthDate'],
  birthPlace: ['PlaceOfBirth', 'BirthPlace', 'BirthCity'],
  residence: ['Address', 'ResidenceAddress', 'ResidentialAddress', 'StreetAddress'],
  documentNumber: ['DocumentNumber', 'IdNumber', 'IdentityCardNumber', 'LicenseNumber'],
  issueDate: ['DateOfIssue', 'IssueDate'],
  expiryDate: ['DateOfExpiration', 'ExpirationDate', 'ExpiryDate'],
  issuingAuthority: ['IssuingAuthority', 'Authority', 'Issuer', 'IssuedBy'],
}

function regexCandidate(content: string, patterns: RegExp[], confidence: number, sourceProperty: string): RecognizedFieldCandidate | null {
  for (const pattern of patterns) {
    const match = content.match(pattern)
    const value = match?.[1] ? normalizeWhitespace(match[1]) : ''
    if (value) {
      return {
        value,
        confidence,
        sourceProperty,
        sourceType: 'content-fallback',
      }
    }
  }
  return null
}

function documentTypeFromDocType(docType: string, content: string): IdentityDocumentOcrDocumentType {
  const normalizedDocType = docType.toLowerCase()
  const normalizedContent = content.toLowerCase()
  if (normalizedDocType.includes('driver') || /\bpatente\b/.test(normalizedContent)) return 'driving_license'
  if (normalizedDocType.includes('nationalidentity') || /carta d.?identit/.test(normalizedContent)) return 'identity_card'
  return 'unknown'
}

function toApiField(fieldName: ManagedIdentityField, candidate: RecognizedFieldCandidate | null): IdentityDocumentOcrField {
  if (!candidate) return emptyField()
  const normalizedValue = normalizeWhitespace(candidate.value)
  if (!normalizedValue) return emptyField(candidate.confidence)

  const policy = FIELD_CONFIDENCE_POLICY[fieldName]
  if (candidate.confidence !== null && candidate.confidence < policy.minAutofill) {
    return emptyField(candidate.confidence)
  }

  return {
    value: normalizedValue,
    confidence: candidate.confidence,
    source: 'azure',
  }
}

function getAzureFieldObservation(fields: Record<string, AzureDocumentField | undefined>): AzureFieldObservation[] {
  return Object.keys(fields)
    .sort((left, right) => left.localeCompare(right))
    .map((property) => {
      const field = fields[property]
      const value = fieldText(field)
      return {
        property,
        present: field !== undefined,
        nonEmpty: Boolean(value),
        confidence: fieldConfidence(field),
      }
    })
}

function pickStructuredCandidate(
  fields: Record<string, AzureDocumentField | undefined>,
  aliases: string[],
  normalizer?: (value: string) => string,
): RecognizedFieldCandidate | null {
  let best: RecognizedFieldCandidate | null = null

  for (const alias of aliases) {
    const field = fields[alias]
    const rawValue = fieldText(field)
    if (!rawValue) continue
    const normalizedValue = normalizer ? normalizer(rawValue) : rawValue
    if (!normalizedValue) continue

    const next: RecognizedFieldCandidate = {
      value: normalizedValue,
      confidence: fieldConfidence(field),
      sourceProperty: alias,
      sourceType: 'structured',
    }

    if (!best) {
      best = next
      continue
    }

    const bestConfidence = best.confidence ?? -1
    const nextConfidence = next.confidence ?? -1
    if (nextConfidence > bestConfidence) best = next
  }

  return best
}

function diagnosticFromCandidate(fieldName: ManagedIdentityField, candidate: RecognizedFieldCandidate | null): ManagedFieldDiagnostic {
  return {
    managedField: fieldName,
    azurePropertyUsed: candidate?.sourceProperty ?? null,
    present: Boolean(candidate),
    nonEmpty: Boolean(candidate?.value?.trim()),
    confidence: candidate?.confidence ?? null,
    sourceType: candidate?.sourceType ?? 'none',
  }
}

function normalizeAzureIdentityDocumentResultWithDiagnostics(payload: AzureAnalyzeResultPayload): IdentityNormalizationOutcome {
  const content = normalizeWhitespace(payload.analyzeResult?.content ?? '')
  const document = payload.analyzeResult?.documents?.[0]
  const fields = document?.fields ?? {}

  const structuredCandidates: Record<ManagedIdentityField, RecognizedFieldCandidate | null> = {
    firstName: pickStructuredCandidate(fields, STRUCTURED_ALIASES.firstName),
    lastName: pickStructuredCandidate(fields, STRUCTURED_ALIASES.lastName),
    taxCode: pickStructuredCandidate(fields, STRUCTURED_ALIASES.taxCode, normalizeTaxCode),
    birthDate: pickStructuredCandidate(fields, STRUCTURED_ALIASES.birthDate, normalizeDate),
    birthPlace: pickStructuredCandidate(fields, STRUCTURED_ALIASES.birthPlace),
    residence: pickStructuredCandidate(fields, STRUCTURED_ALIASES.residence),
    documentNumber: pickStructuredCandidate(fields, STRUCTURED_ALIASES.documentNumber),
    issueDate: pickStructuredCandidate(fields, STRUCTURED_ALIASES.issueDate, normalizeDate),
    expiryDate: pickStructuredCandidate(fields, STRUCTURED_ALIASES.expiryDate, normalizeDate),
    issuingAuthority: pickStructuredCandidate(fields, STRUCTURED_ALIASES.issuingAuthority),
  }

  const fallbackCandidates: Partial<Record<ManagedIdentityField, RecognizedFieldCandidate | null>> = {
    taxCode: (() => {
      const fromContent = normalizeTaxCode(content.match(/\b([A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z])\b/i)?.[1] ?? '')
      return fromContent
        ? {
          value: fromContent,
          confidence: 0.86,
          sourceProperty: 'analyzeResult.content.taxCodeRegex',
          sourceType: 'content-fallback',
        }
        : null
    })(),
    birthDate: (() => {
      const candidate = regexCandidate(content, [/data di nascita\s*[:-]?\s*([0-9./-]{6,10})/i, /nato il\s*[:-]?\s*([0-9./-]{6,10})/i], 0.76, 'analyzeResult.content.birthDateRegex')
      if (!candidate) return null
      const normalized = normalizeDate(candidate.value)
      return normalized ? { ...candidate, value: normalized } : null
    })(),
    birthPlace: regexCandidate(content, [/luogo di nascita\s*[:-]?\s*([^\n]+)/i, /nato a\s*[:-]?\s*([^\n]+)/i], 0.72, 'analyzeResult.content.birthPlaceRegex'),
    residence: regexCandidate(content, [/residenza\s*[:-]?\s*([^\n]+)/i, /indirizzo\s*[:-]?\s*([^\n]+)/i], 0.72, 'analyzeResult.content.residenceRegex'),
    documentNumber: regexCandidate(content, [/numero documento\s*[:-]?\s*([A-Z0-9-]+)/i, /documento n\.?\s*[:-]?\s*([A-Z0-9-]+)/i, /c\.i\.\s*n\.?\s*[:-]?\s*([A-Z0-9-]+)/i], 0.78, 'analyzeResult.content.documentNumberRegex'),
    issueDate: (() => {
      const candidate = regexCandidate(content, [/data di rilascio\s*[:-]?\s*([0-9./-]{6,10})/i, /rilasciata il\s*[:-]?\s*([0-9./-]{6,10})/i], 0.76, 'analyzeResult.content.issueDateRegex')
      if (!candidate) return null
      const normalized = normalizeDate(candidate.value)
      return normalized ? { ...candidate, value: normalized } : null
    })(),
    expiryDate: (() => {
      const candidate = regexCandidate(content, [/data di scadenza\s*[:-]?\s*([0-9./-]{6,10})/i, /scade il\s*[:-]?\s*([0-9./-]{6,10})/i], 0.76, 'analyzeResult.content.expiryDateRegex')
      if (!candidate) return null
      const normalized = normalizeDate(candidate.value)
      return normalized ? { ...candidate, value: normalized } : null
    })(),
    issuingAuthority: regexCandidate(content, [/ente rilasciante\s*[:-]?\s*([^\n]+)/i, /autorit[aà]\s*[:-]?\s*([^\n]+)/i, /rilasciata da\s*[:-]?\s*([^\n]+)/i], 0.72, 'analyzeResult.content.issuingAuthorityRegex'),
  }

  const finalCandidates: Record<ManagedIdentityField, RecognizedFieldCandidate | null> = {
    firstName: structuredCandidates.firstName,
    lastName: structuredCandidates.lastName,
    taxCode: structuredCandidates.taxCode ?? fallbackCandidates.taxCode ?? null,
    birthDate: structuredCandidates.birthDate ?? fallbackCandidates.birthDate ?? null,
    birthPlace: structuredCandidates.birthPlace ?? fallbackCandidates.birthPlace ?? null,
    residence: structuredCandidates.residence ?? fallbackCandidates.residence ?? null,
    documentNumber: structuredCandidates.documentNumber ?? fallbackCandidates.documentNumber ?? null,
    issueDate: structuredCandidates.issueDate ?? fallbackCandidates.issueDate ?? null,
    expiryDate: structuredCandidates.expiryDate ?? fallbackCandidates.expiryDate ?? null,
    issuingAuthority: structuredCandidates.issuingAuthority ?? fallbackCandidates.issuingAuthority ?? null,
  }

  const normalized = {
    firstName: toApiField('firstName', finalCandidates.firstName),
    lastName: toApiField('lastName', finalCandidates.lastName),
    taxCode: toApiField('taxCode', finalCandidates.taxCode),
    birthDate: toApiField('birthDate', finalCandidates.birthDate),
    birthPlace: toApiField('birthPlace', finalCandidates.birthPlace),
    residence: toApiField('residence', finalCandidates.residence),
    documentNumber: toApiField('documentNumber', finalCandidates.documentNumber),
    issueDate: toApiField('issueDate', finalCandidates.issueDate),
    expiryDate: toApiField('expiryDate', finalCandidates.expiryDate),
    issuingAuthority: toApiField('issuingAuthority', finalCandidates.issuingAuthority),
  }

  const warnings = Object.entries(normalized)
    .filter(([, field]) => !field.value)
    .map(([field]) => `Campo da verificare: ${field}`)

  const detectedDocumentType = documentTypeFromDocType(document?.docType ?? '', content)

  const mappedFields: ManagedFieldDiagnostic[] = (Object.keys(finalCandidates) as ManagedIdentityField[])
    .map((fieldName) => diagnosticFromCandidate(fieldName, finalCandidates[fieldName]))

  return {
    response: {
      success: true,
      documentType: detectedDocumentType,
      fields: normalized,
      warnings,
    },
    diagnostics: {
      detectedDocumentType,
      azureReturnedFields: getAzureFieldObservation(fields),
      mappedFields,
    },
  }
}

export function normalizeAzureIdentityDocumentResult(payload: AzureAnalyzeResultPayload): IdentityDocumentOcrResponse {
  return normalizeAzureIdentityDocumentResultWithDiagnostics(payload).response
}

async function pollAnalyzeResult(
  operationLocation: string,
  key: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  diagnostic: OcrRequestDiagnostic,
) {
  diagnostic.phase = 'azure-poll'
  for (let attempt = 0; attempt < DEFAULT_MAX_POLL_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(operationLocation, {
      headers: {
        'Ocp-Apim-Subscription-Key': key,
      },
    })
    diagnostic.azurePollHttpStatus = response.status
    if (!response.ok) {
      const azureError = await readAzureErrorPayload(response)
      diagnostic.azureErrorCode = azureError.code
      diagnostic.azureErrorMessage = azureError.message
      diagnostic.phase = 'failed'
      throw new OcrDiagnosticError('Polling Azure non riuscito.', diagnostic)
    }
    const payload = await response.json() as AzureAnalyzeResultPayload
    const status = String(payload.status ?? '').toLowerCase()
    diagnostic.azureOperationStatus = status || null
    if (status === 'succeeded') return payload
    if (status === 'failed' || status === 'error') {
      diagnostic.azureErrorCode = payload.error?.code ?? null
      diagnostic.azureErrorMessage = payload.error?.message ? sanitizeDiagnosticMessage(payload.error.message) : null
      diagnostic.phase = 'failed'
      throw new OcrDiagnosticError('Azure non ha letto il documento.', diagnostic)
    }
    await sleep(DEFAULT_POLL_INTERVAL_MS)
  }
  diagnostic.phase = 'failed'
  throw new OcrDiagnosticError('Timeout lettura documento Azure.', diagnostic)
}

export async function analyzeIdentityDocumentWithAzure(
  input: AzureDocumentIdentityInput,
  options: {
    env?: NodeJS.ProcessEnv
    fetchImpl?: typeof fetch
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<{ result: IdentityDocumentOcrResponse; diagnostic: OcrRequestDiagnostic }> {
  const diagnostic = createBaseDiagnostic(input.contentType)
  diagnostic.phase = 'config'

  hydrateProcessEnvFromFrontendDotEnv(options.env ?? process.env)
  const env = options.env ?? process.env
  diagnostic.endpointConfigured = Boolean(String(env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ?? '').trim())
  diagnostic.keyConfigured = Boolean(String(env.AZURE_DOCUMENT_INTELLIGENCE_KEY ?? '').trim())

  let endpoint = ''
  let key = ''
  try {
    const config = getAzureDocumentIntelligenceConfig(env)
    endpoint = config.endpoint
    key = config.key
  } catch (error) {
    diagnostic.phase = 'failed'
    if (error instanceof AzureDocumentIdentityConfigError) {
      throw new OcrDiagnosticError(error.message, diagnostic)
    }
    throw error
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID}:analyze?_overload=analyzeDocument&api-version=${AZURE_DOCUMENT_INTELLIGENCE_API_VERSION}`
  const analyzePayload = JSON.stringify({
    base64Source: Buffer.from(input.bytes).toString('base64'),
  })
  diagnostic.phase = 'azure-analyze'
  diagnostic.azureRequestStarted = true
  diagnostic.azureRequestContentType = 'application/json'

  const analyzeResponse = await fetchImpl(analyzeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': key,
    },
    body: analyzePayload,
  })
  diagnostic.azureAnalyzeHttpStatus = analyzeResponse.status

  if (!analyzeResponse.ok) {
    const azureError = await readAzureErrorPayload(analyzeResponse)
    diagnostic.azureErrorCode = azureError.code
    diagnostic.azureErrorMessage = azureError.message
    diagnostic.phase = 'failed'
    throw new OcrDiagnosticError('Invio documento ad Azure non riuscito.', diagnostic)
  }

  const operationLocation = analyzeResponse.headers.get('operation-location')
  if (!operationLocation) {
    diagnostic.phase = 'failed'
    throw new OcrDiagnosticError('Azure non ha restituito l\'operazione OCR.', diagnostic)
  }

  const payload = await pollAnalyzeResult(operationLocation, key, fetchImpl, sleep, diagnostic)

  diagnostic.phase = 'mapping'
  const outcome = normalizeAzureIdentityDocumentResultWithDiagnostics(payload)
  diagnostic.detectedDocumentType = outcome.diagnostics.detectedDocumentType
  diagnostic.azureReturnedFields = outcome.diagnostics.azureReturnedFields
  diagnostic.mappedFields = outcome.diagnostics.mappedFields
  diagnostic.phase = 'completed'
  return { result: outcome.response, diagnostic }
}