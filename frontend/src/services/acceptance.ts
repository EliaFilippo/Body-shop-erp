import type {
  AcceptanceCase,
  AcceptanceChecklistItem,
  AcceptanceIntakeData,
  AcceptanceLine,
  AcceptancePhotoEntry,
  AcceptanceQuote,
  CustomerDocumentDraft,
  PlannerSettings,
  VehicleBookletDraft,
} from '../types'

const round = (value: number) => Math.round(value * 100) / 100
const currency = (value: number) => Math.round(value * 100) / 100

export interface MonthlyRateResult {
  rate: number
  productiveHours: number
  monthKey: string
}

export interface QuoteSummary {
  labor: { total: number; lines: number }
  parts: { total: number; lines: number }
  materials: { total: number; lines: number }
  external: { total: number; lines: number }
  other: { total: number; lines: number }
  discount: { total: number; lines: number }
  surcharge: { total: number; lines: number }
  taxableAmount: number
  vatAmount: number
  total: number
  costLive: number
  marginEuro: number
  marginPercent: number
  netTotal: number
}

const lineTotals = (quote: AcceptanceQuote, kind: AcceptanceLine['kind']) =>
  quote.lines.filter((line) => line.kind === kind).reduce((sum, line) => sum + (kind === 'consumption' ? line.unitPrice : line.quantity * line.unitPrice), 0)

const laborLines = (quote: AcceptanceQuote) => quote.lines.filter((line) => line.kind === 'labor')
const materialLines = (quote: AcceptanceQuote) => quote.lines.filter((line) => line.kind === 'consumption')

export function calculateMonthlyHourlyRate(
  settings: PlannerSettings,
  monthKey: string,
  referenceDate = `${monthKey}-01`,
): MonthlyRateResult {
  const workingDays = settings.workingDays.length || 1
  const activeOperators = settings.operators.filter((operator) => operator.active)
  const operatorCount = Math.max(1, activeOperators.length)
  const dailyHoursPerOperator = activeOperators.length
    ? Math.max(0, activeOperators[0].dailyHours)
    : 8
  const efficiency = Math.max(0, Math.min(100, settings.efficiencyPercent)) / 100
  const productiveHours = Math.max(1, workingDays * operatorCount * dailyHoursPerOperator * efficiency)
  const rate = Math.max(0, settings.monthlyRevenueGoal / productiveHours)
  return { rate: round(rate), productiveHours: round(productiveHours), monthKey: referenceDate.slice(0, 7) }
}

export function createDefaultQuote(settings: PlannerSettings, monthKey: string, laborHours = 0): AcceptanceQuote {
  const rateInfo = calculateMonthlyHourlyRate(settings, monthKey)
  const laborCost = laborHours * rateInfo.rate
  const materialValue = round(laborCost * 0.2)
  const lines: AcceptanceLine[] = [
    { id: crypto.randomUUID(), kind: 'labor', description: 'Manodopera', quantity: laborHours, unitCost: rateInfo.rate, unitPrice: rateInfo.rate, source: 'auto' },
    { id: crypto.randomUUID(), kind: 'consumption', description: 'Materiale di consumo', quantity: 1, unitCost: materialValue, unitPrice: materialValue, source: 'auto' },
  ]
  return {
    id: crypto.randomUUID(),
    monthKey,
    hourlyRate: rateInfo.rate,
    productiveHours: rateInfo.productiveHours,
    monthlyEconomicGoal: settings.monthlyRevenueGoal,
    appliedVatRate: 22,
    materialPercent: 20,
    lines,
  }
}

export function buildAcceptanceQuoteSummary(quote: AcceptanceQuote): QuoteSummary {
  const laborTotal = round(laborLines(quote).reduce((sum, line) => sum + line.quantity * line.unitPrice, 0))
  const partsTotal = round(lineTotals(quote, 'parts'))
  const materialsTotal = round(lineTotals(quote, 'consumption'))
  const externalTotal = round(lineTotals(quote, 'external'))
  const otherTotal = round(lineTotals(quote, 'other'))
  const discountTotal = round(lineTotals(quote, 'discount'))
  const surchargeTotal = round(lineTotals(quote, 'surcharge'))
  const taxableAmount = round(laborTotal + partsTotal + materialsTotal + externalTotal + otherTotal + surchargeTotal - discountTotal)
  const vatAmount = round(taxableAmount * quote.appliedVatRate / 100)
  const total = round(taxableAmount + vatAmount)
  const costLive = round(laborTotal + partsTotal + materialsTotal + externalTotal + otherTotal)
  const marginEuro = round(total - costLive)
  const marginPercent = total ? round((marginEuro / total) * 100) : 0
  return {
    labor: { total: laborTotal, lines: laborLines(quote).length },
    parts: { total: partsTotal, lines: quote.lines.filter((line) => line.kind === 'parts').length },
    materials: { total: materialsTotal, lines: materialLines(quote).length },
    external: { total: externalTotal, lines: quote.lines.filter((line) => line.kind === 'external').length },
    other: { total: otherTotal, lines: quote.lines.filter((line) => line.kind === 'other').length },
    discount: { total: discountTotal, lines: quote.lines.filter((line) => line.kind === 'discount').length },
    surcharge: { total: surchargeTotal, lines: quote.lines.filter((line) => line.kind === 'surcharge').length },
    taxableAmount,
    vatAmount,
    total,
    costLive,
    marginEuro,
    marginPercent,
    netTotal: total,
  }
}

export function updateConsumptionLine(quote: AcceptanceQuote, factor: number) {
  const labor = quote.lines.find((line) => line.kind === 'labor')
  const current = quote.lines.find((line) => line.kind === 'consumption')
  const laborAmount = labor ? labor.quantity * labor.unitPrice : 0
  const nextValue = round(laborAmount * factor)
  if (!current) return quote
  const nextLines = quote.lines.map((line) => line.kind === 'consumption' ? { ...line, unitPrice: nextValue, unitCost: nextValue, quantity: 1 } : line)
  return { ...quote, lines: nextLines, materialPercent: Math.round(factor * 100) }
}

export function createEmptyDocumentDraft(): CustomerDocumentDraft[] {
  return [
    {
      id: crypto.randomUUID(),
      side: 'front',
      name: 'Documento fronte',
      dataUrl: '',
      fields: {
        name: { value: '', confidence: 'low', source: 'manual' },
        surname: { value: '', confidence: 'low', source: 'manual' },
        taxId: { value: '', confidence: 'low', source: 'manual' },
        birthDate: { value: '', confidence: 'low', source: 'manual' },
        birthPlace: { value: '', confidence: 'low', source: 'manual' },
        residence: { value: '', confidence: 'low', source: 'manual' },
        documentNumber: { value: '', confidence: 'low', source: 'manual' },
        issueDate: { value: '', confidence: 'low', source: 'manual' },
        expiryDate: { value: '', confidence: 'low', source: 'manual' },
        issuingAuthority: { value: '', confidence: 'low', source: 'manual' },
      },
    },
  ]
}

export function createEmptyBookletDraft(): VehicleBookletDraft[] {
  return [
    {
      id: crypto.randomUUID(),
      name: 'Libretto',
      dataUrl: '',
      fields: {
        plate: { value: '', confidence: 'low', source: 'manual' },
        vin: { value: '', confidence: 'low', source: 'manual' },
        make: { value: '', confidence: 'low', source: 'manual' },
        model: { value: '', confidence: 'low', source: 'manual' },
        firstRegistration: { value: '', confidence: 'low', source: 'manual' },
        fuel: { value: '', confidence: 'low', source: 'manual' },
        engineDisplacement: { value: '', confidence: 'low', source: 'manual' },
        power: { value: '', confidence: 'low', source: 'manual' },
        owner: { value: '', confidence: 'low', source: 'manual' },
      },
    },
  ]
}

function createChecklist(): AcceptanceChecklistItem[] {
  return [
    { id: crypto.randomUUID(), label: 'Danni registrati', checked: false },
    { id: crypto.randomUUID(), label: 'Accessori verificati', checked: false },
    { id: crypto.randomUUID(), label: 'Foto caricate', checked: false },
    { id: crypto.randomUUID(), label: 'Firma cliente acquisita', checked: false },
  ]
}

export function createAcceptanceDraft(
  customerId: string,
  vehicleId: string,
  settings: PlannerSettings,
  monthKey: string,
): AcceptanceCase {
  const quote = createDefaultQuote(settings, monthKey, 8)
  const intake: AcceptanceIntakeData = {
    mileage: '',
    fuelLevel: '',
    occurredAt: new Date().toISOString(),
    operator: '',
    damageDescription: '',
    accessories: [],
    customerNotes: '',
    checklist: createChecklist(),
    signatureDataUrl: '',
  }
  return {
    id: crypto.randomUUID(),
    customerId,
    vehicleId,
    customerDraft: createEmptyDocumentDraft(),
    vehicleBooklet: createEmptyBookletDraft(),
    damagePhotos: [],
    quote,
    signatureDataUrl: '',
    intake,
    photos: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'draft',
  }
}

export function createPhotoArchiveEntry(
  acceptanceId: string,
  vehicleId: string,
  category: AcceptancePhotoEntry['category'],
  name: string,
  dataUrl: string,
  caption = '',
): AcceptancePhotoEntry {
  return {
    id: crypto.randomUUID(),
    acceptanceId,
    vehicleId,
    category,
    name,
    dataUrl,
    caption,
    createdAt: new Date().toISOString(),
  }
}

export function toggleAcceptanceChecklistItem(acceptance: AcceptanceCase, itemId: string): AcceptanceCase {
  const intake = acceptance.intake
  if (!intake) return acceptance
  return {
    ...acceptance,
    intake: {
      ...intake,
      checklist: intake.checklist.map((item) => item.id === itemId ? { ...item, checked: !item.checked } : item),
    },
    updatedAt: new Date().toISOString(),
  }
}

export function appendAcceptancePhotoEntry(acceptance: AcceptanceCase, photo: AcceptancePhotoEntry): AcceptanceCase {
  const nextPhotos = [...(acceptance.photos ?? []), photo]
  return {
    ...acceptance,
    photos: nextPhotos,
    damagePhotos: [...new Set([...(acceptance.damagePhotos ?? []), photo.dataUrl])],
    updatedAt: new Date().toISOString(),
  }
}

export function exportAcceptancePdf(caseItem: AcceptanceCase): string {
  const summary = buildAcceptanceQuoteSummary(caseItem.quote)
  return [
    `Accettazione pratica ${caseItem.id}`,
    `Cliente: ${caseItem.customerId}`,
    `Vettura: ${caseItem.vehicleId}`,
    `Totale: € ${currency(summary.total).toFixed(2)}`,
    `Imponibile: € ${currency(summary.taxableAmount).toFixed(2)}`,
    `IVA: € ${currency(summary.vatAmount).toFixed(2)}`,
    `Costi vivi: € ${currency(summary.costLive).toFixed(2)}`,
    `Margine: € ${currency(summary.marginEuro).toFixed(2)} (${summary.marginPercent}%)`,
  ].join('\n')
}
