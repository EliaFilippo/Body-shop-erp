import type {
	ErpData,
	EstimateDocument,
	EstimateLine,
	EstimateStatus,
	InternalMonthlyCostCategory,
	PlannerSettings,
	ProductionJobState,
	ProductionPhase,
	JobPhase,
	JobPhaseOperatorAssignment,
	JobPhaseStatus,
	JobStatus,
	JobPhaseTimeAdjustment,
	QualityChecklistItem,
	RepairJob,
	Vehicle,
	StandardWorkDefinition,
	StandardWorkRule,
	StandardWorkPriceListItem,
	StandardWorkTimePreset,
} from '../types'
import { addVehicle, changeVehicleStatus, reconcileVehicleCones } from './erp'
import { suggestVehicleStatus } from './vehicleStatuses'

const id = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const today = () => new Date().toISOString().slice(0, 10)
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export const WORK_CATEGORIES = ['carrozzeria', 'verniciatura', 'ricambi', 'materiali', 'meccanica', 'servizi esterni', 'altre'] as const
export const JOB_PHASE_TEMPLATE = ['Smontaggio', 'Lattoneria', 'Preparazione', 'Verniciatura', 'Rimontaggio', 'Lucidatura', 'Lavaggio', 'Controllo qualità'] as const

const allowedEstimateStatusTransitions: Record<EstimateStatus, EstimateStatus[]> = {
	Bozza: ['Inviato', 'Rifiutato', 'Scaduto', 'Approvato', 'In attesa conferma'],
	Inviato: ['In attesa conferma', 'Approvato', 'Rifiutato', 'Scaduto'],
	'In attesa conferma': ['Approvato', 'Rifiutato', 'Scaduto'],
	Approvato: ['Scaduto'],
	Rifiutato: [],
	Scaduto: [],
}

const allowedJobTransitions: Record<JobStatus, JobStatus[]> = {
	'Da pianificare': ['Pianificata', 'Annullata'],
	Pianificata: ['In lavorazione', 'In attesa', 'Annullata'],
	'In lavorazione': ['In attesa', 'Controllo qualità', 'Pronta consegna', 'Annullata'],
	'In attesa': ['In lavorazione', 'Annullata'],
	'Controllo qualità': ['Pronta consegna', 'In lavorazione', 'Annullata'],
	'Pronta consegna': ['Consegnata', 'In lavorazione', 'Annullata'],
	Consegnata: [],
	Annullata: [],
}

function normalizeWorkName(value: string) {
	return value.trim().toLowerCase()
}

function phaseForWorkName(name: string) {
	const normalized = normalizeWorkName(name)
	if (!normalized) return ''
	if (normalized === 'smontaggio') return 'Smontaggio'
	if (normalized === 'rimontaggio') return 'Rimontaggio'
	if (normalized === 'incartatura') return 'Preparazione'
	if (normalized === 'scartatura') return 'Preparazione'
	if (normalized === 'lavaggio') return 'Lavaggio'
	if (normalized === 'lattoneria') return 'Lattoneria'
	if (normalized === 'preparazione') return 'Preparazione'
	if (normalized === 'verniciatura') return 'Verniciatura'
	if (normalized === 'verniciatura standard') return 'Verniciatura'
	if (normalized === 'verniciatura perlato') return 'Verniciatura'
	if (normalized === 'lucidatura') return 'Lucidatura'
	if (normalized === 'controllo qualità' || normalized === 'controllo qualita') return 'Controllo qualità'
	return ''
}

function resolvedPhaseName(line: EstimateLine) {
	const configured = String(line.categoryOrPhase ?? '').trim()
	if (configured) return configured
	return phaseForWorkName(line.standardWorkName || line.description)
}

function findStandardWork(standardWorks: StandardWorkDefinition[], value: string) {
	const normalized = normalizeWorkName(value)
	if (!normalized) return null
	return standardWorks.find((item) => item.id === value || normalizeWorkName(item.name) === normalized) ?? null
}

function normalizeText(value?: string) {
	return String(value ?? '').trim().toLowerCase()
}

function normalizeFreeTextToken(value?: string) {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[_/\\-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function normalizeLookupToken(value?: string) {
	return normalizeFreeTextToken(value).replace(/[^a-z0-9]/g, '')
}

function normalizeRepairExtent(value?: string): '' | 'intero' | 'mezzo' {
	const normalized = normalizeLookupToken(value)
	if (!normalized || normalized === 'tutti' || normalized === 'tutto' || normalized === 'all' || normalized === 'any') return ''
	if (normalized === 'mezzo' || normalized === 'meta') return 'mezzo'
	if (normalized === 'intero' || normalized === 'intera' || normalized === 'completo' || normalized === 'completa') return 'intero'
	return ''
}

function normalizeVariant(value?: string) {
	return normalizeLookupToken(value)
}

function canonicalWorkName(value?: string) {
	const normalized = normalizeText(value)
	if (!normalized) return ''
	const phase = normalizeText(phaseForWorkName(normalized))
	return phase || normalized
}

function canonicalPanelName(value?: string) {
	return normalizeLookupToken(value)
}

const INTERNAL_COST_DEFAULT_LABELS: Record<InternalMonthlyCostCategory, string> = {
	personale: 'Personale',
	affitto: 'Affitto',
	'noleggi-leasing': 'Noleggi / Leasing',
	energia: 'Energia',
	assicurazioni: 'Assicurazioni',
	software: 'Software',
	'consulenze-amministrazione': 'Consulenze / amministrazione',
	utenze: 'Utenze',
	'altri-costi-fissi': 'Altri costi fissi',
	'altri-costi-generali': 'Altri costi generali',
}

export function defaultInternalMonthlyCostItems() {
	return (Object.keys(INTERNAL_COST_DEFAULT_LABELS) as InternalMonthlyCostCategory[]).map((category) => ({
		id: id(),
		category,
		description: INTERNAL_COST_DEFAULT_LABELS[category],
		monthlyAmount: 0,
		active: true,
	}))
}

export function calculateInternalCostMonthlyTotals(plannerSettings: PlannerSettings) {
	const items = plannerSettings.internalCostSettings?.monthlyCostItems ?? defaultInternalMonthlyCostItems()
	const consideredMonthlyCosts = round(items.reduce((sum, item) => {
		if (!item.active) return sum
		return sum + Math.max(0, Number(item.monthlyAmount ?? 0))
	}, 0))
	return { consideredMonthlyCosts, items }
}

export function calculateInternalProductiveCapacity(plannerSettings: PlannerSettings) {
	const capacity = plannerSettings.internalCostSettings?.productiveCapacity
	const productiveOperators = Math.max(0, Number(capacity?.productiveOperators ?? 0))
	const hoursPerOperatorPerDay = Math.max(0, Number(capacity?.hoursPerOperatorPerDay ?? 0))
	const workingDaysPerMonth = Math.max(0, Number(capacity?.workingDaysPerMonth ?? 0))
	const efficiencyPercent = Math.max(0, Number(capacity?.efficiencyPercent ?? plannerSettings.efficiencyPercent ?? 0))
	const theoreticalHours = productiveOperators * hoursPerOperatorPerDay * workingDaysPerMonth
	const productiveHours = theoreticalHours * (efficiencyPercent / 100)
	return {
		productiveOperators,
		hoursPerOperatorPerDay,
		workingDaysPerMonth,
		efficiencyPercent,
		theoreticalHours: round(theoreticalHours),
		productiveHours: round(productiveHours),
	}
}

export function resolveInternalHourlyRate(plannerSettings: PlannerSettings) {
	const monthly = calculateInternalCostMonthlyTotals(plannerSettings)
	const capacity = calculateInternalProductiveCapacity(plannerSettings)
	const manualEnabled = Boolean(plannerSettings.internalCostSettings?.useManualHourlyRate)
	const manualHourlyRate = Math.max(0, Number(plannerSettings.internalCostSettings?.manualHourlyRate ?? 0))
	const storedLegacyRate = Math.max(0, Number(plannerSettings.internalCostSettings?.internalHourlyRate ?? 0))
	const hasAutomaticInputs = Boolean(plannerSettings.internalCostSettings?.monthlyCostItems?.length)
		|| capacity.productiveOperators > 0
		|| capacity.hoursPerOperatorPerDay > 0
		|| capacity.workingDaysPerMonth > 0
	const automaticHourlyRate = capacity.productiveHours > 0
		? round(monthly.consideredMonthlyCosts / capacity.productiveHours)
		: (hasAutomaticInputs ? 0 : storedLegacyRate)
	const effectiveHourlyRate = manualEnabled ? manualHourlyRate : automaticHourlyRate
	return {
		...monthly,
		...capacity,
		manualEnabled,
		manualHourlyRate,
		automaticHourlyRate,
		effectiveHourlyRate,
	}
}

function resolveTimePresetMinutes(
	timePresets: StandardWorkTimePreset[],
	line: Partial<EstimateLine>,
): number | null {
	const lineWorkId = String(line.standardWorkId ?? '').trim()
	const lineWork = canonicalWorkName(line.standardWorkName || line.description)
	const linePanel = canonicalPanelName(line.panelName || line.panelId)
	const lineVariant = normalizeVariant(line.paintCycle)
	const candidates = timePresets
		.filter((preset) => preset.active)
		.filter((preset) => {
			const presetWorkId = String(preset.workId ?? '').trim()
			if (presetWorkId) {
				if (!lineWorkId || lineWorkId !== presetWorkId) return false
			} else {
				const presetWork = canonicalWorkName(preset.workName)
				if (!presetWork || !lineWork || presetWork !== lineWork) return false
			}
			const presetPanel = canonicalPanelName(preset.panelName)
			if (!presetPanel || !linePanel || presetPanel !== linePanel) return false
			const presetVariant = normalizeVariant(preset.variantCycle)
			if (!presetVariant) return true
			return presetVariant === lineVariant
		})
		.sort((a, b) => {
			const aVariant = normalizeVariant(a.variantCycle)
			const bVariant = normalizeVariant(b.variantCycle)
			if (aVariant && !bVariant) return -1
			if (!aVariant && bVariant) return 1
			return 0
		})
	const selected = candidates[0]
	if (!selected) return null
	return Math.max(1, Number(selected.minutes ?? 1))
}

export function computeLineInternalEconomics(line: Partial<EstimateLine>, plannerSettings: PlannerSettings) {
	const resolvedRate = resolveInternalHourlyRate(plannerSettings)
	const internalHourlyRate = Math.max(0, Number(resolvedRate.effectiveHourlyRate ?? plannerSettings.internalCostSettings?.internalHourlyRate ?? 0))
	const minimumMarginPercent = Math.max(0, Number(plannerSettings.internalCostSettings?.minimumMarginPercent ?? 0))
	const lineMinutes = Math.max(0, Number(line.lineTotalMinutes ?? line.estimatedMinutes ?? line.standardMinutes ?? 0))
	const appliedPrice = Math.max(0, Number(line.unitPrice ?? 0))
	const internalCostAmount = round((lineMinutes / 60) * internalHourlyRate)
	const breakEvenPrice = internalCostAmount
	const theoreticalMarginAmount = round(appliedPrice - internalCostAmount)
	const theoreticalMarginPercent = appliedPrice > 0 ? round((theoreticalMarginAmount / appliedPrice) * 100) : 0
	const denominator = 1 - (minimumMarginPercent / 100)
	const minimumSuggestedPrice = denominator > 0 ? round(internalCostAmount / denominator) : round(internalCostAmount)
	const marginStatus: 'ok' | 'low' | 'loss' | 'zero-price' = appliedPrice <= 0
		? 'zero-price'
		: appliedPrice < internalCostAmount
			? 'loss'
			: theoreticalMarginPercent < minimumMarginPercent
				? 'low'
				: 'ok'
	return {
		internalHourlyRateUsed: internalHourlyRate,
		productiveEfficiencyUsed: resolvedRate.efficiencyPercent,
		internalCostAmount,
		breakEvenPrice,
		theoreticalMarginAmount,
		theoreticalMarginPercent,
		marginStatus,
		minimumMarginPercentUsed: minimumMarginPercent,
		minimumSuggestedPrice,
	}
}

type PriceListCandidateDebug = {
	itemId: string
	panelName: string
	workName: string
	repairExtent: string
	variantCycle: string
	active: boolean
	accepted: boolean
	score: number
	reasons: string[]
}

function evaluatePriceListCandidate(item: StandardWorkPriceListItem, line: Partial<EstimateLine>) {
	const reasons: string[] = []
	const lineWorkId = String(line.standardWorkId ?? '').trim()
	const itemWorkId = String(item.workId ?? '').trim()
	const lineWork = canonicalWorkName(line.standardWorkName || line.description)
	const itemWork = canonicalWorkName(item.workName)
	if (!item.active) reasons.push('voce inattiva')
	if (itemWorkId) {
		if (!lineWorkId) reasons.push('workId riga assente')
		else if (itemWorkId !== lineWorkId) reasons.push(`workId diverso (${itemWorkId} != ${lineWorkId})`)
	} else {
		if (!lineWork) reasons.push('lavorazione riga assente')
		if (!itemWork) reasons.push('lavorazione listino assente')
		if (lineWork && itemWork && itemWork !== lineWork) reasons.push(`lavorazione diversa (${itemWork} != ${lineWork})`)
	}

	const itemPanelToken = normalizeLookupToken(item.panelName)
	const linePanelNameToken = normalizeLookupToken(line.panelName)
	const linePanelIdToken = normalizeLookupToken(line.panelId)
	let panelScore = 0
	if (itemPanelToken) {
		if (!linePanelNameToken && !linePanelIdToken) {
			reasons.push('pannello riga assente')
		} else if (itemPanelToken === linePanelNameToken || itemPanelToken === linePanelIdToken) {
			panelScore = 3
		} else if ((linePanelNameToken && (linePanelNameToken.includes(itemPanelToken) || itemPanelToken.includes(linePanelNameToken))) || (linePanelIdToken && (linePanelIdToken.includes(itemPanelToken) || itemPanelToken.includes(linePanelIdToken)))) {
			panelScore = 2
		} else {
			reasons.push(`pannello diverso (${itemPanelToken} != ${linePanelNameToken || linePanelIdToken || '-'})`)
		}
	}

	const itemExtent = normalizeRepairExtent(item.repairExtent)
	const lineExtent = normalizeRepairExtent(line.repairExtent)
	let extentScore = 0
	if (itemExtent) {
		if (!lineExtent) {
			reasons.push(`estensione riga assente (attesa ${itemExtent})`)
		} else if (itemExtent !== lineExtent) {
			reasons.push(`estensione diversa (${itemExtent} != ${lineExtent})`)
		} else {
			extentScore = 3
		}
	}

	const itemVariant = normalizeVariant(item.variantCycle)
	const lineVariant = normalizeVariant(line.paintCycle)
	const lineVariantFallback = normalizeVariant(line.repairExtent)
	let variantScore = 0
	if (itemVariant) {
		if (!lineVariant && !lineVariantFallback) {
			reasons.push(`variante riga assente (attesa ${itemVariant})`)
		} else if (itemVariant !== lineVariant && itemVariant !== lineVariantFallback) {
			reasons.push(`variante diversa (${itemVariant} != ${lineVariant || lineVariantFallback})`)
		} else {
			variantScore = 2
		}
	}

	const accepted = reasons.length === 0
	const score = panelScore + extentScore + variantScore
	const debug: PriceListCandidateDebug = {
		itemId: String(item.id ?? ''),
		panelName: String(item.panelName ?? ''),
		workName: String(item.workName ?? ''),
		repairExtent: String(item.repairExtent ?? ''),
		variantCycle: String(item.variantCycle ?? ''),
		active: Boolean(item.active),
		accepted,
		score,
		reasons,
	}
	return { item, accepted, score, reasons, debug }
}

function matchesPriceListBaseContext(item: StandardWorkPriceListItem, line: Partial<EstimateLine>) {
	if (!item.active) return false
	const lineWorkId = String(line.standardWorkId ?? '').trim()
	const itemWorkId = String(item.workId ?? '').trim()
	const lineWork = canonicalWorkName(line.standardWorkName || line.description)
	const itemWork = canonicalWorkName(item.workName)
	if (itemWorkId) {
		if (!lineWorkId || lineWorkId !== itemWorkId) return false
	} else if (!lineWork || !itemWork || lineWork !== itemWork) {
		return false
	}

	const itemPanelToken = normalizeLookupToken(item.panelName)
	if (itemPanelToken) {
		const linePanelNameToken = normalizeLookupToken(line.panelName)
		const linePanelIdToken = normalizeLookupToken(line.panelId)
		const panelMatch = itemPanelToken === linePanelNameToken
			|| itemPanelToken === linePanelIdToken
			|| (linePanelNameToken && (linePanelNameToken.includes(itemPanelToken) || itemPanelToken.includes(linePanelNameToken)))
			|| (linePanelIdToken && (linePanelIdToken.includes(itemPanelToken) || itemPanelToken.includes(linePanelIdToken)))
		if (!panelMatch) return false
	}

	const itemExtent = normalizeRepairExtent(item.repairExtent)
	const lineExtent = normalizeRepairExtent(line.repairExtent)
	if (itemExtent && itemExtent !== lineExtent) return false
	return true
}

export function resolvePriceListVariants(priceList: StandardWorkPriceListItem[], line: Partial<EstimateLine>) {
	const variants = priceList
		.filter((item) => matchesPriceListBaseContext(item, line))
		.map((item) => String(item.variantCycle ?? '').trim())
		.filter(Boolean)
	return Array.from(new Set(variants.map((value) => normalizeFreeTextToken(value))))
		.map((normalized) => variants.find((value) => normalizeFreeTextToken(value) === normalized) ?? normalized)
		.sort((a, b) => a.localeCompare(b, 'it-IT'))
}

export function explainPriceListMatch(priceList: StandardWorkPriceListItem[], line: Partial<EstimateLine>) {
	const workName = String(line.standardWorkName || line.description || '').trim()
	const panelName = String(line.panelName || '').trim()
	const panelId = String(line.panelId || '').trim()
	const repairExtent = String(line.repairExtent || '').trim()
	const variant = String(line.paintCycle || '').trim()
	const candidates = priceList.map((item) => evaluatePriceListCandidate(item, line).debug)
	return {
		request: {
			panelId,
			panelName,
			panelNameNormalized: normalizeLookupToken(panelName),
			workName,
			workNameNormalized: canonicalWorkName(workName),
			repairExtent,
			repairExtentNormalized: normalizeRepairExtent(repairExtent),
			variant,
			variantNormalized: normalizeVariant(variant),
		},
		candidates,
	}
}

export function resolvePriceListItem(priceList: StandardWorkPriceListItem[], line: Partial<EstimateLine>) {
	const matches = priceList
		.map((item) => evaluatePriceListCandidate(item, line))
		.filter((entry) => entry.accepted)
		.sort((a, b) => b.score - a.score || a.item.workName.localeCompare(b.item.workName, 'it-IT'))
	return matches[0]?.item ?? null
}

export function resolvePriceListUnitPrice(priceList: StandardWorkPriceListItem[], line: Partial<EstimateLine>) {
	const match = resolvePriceListItem(priceList, line)
	return match ? Math.max(0, Number(match.unitPrice ?? 0)) : null
}

function linePanelCount(line: Partial<EstimateLine>) {
	const qty = Number(line.quantity ?? 0)
	return qty > 0 ? qty : 1
}

function ruleSpecificity(rule: StandardWorkRule) {
	const conditions = rule.conditions ?? {}
	let score = 0
	if (conditions.vehicleSizeClass) score += 1
	if (conditions.colorFamily) score += 1
	if (conditions.paintCycle) score += 1
	if (conditions.minPanels != null) score += 1
	if (conditions.maxPanels != null) score += 1
	if (conditions.attributes) score += Object.keys(conditions.attributes).length
	return score
}

function ruleMatches(rule: StandardWorkRule, line: Partial<EstimateLine>) {
	if (!rule.active) return false
	const conditions = rule.conditions ?? {}
	if (conditions.vehicleSizeClass && conditions.vehicleSizeClass !== (line.vehicleSizeClass || '')) return false
	if (normalizeText(conditions.colorFamily) && normalizeText(conditions.colorFamily) !== normalizeText(line.colorFamily)) return false
	if (normalizeText(conditions.paintCycle) && normalizeText(conditions.paintCycle) !== normalizeText(line.paintCycle)) return false
	const panels = linePanelCount(line)
	if (conditions.minPanels != null && panels < Number(conditions.minPanels)) return false
	if (conditions.maxPanels != null && panels > Number(conditions.maxPanels)) return false
	const attrs = conditions.attributes ?? {}
	for (const [key, expected] of Object.entries(attrs)) {
		const actual = (line as Record<string, unknown>)[key]
		if (normalizeText(expected) !== normalizeText(String(actual ?? ''))) return false
	}
	return true
}

export function resolveStandardRuleForLine(standardWorks: StandardWorkDefinition[], line: Partial<EstimateLine>, timePresets: StandardWorkTimePreset[] = []) {
	const standard = findStandardWork(standardWorks, line.standardWorkId || line.standardWorkName || line.description || '')
	if (!standard) return { standard: null, rule: null, standardMinutes: 0, summary: '' }
	const presetMinutes = resolveTimePresetMinutes(timePresets, line)
	if (presetMinutes != null) {
		const variant = String(line.paintCycle ?? '').trim()
		return {
			standard,
			rule: null,
			standardMinutes: Math.max(1, Number(presetMinutes)),
			summary: variant ? `Preset pannello/lavorazione (${variant})` : 'Preset pannello/lavorazione',
		}
	}
	const matches = (standard.rules ?? [])
		.filter((rule) => ruleMatches(rule, line))
		.sort((a, b) => ruleSpecificity(b) - ruleSpecificity(a) || b.priority - a.priority || a.name.localeCompare(b.name, 'it-IT'))
	const rule = matches[0] ?? null
	if (!rule) return { standard, rule: null, standardMinutes: Math.max(1, Number(standard.standardMinutes || 1)), summary: 'Tempo base lavorazione' }
	const parts: string[] = []
	const conditions = rule.conditions ?? {}
	if (conditions.vehicleSizeClass) parts.push(`vettura ${conditions.vehicleSizeClass}`)
	if (conditions.colorFamily) parts.push(`colore ${conditions.colorFamily}`)
	if (conditions.paintCycle) parts.push(`ciclo ${conditions.paintCycle}`)
	if (conditions.minPanels != null || conditions.maxPanels != null) {
		const min = conditions.minPanels == null ? '' : String(conditions.minPanels)
		const max = conditions.maxPanels == null ? '' : String(conditions.maxPanels)
		parts.push(min && max ? `pannelli ${min}-${max}` : min ? `pannelli >= ${min}` : `pannelli <= ${max}`)
	}
	const summary = parts.length ? parts.join(' + ') : 'Regola specifica'
	return { standard, rule, standardMinutes: Math.max(1, Number(rule.minutes || standard.standardMinutes || 1)), summary }
}

function resolvedEstimatedMinutes(line: Partial<EstimateLine>, standardMinutes: number) {
	const manual = Number(line.estimatedMinutes ?? 0)
	if (manual > 0) return Math.round(manual)
	if (standardMinutes > 0) return Math.round(standardMinutes)
	return 60
}

function resolvedQuantity(line: Partial<EstimateLine>) {
	const qty = Number(line.quantity ?? 0)
	return qty > 0 ? qty : 1
}

function resolvedLineTotalMinutes(calculationType: 'per-vehicle' | 'per-panel', estimatedMinutes: number, quantity: number) {
	if (calculationType === 'per-panel') return Math.max(1, Math.round(estimatedMinutes * quantity))
	return Math.max(1, Math.round(estimatedMinutes))
}

function sanitizeLine(
	line: Omit<EstimateLine, 'id' | 'taxableAmount' | 'vatAmount' | 'total'> & { id?: string },
	standardWorks: StandardWorkDefinition[] = [],
	plannerSettings?: PlannerSettings,
): EstimateLine {
	const quantity = Math.max(0, Number(line.quantity) || 0)
	const unitPrice = Math.max(0, Number(line.unitPrice) || 0)
	const discount = Math.max(0, Number(line.discount) || 0)
	const taxableAmount = round(Math.max(0, quantity * unitPrice - discount))
	const vatRate = Math.max(0, Number(line.vatRate) || 0)
	const vatAmount = round(taxableAmount * vatRate / 100)
	const total = round(taxableAmount + vatAmount)
	const resolved = resolveStandardRuleForLine(standardWorks, line, plannerSettings?.standardWorkTimePresets ?? [])
	const standard = resolved.standard
	const calculationType = line.calculationType === 'per-panel' || standard?.calculationType === 'per-panel' ? 'per-panel' : 'per-vehicle'
	const standardWorkName = (line.standardWorkName || standard?.name || line.description || '').trim()
	const standardMinutes = Math.max(0, Number(line.standardMinutes ?? resolved.standardMinutes ?? standard?.standardMinutes ?? 0))
	const estimatedMinutes = resolvedEstimatedMinutes(line, standardMinutes)
	const quantityResolved = resolvedQuantity(line)
	const lineTotalMinutes = resolvedLineTotalMinutes(calculationType, estimatedMinutes, quantityResolved)
	const manualTimeOverride = Number(line.estimatedMinutes ?? 0) > 0 && Number(line.estimatedMinutes ?? 0) !== standardMinutes
	const baseLine: EstimateLine = {
		id: line.id || id(),
		description: line.description.trim(),
		panelId: String(line.panelId ?? '').trim(),
		panelName: (line.panelName || '').trim(),
		panelSide: line.panelSide === 'sx' || line.panelSide === 'dx' || line.panelSide === 'center' ? line.panelSide : '',
		repairExtent: line.repairExtent === 'mezzo' ? 'mezzo' : 'intero',
		panelWorkNote: String(line.panelWorkNote ?? '').trim(),
		vehicleSizeClass: line.vehicleSizeClass === 'piccola' || line.vehicleSizeClass === 'media' || line.vehicleSizeClass === 'grande' ? line.vehicleSizeClass : '',
		colorFamily: String(line.colorFamily ?? '').trim(),
		paintCycle: String(line.paintCycle ?? '').trim(),
		standardWorkId: standard?.id,
		category: line.category,
		standardWorkName,
		categoryOrPhase: line.categoryOrPhase || standard?.categoryOrPhase || phaseForWorkName(standardWorkName),
		calculationType,
		standardMinutes,
		estimatedMinutes,
		lineTotalMinutes,
		manualTimeOverride,
		appliedRuleId: resolved.rule?.id,
		appliedRuleName: resolved.rule?.name,
		appliedRuleSummary: resolved.rule ? resolved.summary : 'Tempo base lavorazione',
		requiredSkill: (line.requiredSkill || standard?.requiredSkill || '').trim(),
		cycleOrder: Number(line.cycleOrder ?? standard?.cycleOrder ?? 999),
		technicalWaitMinutes: Math.max(0, Number(line.technicalWaitMinutes ?? standard?.technicalWaitMinutes ?? 0)),
		technicalWaitBlocksPhaseNames: Array.isArray(line.technicalWaitBlocksPhaseNames) && line.technicalWaitBlocksPhaseNames.length
			? line.technicalWaitBlocksPhaseNames.map((name) => String(name).trim()).filter(Boolean)
			: Array.isArray(standard?.technicalWaitBlocksPhaseNames)
				? standard.technicalWaitBlocksPhaseNames.map((name) => String(name).trim()).filter(Boolean)
				: [],
		quantity,
		unitPrice,
		discount,
		taxableAmount,
		vatRate,
		vatAmount,
		total,
	}
	const economics = computeLineInternalEconomics(baseLine, plannerSettings ?? {
		...({} as PlannerSettings),
		internalCostSettings: {
			internalHourlyRate: 0,
			minimumMarginPercent: 0,
			monthlyCostItems: [],
			productiveCapacity: { productiveOperators: 0, hoursPerOperatorPerDay: 0, workingDaysPerMonth: 0, efficiencyPercent: 0 },
			useManualHourlyRate: false,
			manualHourlyRate: null,
			futureHourlyRateBySkill: {},
		},
	})
	return {
		...baseLine,
		...economics,
	}
}

export function estimateLineTotalMinutes(line: EstimateLine) {
	const calculationType = line.calculationType === 'per-panel' ? 'per-panel' : 'per-vehicle'
	const estimated = Math.max(1, Number(line.estimatedMinutes ?? line.standardMinutes ?? 1))
	const quantity = resolvedQuantity(line)
	return resolvedLineTotalMinutes(calculationType, estimated, quantity)
}

export function estimatePhaseTotals(lines: EstimateLine[]) {
	const totals = new Map<string, number>()
	for (const line of lines) {
		const phaseName = resolvedPhaseName(line)
		if (!phaseName) continue
		const minutes = estimateLineTotalMinutes(line)
		totals.set(phaseName, Math.max(0, Number(totals.get(phaseName) ?? 0)) + minutes)
	}
	return totals
}

export function estimateVehicleTotalMinutes(lines: EstimateLine[]) {
	return lines.reduce((sum, line) => sum + estimateLineTotalMinutes(line), 0)
}

function linesTotals(lines: EstimateLine[]) {
	return {
		taxableAmount: round(lines.reduce((sum, line) => sum + line.taxableAmount, 0)),
		vatAmount: round(lines.reduce((sum, line) => sum + line.vatAmount, 0)),
		total: round(lines.reduce((sum, line) => sum + line.total, 0)),
	}
}

function estimateNumber(next: number) {
	return `PREV-${String(next).padStart(5, '0')}`
}

function jobNumber(next: number) {
	return `COMM-${String(next).padStart(5, '0')}`
}

function qualityChecklistFromTemplates(templates: string[]): QualityChecklistItem[] {
	return templates
		.map((label) => label.trim())
		.filter(Boolean)
		.map((label) => ({
			id: id(),
			label,
			checked: false,
		}))
}

function buildPhases(lines: EstimateLine[]): JobPhase[] {
	const totalMinutes = Math.max(60, Math.round(lines.reduce((sum, line) => sum + estimateLineTotalMinutes(line), 0)))
	const phaseMinutes = Math.max(15, Math.round(totalMinutes / Math.max(1, JOB_PHASE_TEMPLATE.length)))
	const byPhase = new Map<string, { minutes: number; requiredSkill: string; cycleOrder: number; technicalWaitMinutes: number; technicalWaitBlocksPhaseNames: string[] }>()
	for (const line of lines) {
		const phaseName = resolvedPhaseName(line)
		if (!phaseName) continue
		const current = byPhase.get(phaseName) ?? { minutes: 0, requiredSkill: '', cycleOrder: Number(line.cycleOrder ?? 999), technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [] }
		current.minutes += estimateLineTotalMinutes(line)
		if (!current.requiredSkill && line.requiredSkill) current.requiredSkill = line.requiredSkill
		current.cycleOrder = Math.min(current.cycleOrder, Number(line.cycleOrder ?? 999))
		current.technicalWaitMinutes = Math.max(current.technicalWaitMinutes, Math.max(0, Number(line.technicalWaitMinutes ?? 0)))
		current.technicalWaitBlocksPhaseNames = Array.from(new Set([
			...current.technicalWaitBlocksPhaseNames,
			...(line.technicalWaitBlocksPhaseNames ?? []).map((name) => String(name).trim()).filter(Boolean),
		]))
		byPhase.set(phaseName, current)
	}
	return JOB_PHASE_TEMPLATE.map((name) => {
		const override = byPhase.get(name)
		return {
			id: id(),
			name,
			status: 'Da fare',
			notRequired: false,
			cycleOrder: override?.cycleOrder ?? 999,
			requiredSkill: override?.requiredSkill ?? '',
			operatorName: '',
			estimatedMinutes: Math.max(15, Math.round(override?.minutes ?? phaseMinutes)),
			actualMinutes: 0,
			notes: '',
			blockedReason: '',
			technicalWaitMinutes: override?.technicalWaitMinutes ?? 0,
			technicalWaitBlocksPhaseNames: override?.technicalWaitBlocksPhaseNames ?? [],
			operatorAssignments: [],
			timeAdjustments: [],
		}
	})
}

function uniqueNames(names: string[]) {
	return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))
}

function minutesBetween(startedAt: string, endedAt: string) {
	return Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000))
}

function normalizePhaseAssignments(phase: JobPhase, fallbackAt: string): JobPhaseOperatorAssignment[] {
	if (Array.isArray(phase.operatorAssignments) && phase.operatorAssignments.length) {
		return phase.operatorAssignments.map((item) => {
			const startedAt = item.startedAt || fallbackAt
			const endedAt = item.endedAt
			const workedMinutes = endedAt ? Math.max(Number(item.workedMinutes) || 0, minutesBetween(startedAt, endedAt)) : Math.max(0, Number(item.workedMinutes) || 0)
			const activityStatus = item.activityStatus || (endedAt ? 'Concluso' : 'Attivo')
			return {
				id: item.id || id(),
				operatorName: item.operatorName.trim(),
				startedAt,
				endedAt,
				workedMinutes,
				activityStatus,
			}
		}).filter((item) => item.operatorName)
	}
	const legacyName = phase.operatorName?.trim()
	if (!legacyName) return []
	const startedAt = phase.startedAt || fallbackAt
	const endedAt = phase.endedAt
	return [{
		id: id(),
		operatorName: legacyName,
		startedAt,
		endedAt,
		workedMinutes: endedAt ? minutesBetween(startedAt, endedAt) : 0,
		activityStatus: endedAt ? 'Concluso' : 'Attivo',
	}]
}

function activeAssignments(phase: JobPhase) {
	return phase.operatorAssignments.filter((item) => item.activityStatus === 'Attivo' && !item.endedAt)
}

function phaseOperatorHistory(phase: JobPhase) {
	return uniqueNames(phase.operatorAssignments.map((item) => item.operatorName))
}

function phaseActiveOperators(phase: JobPhase) {
	return uniqueNames(activeAssignments(phase).map((item) => item.operatorName))
}

function phaseManMinutes(phase: JobPhase, at: string) {
	return phase.operatorAssignments.reduce((sum, item) => {
		if (item.endedAt) return sum + Math.max(item.workedMinutes, minutesBetween(item.startedAt, item.endedAt))
		if (item.activityStatus === 'Attivo') return sum + minutesBetween(item.startedAt, at)
		return sum + Math.max(0, item.workedMinutes)
	}, 0)
}

function phaseDurationMinutes(phase: JobPhase, at: string) {
	const starts = phase.operatorAssignments.map((item) => item.startedAt).filter(Boolean)
	const phaseStart = starts.length ? starts.sort()[0] : phase.startedAt
	if (!phaseStart) return Math.max(0, phase.actualMinutes)
	const phaseEnd = phase.status === 'Completata'
		? (phase.endedAt || at)
		: at
	return minutesBetween(phaseStart, phaseEnd)
}

function synchronizePhase(phase: JobPhase, at: string): JobPhase {
	let assignments = normalizePhaseAssignments(phase, at)
	if (phase.status === 'Completata') {
		assignments = assignments.map((item) => {
			if (item.endedAt || item.activityStatus !== 'Attivo') return item
			return {
				...item,
				endedAt: at,
				workedMinutes: Math.max(item.workedMinutes, minutesBetween(item.startedAt, at)),
				activityStatus: 'Concluso',
			}
		})
	}
	const starts = assignments.map((item) => item.startedAt).filter(Boolean).sort()
	const startedAt = starts[0] || phase.startedAt
	const closedEnds = assignments.map((item) => item.endedAt).filter((value): value is string => Boolean(value)).sort()
	const endedAt = phase.status === 'Completata' ? (phase.endedAt || closedEnds[closedEnds.length - 1] || at) : phase.endedAt
	const current: JobPhase = {
		...phase,
		startedAt,
		endedAt,
		operatorAssignments: assignments,
		operatorName: phaseActiveOperators({ ...phase, operatorAssignments: assignments })[0] || phase.operatorName,
	}
	return {
		...current,
		actualMinutes: phase.status === 'Completata'
			? phaseDurationMinutes(current, endedAt || at)
			: phase.actualMinutes,
	}
}

function updatePhaseOperators(phase: JobPhase, operatorNames: string[], at: string): JobPhase {
	let assignments = normalizePhaseAssignments(phase, at)
	const desired = uniqueNames(operatorNames)
	const activeByName = new Map(activeAssignments({ ...phase, operatorAssignments: assignments }).map((item) => [item.operatorName, item]))
	assignments = assignments.map((item) => {
		if (item.activityStatus !== 'Attivo' || item.endedAt) return item
		if (desired.includes(item.operatorName)) return item
		return {
			...item,
			endedAt: at,
			workedMinutes: Math.max(item.workedMinutes, minutesBetween(item.startedAt, at)),
			activityStatus: 'Concluso',
		}
	})
	for (const name of desired) {
		if (activeByName.has(name)) continue
		assignments.push({
			id: id(),
			operatorName: name,
			startedAt: at,
			workedMinutes: 0,
			activityStatus: 'Attivo',
		})
	}
	const next = synchronizePhase({ ...phase, operatorAssignments: assignments }, at)
	if (next.status === 'Da fare' && desired.length) {
		return synchronizePhase({ ...next, status: 'In lavorazione', startedAt: next.startedAt || at }, at)
	}
	return next
}

function statusFromProgress(phases: JobPhase[]): number {
	if (!phases.length) return 0
	const completed = phases.filter((phase) => phase.status === 'Completata' || phase.notRequired).length
	return Math.round((completed / phases.length) * 100)
}

function activeWorkflowPhases(job: RepairJob) {
	return job.phases.filter((phase) => !phase.notRequired)
}

function deriveJobProgress(job: RepairJob) {
	return statusFromProgress(job.phases)
}

function latestCompletedPhase(job: RepairJob) {
	const completed = activeWorkflowPhases(job).filter((phase) => phase.status === 'Completata')
	return completed.length ? completed[completed.length - 1] : null
}

function nextTodoPhase(job: RepairJob) {
	return activeWorkflowPhases(job).find((phase) => phase.status === 'Da fare') ?? null
}

function currentWorkflowPhase(job: RepairJob) {
	return activeWorkflowPhases(job).find((phase) => phase.status === 'In lavorazione')
		?? activeWorkflowPhases(job).find((phase) => phase.status === 'Bloccata')
		?? nextTodoPhase(job)
		?? latestCompletedPhase(job)
		?? null
}

function productionPhaseFromWorkflow(job: RepairJob): ProductionPhase {
	if (job.status === 'Pronta consegna' || job.status === 'Consegnata') return 'Pronta'
	const phase = currentWorkflowPhase(job)
	if (!phase) return 'Da iniziare'
	if (phase.name === 'Smontaggio') return 'Smontaggio'
	if (phase.name === 'Lattoneria') return 'Lattoneria'
	if (phase.name === 'Preparazione') return 'Preparazione'
	if (phase.name === 'Verniciatura') return 'Verniciatura'
	if (phase.name === 'Rimontaggio') return 'Rimontaggio'
	if (phase.name === 'Lucidatura') return 'Lucidatura'
	if (phase.name === 'Lavaggio') return 'Lavaggio/Controllo'
	if (phase.name === 'Controllo qualità') return 'Lavaggio/Controllo'
	return 'Da iniziare'
}

function latestOperator(job: RepairJob) {
	const inWork = activeWorkflowPhases(job).find((phase) => phase.status === 'In lavorazione')
	if (inWork) {
		const active = phaseActiveOperators(inWork)
		if (active.length) return active[active.length - 1]
	}
	const completed = latestCompletedPhase(job)
	if (completed) {
		const history = phaseOperatorHistory(completed)
		if (history.length) return history[history.length - 1]
	}
	return job.responsible.trim()
}

function blockedReason(job: RepairJob) {
	const blocked = activeWorkflowPhases(job).find((phase) => phase.status === 'Bloccata' && phase.blockedReason.trim())
	if (blocked) return blocked.blockedReason.trim()
	return job.blocks[0] || ''
}

function isJobStatusOperational(status: JobStatus) {
	return status !== 'Annullata'
}

function stabilizeJobStatusFromPhases(job: RepairJob): JobStatus {
	const phases = activeWorkflowPhases(job)
	if (!phases.length) return job.status
	if (job.status === 'Annullata' || job.status === 'Consegnata') return job.status
	if (phases.some((phase) => phase.status === 'Bloccata')) return 'In attesa'
	if (phases.every((phase) => phase.status === 'Completata')) return job.status === 'Pronta consegna' ? 'Pronta consegna' : 'Controllo qualità'
	if (phases.some((phase) => phase.status === 'In lavorazione' || phase.status === 'Completata')) return 'In lavorazione'
	return job.status
}

function sameProductionJob(a: ProductionJobState, b: ProductionJobState) {
	return a.vehicleId === b.vehicleId
		&& a.phase === b.phase
		&& a.priority === b.priority
		&& a.operationalNotes === b.operationalNotes
		&& a.promisedAt === b.promisedAt
		&& JSON.stringify(a.assignedWorks) === JSON.stringify(b.assignedWorks)
}

export function workflowOperationalSnapshot(job: RepairJob): {
	lastCompletedPhase: string
	nextPhase: string
	currentPhase: string
	lastOperator: string
	progressPercent: number
	activeOperators: string[]
	phaseDurationMinutes: number
	manHoursMinutes: number
	plannedPhaseMinutes: number
	operatorCount: number
} {
	const at = now()
	const syncedPhases = job.phases.map((phase) => synchronizePhase(phase, at))
	const syncedJob = { ...job, phases: syncedPhases }
	const lastCompleted = latestCompletedPhase(syncedJob)
	const nextPhase = nextTodoPhase(syncedJob)
	const current = currentWorkflowPhase(syncedJob)
	const activeOps = current ? phaseActiveOperators(current) : []
	const operatorHistory = current ? phaseOperatorHistory(current) : []
	return {
		lastCompletedPhase: lastCompleted?.name || '—',
		nextPhase: nextPhase?.name || '—',
		currentPhase: current?.name || '—',
		lastOperator: latestOperator(syncedJob) || '—',
		progressPercent: deriveJobProgress(syncedJob),
		activeOperators: activeOps,
		phaseDurationMinutes: current ? phaseDurationMinutes(current, at) : 0,
		manHoursMinutes: current ? phaseManMinutes(current, at) : 0,
		plannedPhaseMinutes: current ? Math.max(0, current.estimatedMinutes) : 0,
		operatorCount: activeOps.length || operatorHistory.length,
	}
}

function mapJobStatusToVehicleStatus(status: JobStatus) {
	if (status === 'Consegnata') return 'Consegnata' as const
	if (status === 'Pronta consegna') return 'pronta' as const
	if (status === 'Annullata') return 'annullata' as const
	if (status === 'In lavorazione' || status === 'In attesa' || status === 'Controllo qualità') return 'in lavorazione' as const
	return 'Confermata' as const
}

export function createEstimate(data: ErpData, input: {
	customerId: string
	vehicleId?: string
	plate: string
	companyName: string
	contactName: string
	date: string
	priority?: RepairJob['priority']
	requestedDeliveryDate?: string
	notes: string
	productionForecast?: EstimateDocument['productionForecast']
	lines: Array<Omit<EstimateLine, 'id' | 'taxableAmount' | 'vatAmount' | 'total'> & { id?: string }>
}): ErpData {
	if (!input.customerId) throw new Error('Seleziona il cliente.')
	if (!input.plate.trim()) throw new Error('La targa è obbligatoria.')
	const standardWorks = data.plannerSettings.standardWorks ?? []
	const priceList = data.plannerSettings.standardWorkPriceList ?? []
	const lines = input.lines.map((line) => {
		const listPrice = resolvePriceListUnitPrice(priceList, line)
		const unitPrice = Number(line.unitPrice ?? 0)
		const withPrice = unitPrice > 0 || listPrice == null ? line : { ...line, unitPrice: listPrice }
		return sanitizeLine(withPrice, standardWorks, data.plannerSettings)
	}).filter((line) => line.description)
	if (!lines.length) throw new Error('Inserisci almeno una lavorazione.')
	const totals = linesTotals(lines)
	const nextCounter = Number(data.workflowCounters?.estimate ?? 0) + 1
	const timestamp = now()
	const estimate: EstimateDocument = {
		id: id(),
		number: estimateNumber(nextCounter),
		date: input.date || today(),
		customerId: input.customerId,
		vehicleId: input.vehicleId,
		plate: input.plate.trim().toUpperCase(),
		companyName: input.companyName.trim(),
		contactName: input.contactName.trim(),
		priority: input.priority ?? 'Normale',
		requestedDeliveryDate: String(input.requestedDeliveryDate ?? '').trim(),
		notes: input.notes.trim(),
		status: 'Bozza',
		lines,
		...totals,
		productionForecast: input.productionForecast,
		dataStimataInizio: input.productionForecast?.estimatedStartAt ?? '',
		dataStimataConsegna: input.productionForecast?.advisedDeliveryDate ?? '',
		dataCalcoloStima: input.productionForecast?.calculatedAt ?? '',
		convertedJobId: null,
		history: [{ id: id(), at: timestamp, actor: 'Operatore ERP', message: 'Preventivo creato in bozza.' }],
		createdAt: timestamp,
		updatedAt: timestamp,
	}
	return {
		...data,
		estimates: [estimate, ...(data.estimates ?? [])],
		workflowCounters: {
			estimate: nextCounter,
			job: Number(data.workflowCounters?.job ?? 0),
		},
	}
}

export function updateEstimate(data: ErpData, estimateId: string, input: {
	customerId: string
	vehicleId?: string
	plate: string
	companyName: string
	contactName: string
	date: string
	priority?: RepairJob['priority']
	requestedDeliveryDate?: string
	notes: string
	productionForecast?: EstimateDocument['productionForecast']
	lines: Array<Omit<EstimateLine, 'taxableAmount' | 'vatAmount' | 'total'>>
}): ErpData {
	const estimates = data.estimates ?? []
	const current = estimates.find((estimate) => estimate.id === estimateId)
	if (!current) throw new Error('Preventivo non trovato.')
	if (current.convertedJobId) throw new Error('Il preventivo è già stato trasformato in commessa e non può essere modificato.')
	const standardWorks = data.plannerSettings.standardWorks ?? []
	const lines = input.lines.map((line) => sanitizeLine(line, standardWorks, data.plannerSettings)).filter((line) => line.description)
	if (!lines.length) throw new Error('Inserisci almeno una lavorazione.')
	const totals = linesTotals(lines)
	const timestamp = now()
	const updated: EstimateDocument = {
		...current,
		customerId: input.customerId,
		vehicleId: input.vehicleId,
		plate: input.plate.trim().toUpperCase(),
		companyName: input.companyName.trim(),
		contactName: input.contactName.trim(),
		date: input.date || current.date,
		priority: input.priority ?? current.priority ?? 'Normale',
		requestedDeliveryDate: String(input.requestedDeliveryDate ?? current.requestedDeliveryDate ?? '').trim(),
		notes: input.notes.trim(),
		lines,
		...totals,
		productionForecast: input.productionForecast,
		dataStimataInizio: input.productionForecast?.estimatedStartAt ?? current.dataStimataInizio ?? '',
		dataStimataConsegna: input.productionForecast?.advisedDeliveryDate ?? current.dataStimataConsegna ?? '',
		dataCalcoloStima: input.productionForecast?.calculatedAt ?? current.dataCalcoloStima ?? '',
		updatedAt: timestamp,
		history: [{ id: id(), at: timestamp, actor: 'Operatore ERP', message: 'Dati economici o anagrafici aggiornati.' }, ...current.history],
	}
	return {
		...data,
		estimates: estimates.map((estimate) => estimate.id === estimateId ? updated : estimate),
	}
}

export function updateEstimateStatus(data: ErpData, estimateId: string, status: EstimateStatus): ErpData {
	const estimates = data.estimates ?? []
	const current = estimates.find((estimate) => estimate.id === estimateId)
	if (!current) throw new Error('Preventivo non trovato.')
	if (current.status === status) return data
	const allowed = allowedEstimateStatusTransitions[current.status]
	if (!allowed.includes(status)) throw new Error(`Transizione non consentita da ${current.status} a ${status}.`)
	const timestamp = now()
	const updated: EstimateDocument = {
		...current,
		status,
		updatedAt: timestamp,
		history: [{ id: id(), at: timestamp, actor: 'Operatore ERP', message: `Stato aggiornato a ${status}.` }, ...current.history],
	}
	return {
		...data,
		estimates: estimates.map((estimate) => estimate.id === estimateId ? updated : estimate),
	}
}

function createJobFromEstimate(data: ErpData, estimate: EstimateDocument): RepairJob {
	const nextCounter = Number(data.workflowCounters?.job ?? 0) + 1
	const timestamp = now()
	const checklist = qualityChecklistFromTemplates(data.qualityChecklistTemplates ?? [])
	const phases = buildPhases(estimate.lines)
	return {
		id: id(),
		number: jobNumber(nextCounter),
		estimateId: estimate.id,
		customerId: estimate.customerId,
		vehicleId: estimate.vehicleId,
		plate: estimate.plate,
		coneNumber: null,
		entryDate: estimate.productionForecast?.firstAvailabilityDate || today(),
		expectedDeliveryDate: estimate.requestedDeliveryDate || estimate.productionForecast?.advisedDeliveryDate || estimate.date,
		priority: estimate.priority ?? 'Normale',
		responsible: '',
		status: 'Da pianificare',
		companyName: estimate.companyName,
		contactName: estimate.contactName,
		notes: estimate.notes,
		blocks: [],
		lines: estimate.lines.map((line) => ({ ...line })),
		phases,
		qualityChecklist: checklist,
		taxableAmount: estimate.taxableAmount,
		vatAmount: estimate.vatAmount,
		total: estimate.total,
		progressPercent: statusFromProgress(phases),
		createdAt: timestamp,
		updatedAt: timestamp,
		history: [{ id: id(), at: timestamp, actor: 'Operatore ERP', message: `Commessa creata da ${estimate.number}.` }],
	}
}

type EstimateWorkflowInput = {
	customerId: string
	vehicleId?: string
	plate: string
	companyName: string
	contactName: string
	date: string
	priority?: RepairJob['priority']
	requestedDeliveryDate?: string
	notes: string
	productionForecast?: EstimateDocument['productionForecast']
	lines: Array<Omit<EstimateLine, 'id' | 'taxableAmount' | 'vatAmount' | 'total'> & { id?: string }>
}

export type EstimateTransactionPersistence = {
	save: (data: ErpData) => Promise<void>
	load: () => Promise<ErpData>
}

function buildVehicleFromEstimateInput(input: EstimateWorkflowInput): Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'> {
	const plannedEntryDate = input.productionForecast?.firstAvailabilityDate || input.date || today()
	const requestedDeliveryDate = String(input.requestedDeliveryDate ?? '').trim()
	return {
		customerId: input.customerId,
		plate: input.plate.trim().toUpperCase(),
		make: '',
		model: '',
		color: '',
		year: '',
		vin: '',
		mileage: '',
		status: 'Confermata',
		priority: input.priority ?? 'Normale',
		estimatedHours: 0,
		workedHours: 0,
		plannedEntryDate,
		requestedDeliveryDate,
		calculatedDeliveryDate: '',
		expectedRevenue: 0,
		expectedMargin: 0,
		partsStatus: 'Disponibili',
		blockReason: '',
		manualPlanningDate: plannedEntryDate,
		notes: 'Creata automaticamente da conferma preventivo.',
	}
}

function ensureJobVehicleIntegrity(data: ErpData, estimateId: string) {
	const createdJob = (data.jobs ?? []).find((job) => job.estimateId === estimateId)
	if (!createdJob) throw new Error('Complessa non trovata dopo conferma preventivo.')
	if (!createdJob.vehicleId) throw new Error('Dato inconsistente: commessa senza vehicleId.')
	if (!data.vehicles.some((vehicle) => vehicle.id === createdJob.vehicleId)) {
		throw new Error('Dato inconsistente: vehicleId commessa non presente in vehicles.')
	}
}

export async function confirmEstimateAndCreateJobTransactional(
	data: ErpData,
	input: EstimateWorkflowInput,
	persistence: EstimateTransactionPersistence,
	estimateIdToApprove?: string,
): Promise<ErpData> {
	let workingData = data
	let ensuredVehicleId = String(input.vehicleId ?? '').trim()

	if (!ensuredVehicleId) {
		const withVehicle = addVehicle(workingData, buildVehicleFromEstimateInput(input))
		const createdVehicle = withVehicle.vehicles[0]
		try {
			await persistence.save(withVehicle)
			const reloaded = await persistence.load()
			const persistedVehicle = reloaded.vehicles.find((vehicle) => vehicle.id === createdVehicle.id)
			if (!persistedVehicle) throw new Error('Vettura non persistita')
			workingData = reloaded
			ensuredVehicleId = persistedVehicle.id
		} catch {
			throw new Error('Impossibile salvare la vettura. Riprova.')
		}
	}

	if (!workingData.vehicles.some((vehicle) => vehicle.id === ensuredVehicleId)) {
		throw new Error('Dato inconsistente: vehicleId non presente in archivio veicoli.')
	}

	if (estimateIdToApprove) {
		const linesForUpdate = input.lines.map((line) => ({
			...line,
			id: line.id || id(),
		}))
		const updated = updateEstimate(workingData, estimateIdToApprove, {
			...input,
			vehicleId: ensuredVehicleId,
			lines: linesForUpdate,
		})
		const withJob = approveEstimateAndCreateJob(updated, estimateIdToApprove)
		ensureJobVehicleIntegrity(withJob, estimateIdToApprove)
		return withJob
	}

	const withEstimate = createEstimate(workingData, {
		...input,
		vehicleId: ensuredVehicleId,
	})
	const createdEstimate = (withEstimate.estimates ?? []).find((estimate) => !(workingData.estimates ?? []).some((current) => current.id === estimate.id))
	if (!createdEstimate) throw new Error('Preventivo appena creato non trovato.')

	const withJob = approveEstimateAndCreateJob(withEstimate, createdEstimate.id)
	ensureJobVehicleIntegrity(withJob, createdEstimate.id)
	return withJob
}

export function approveEstimateAndCreateJob(data: ErpData, estimateId: string): ErpData {
	const estimates = data.estimates ?? []
	const current = estimates.find((estimate) => estimate.id === estimateId)
	if (!current) throw new Error('Preventivo non trovato.')
	if (current.convertedJobId) throw new Error('Esiste già una commessa collegata a questo preventivo.')

	const prepared = current.status === 'Approvato'
		? data
		: updateEstimateStatus(data, estimateId, 'Approvato')
	const approvedEstimate = (prepared.estimates ?? []).find((estimate) => estimate.id === estimateId)
	if (!approvedEstimate) throw new Error('Preventivo non trovato.')

	const job = createJobFromEstimate(prepared, approvedEstimate)
	const timestamp = now()
	const vehicle = job.vehicleId ? prepared.vehicles.find((item) => item.id === job.vehicleId) : undefined
	const nextData = {
		...prepared,
		jobs: [job, ...(prepared.jobs ?? [])],
		estimates: (prepared.estimates ?? []).map((estimate) => estimate.id === estimateId
			? {
					...estimate,
					convertedJobId: job.id,
					updatedAt: timestamp,
					history: [{ id: id(), at: timestamp, actor: 'Operatore ERP', message: `Convertito in commessa ${job.number}.` }, ...estimate.history],
				}
			: estimate),
		workflowCounters: {
			estimate: Number(prepared.workflowCounters?.estimate ?? 0),
			job: Number(prepared.workflowCounters?.job ?? 0) + 1,
		},
	}

	if (vehicle) {
		return syncOperationalStateFromJobs({
			...nextData,
			jobs: (nextData.jobs ?? []).map((item) => item.id === job.id ? {
				...item,
				expectedDeliveryDate: approvedEstimate.requestedDeliveryDate || vehicle.requestedDeliveryDate || item.expectedDeliveryDate,
				coneNumber: vehicle.coneNumber,
			} : item),
		})
	}
	return syncOperationalStateFromJobs(nextData)
}

export function createDirectJob(data: ErpData, input: {
	customerId: string
	vehicleId?: string
	plate: string
	companyName: string
	contactName: string
	entryDate: string
	expectedDeliveryDate: string
	priority: RepairJob['priority']
	responsible: string
	notes: string
	lines: Array<Omit<EstimateLine, 'id' | 'taxableAmount' | 'vatAmount' | 'total'> & { id?: string }>
}): ErpData {
	if (!input.customerId) throw new Error('Seleziona il cliente.')
	if (!input.plate.trim()) throw new Error('La targa è obbligatoria.')
	const standardWorks = data.plannerSettings.standardWorks ?? []
	const priceList = data.plannerSettings.standardWorkPriceList ?? []
	const lines = input.lines.map((line) => {
		const listPrice = resolvePriceListUnitPrice(priceList, line)
		const unitPrice = Number(line.unitPrice ?? 0)
		const withPrice = unitPrice > 0 || listPrice == null ? line : { ...line, unitPrice: listPrice }
		return sanitizeLine(withPrice, standardWorks, data.plannerSettings)
	}).filter((line) => line.description)
	if (!lines.length) throw new Error('Inserisci almeno una lavorazione.')
	const totals = linesTotals(lines)
	const nextCounter = Number(data.workflowCounters?.job ?? 0) + 1
	const timestamp = now()
	const phases = buildPhases(lines)
	const checklist = qualityChecklistFromTemplates(data.qualityChecklistTemplates ?? [])
	const job: RepairJob = {
		id: id(),
		number: jobNumber(nextCounter),
		estimateId: null,
		customerId: input.customerId,
		vehicleId: input.vehicleId,
		plate: input.plate.trim().toUpperCase(),
		coneNumber: null,
		entryDate: input.entryDate || today(),
		expectedDeliveryDate: input.expectedDeliveryDate || today(),
		priority: input.priority,
		responsible: input.responsible.trim(),
		status: 'Da pianificare',
		companyName: input.companyName.trim(),
		contactName: input.contactName.trim(),
		notes: input.notes.trim(),
		blocks: [],
		lines,
		phases,
		qualityChecklist: checklist,
		...totals,
		progressPercent: statusFromProgress(phases),
		createdAt: timestamp,
		updatedAt: timestamp,
		history: [{ id: id(), at: timestamp, actor: 'Operatore ERP', message: 'Commessa diretta creata senza preventivo.' }],
	}
	return syncOperationalStateFromJobs({
		...data,
		jobs: [job, ...(data.jobs ?? [])],
		workflowCounters: {
			estimate: Number(data.workflowCounters?.estimate ?? 0),
			job: nextCounter,
		},
	})
}

export function updateJobStatus(data: ErpData, jobId: string, status: JobStatus): ErpData {
	const jobs = data.jobs ?? []
	const current = jobs.find((job) => job.id === jobId)
	if (!current) throw new Error('Commessa non trovata.')
	if (current.status === status) return data
	const allowed = allowedJobTransitions[current.status]
	if (!allowed.includes(status)) throw new Error(`Transizione non consentita da ${current.status} a ${status}.`)
	if (status === 'Pronta consegna' && current.qualityChecklist.some((item) => !item.checked)) {
		throw new Error('Completa il controllo qualità prima di impostare Pronta consegna.')
	}
	const timestamp = now()
	let next: ErpData = {
		...data,
		jobs: jobs.map((job) => job.id === jobId ? {
			...job,
			status,
			deliveredAt: status === 'Consegnata' ? (job.deliveredAt || timestamp) : job.deliveredAt,
			updatedAt: timestamp,
			history: [{ id: id(), at: timestamp, actor: 'Operatore ERP', message: `Stato aggiornato a ${status}.` }, ...job.history],
		} : job),
	}

	const updated = (next.jobs ?? []).find((job) => job.id === jobId)
	if (updated?.vehicleId) {
		next = {
			...next,
			jobs: (next.jobs ?? []).map((job) => job.id === updated.id ? { ...job, coneNumber: next.vehicles.find((vehicle) => vehicle.id === updated.vehicleId)?.coneNumber ?? job.coneNumber } : job),
		}
		next = changeVehicleStatus(next, updated.vehicleId, mapJobStatusToVehicleStatus(status), { source: 'automatic', note: `Suggerimento automatico da commessa: ${status}.` })
	}
	return syncOperationalStateFromJobs(next)
}

export function updateJobMeta(data: ErpData, jobId: string, input: {
	expectedDeliveryDate: string
	priority: RepairJob['priority']
	responsible: string
	notes: string
}): ErpData {
	const jobs = data.jobs ?? []
	const current = jobs.find((job) => job.id === jobId)
	if (!current) throw new Error('Commessa non trovata.')
	const timestamp = now()
	const next = {
		...data,
		jobs: jobs.map((job) => job.id === jobId ? {
			...job,
			expectedDeliveryDate: input.expectedDeliveryDate || job.expectedDeliveryDate,
			priority: input.priority,
			responsible: input.responsible.trim(),
			notes: input.notes,
			updatedAt: timestamp,
			history: [{ id: id(), at: timestamp, actor: 'Operatore ERP', message: 'Dati pianificazione aggiornati.' }, ...job.history],
		} : job),
	}
	return syncOperationalStateFromJobs(next)
}

export function updateJobPhase(data: ErpData, jobId: string, phaseId: string, input: {
	status: JobPhaseStatus
	operatorName?: string
	activeOperators?: string[]
	notes?: string
	blockedReason?: string
	notRequired?: boolean
	at?: string
}): ErpData {
	const jobs = data.jobs ?? []
	const current = jobs.find((job) => job.id === jobId)
	if (!current) throw new Error('Commessa non trovata.')
	const phase = current.phases.find((item) => item.id === phaseId)
	if (!phase) throw new Error('Fase non trovata.')
	const phaseIndex = current.phases.findIndex((item) => item.id === phaseId)
	if (phaseIndex < 0) throw new Error('Fase non trovata.')
	if (phase.name === 'Controllo qualità' && input.notRequired) {
		throw new Error('Il Controllo qualità non può essere marcato come non necessario.')
	}
	if (phase.name === 'Controllo qualità' && input.status === 'Completata') {
		const previousPhases = current.phases.slice(0, phaseIndex)
		const canCompleteQuality = previousPhases.every((item) => item.status === 'Completata' || item.notRequired)
		if (!canCompleteQuality) {
			throw new Error('Completa le fasi precedenti o segnala quelle non necessarie prima di chiudere il Controllo qualità.')
		}
	}
	const timestamp = input.at || now()
	const nextPhases = current.phases.map((item) => {
		if (item.id !== phaseId) return item
		let nextPhase: JobPhase = {
			...item,
			status: input.status,
			notRequired: input.notRequired ?? item.notRequired ?? false,
			notes: input.notes ?? item.notes,
			blockedReason: input.status === 'Bloccata' ? (input.blockedReason?.trim() || item.blockedReason) : '',
		}
		if (input.status === 'In lavorazione' && !nextPhase.startedAt) nextPhase.startedAt = timestamp
		if (input.status === 'Completata' && !nextPhase.endedAt) nextPhase.endedAt = timestamp
		const explicitOperators = input.activeOperators ?? (input.operatorName ? [input.operatorName] : undefined)
		if (explicitOperators) {
			nextPhase = updatePhaseOperators(nextPhase, explicitOperators, timestamp)
		}
		nextPhase = synchronizePhase(nextPhase, timestamp)
		return nextPhase
	})
	const progressPercent = statusFromProgress(nextPhases)
	const stabilizedJobs = jobs.map((job) => job.id === jobId ? {
		...job,
		phases: nextPhases,
		blocks: nextPhases.filter((item) => item.status === 'Bloccata' && item.blockedReason).map((item) => item.blockedReason),
		progressPercent,
		status: stabilizeJobStatusFromPhases({ ...job, phases: nextPhases }),
		updatedAt: timestamp,
		history: [{ id: id(), at: timestamp, actor: 'Operatore ERP', message: `Fase ${phase.name} aggiornata a ${input.status}.` }, ...job.history],
	} : job)
	return syncOperationalStateFromJobs({
		...data,
 		jobs: stabilizedJobs,
	})
}

export function updateJobPhaseOperators(data: ErpData, jobId: string, phaseId: string, operatorNames: string[], at?: string): ErpData {
	const jobs = data.jobs ?? []
	const current = jobs.find((job) => job.id === jobId)
	if (!current) throw new Error('Commessa non trovata.')
	const phase = current.phases.find((item) => item.id === phaseId)
	if (!phase) throw new Error('Fase non trovata.')
	const timestamp = at || now()
	const nextPhases = current.phases.map((item) => item.id === phaseId ? updatePhaseOperators(item, operatorNames, timestamp) : item)
	const progressPercent = statusFromProgress(nextPhases)
	const stabilizedJobs = jobs.map((job) => job.id === jobId ? {
		...job,
		phases: nextPhases,
		blocks: nextPhases.filter((item) => item.status === 'Bloccata' && item.blockedReason).map((item) => item.blockedReason),
		progressPercent,
		status: stabilizeJobStatusFromPhases({ ...job, phases: nextPhases }),
		updatedAt: timestamp,
		history: [{ id: id(), at: timestamp, actor: 'Operatore ERP', message: `Operatori fase ${phase.name} aggiornati: ${uniqueNames(operatorNames).join(', ') || 'nessuno'}.` }, ...job.history],
	} : job)
	return syncOperationalStateFromJobs({
		...data,
		jobs: stabilizedJobs,
	})
}

export function updateJobPhaseEstimatedMinutes(data: ErpData, jobId: string, phaseId: string, estimatedMinutes: number, reason: string): ErpData {
	const jobs = data.jobs ?? []
	const current = jobs.find((job) => job.id === jobId)
	if (!current) throw new Error('Commessa non trovata.')
	const phase = current.phases.find((item) => item.id === phaseId)
	if (!phase) throw new Error('Fase non trovata.')
	const nextMinutes = Math.max(1, Math.round(estimatedMinutes))
	if (nextMinutes === phase.estimatedMinutes) return data
	const timestamp = now()
	const note = reason.trim() || 'Adeguamento tempi fase'
	const adjustment: JobPhaseTimeAdjustment = {
		id: id(),
		at: timestamp,
		reason: note,
		fromMinutes: phase.estimatedMinutes,
		toMinutes: nextMinutes,
	}
	const nextPhases = current.phases.map((item) => item.id === phaseId
		? {
			...item,
			estimatedMinutes: nextMinutes,
			timeAdjustments: [adjustment, ...(item.timeAdjustments ?? [])],
		}
		: item)
	const nextJobs = jobs.map((job) => job.id === jobId ? {
		...job,
		phases: nextPhases,
		updatedAt: timestamp,
		history: [{ id: id(), at: timestamp, actor: 'Responsabile reparto', message: `Tempo fase ${phase.name}: ${phase.estimatedMinutes} -> ${nextMinutes} min (${note}).` }, ...job.history],
	} : job)
	return syncOperationalStateFromJobs({
		...data,
		jobs: nextJobs,
	})
}

export function workTypeTimeComparison(data: ErpData) {
	const jobs = data.jobs ?? []
	const acc = new Map<string, { workType: string; plannedMinutes: number; actualMinutes: number; samples: number }>()
	for (const job of jobs) {
		for (const phase of job.phases) {
			if (phase.notRequired) continue
			const key = phase.name
			const item = acc.get(key) ?? { workType: key, plannedMinutes: 0, actualMinutes: 0, samples: 0 }
			item.plannedMinutes += Math.max(0, phase.estimatedMinutes)
			item.actualMinutes += Math.max(0, phase.actualMinutes)
			item.samples += 1
			acc.set(key, item)
		}
	}
	return Array.from(acc.values())
		.sort((a, b) => a.workType.localeCompare(b.workType, 'it-IT'))
		.map((item) => ({
			...item,
			plannedAverageMinutes: item.samples ? Math.round(item.plannedMinutes / item.samples) : 0,
			actualAverageMinutes: item.samples ? Math.round(item.actualMinutes / item.samples) : 0,
			deltaMinutes: item.actualMinutes - item.plannedMinutes,
		}))
}

export function toggleJobChecklistItem(data: ErpData, jobId: string, itemId: string, checked: boolean): ErpData {
	const jobs = data.jobs ?? []
	const current = jobs.find((job) => job.id === jobId)
	if (!current) throw new Error('Commessa non trovata.')
	const timestamp = now()
	return {
		...data,
		jobs: jobs.map((job) => job.id === jobId ? {
			...job,
			qualityChecklist: job.qualityChecklist.map((item) => item.id === itemId ? {
				...item,
				checked,
				checkedAt: checked ? timestamp : undefined,
			} : item),
			updatedAt: timestamp,
		} : job),
	}
}

export function updateQualityChecklistTemplates(data: ErpData, labels: string[]): ErpData {
	const unique = Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean)))
	return {
		...data,
		qualityChecklistTemplates: unique,
	}
}

export function syncJobsWithVehicles(data: ErpData): ErpData {
	const jobs = data.jobs ?? []
	if (!jobs.length) return data
	const syncedVehicles = data.vehicles.map((vehicle) => {
		const job = jobs.find((item) => item.vehicleId === vehicle.id && item.status !== 'Consegnata' && item.status !== 'Annullata')
		if (!job) return vehicle
		const plannedMinutes = estimateVehicleTotalMinutes(job.lines ?? [])
		const resetWorkedHours = job.status === 'Da pianificare' || job.status === 'Pianificata'
		return {
			...vehicle,
			priority: job.priority,
			requestedDeliveryDate: job.expectedDeliveryDate || vehicle.requestedDeliveryDate,
			manualPlanningDate: job.entryDate || vehicle.manualPlanningDate,
			estimatedHours: Math.max(0, Math.round((plannedMinutes / 60) * 100) / 100),
			workedHours: resetWorkedHours ? 0 : vehicle.workedHours,
		}
	})
	const syncedJobs = jobs.map((job) => {
		const vehicle = job.vehicleId ? syncedVehicles.find((item) => item.id === job.vehicleId) : undefined
		if (!vehicle) return job
		return {
			...job,
			plate: vehicle.plate,
			coneNumber: vehicle.coneNumber,
			expectedDeliveryDate: vehicle.requestedDeliveryDate || job.expectedDeliveryDate,
			priority: vehicle.priority ?? job.priority,
			blocks: job.blocks.length ? job.blocks : (vehicle.blockReason ? [vehicle.blockReason] : []),
		}
	})
	return {
		...data,
		vehicles: syncedVehicles,
		jobs: syncedJobs,
	}
}

export function syncOperationalStateFromJobs(data: ErpData): ErpData {
	const base = syncJobsWithVehicles(reconcileVehicleCones(syncJobsWithVehicles(data)))
	const jobs = base.jobs ?? []
	if (!jobs.length) return base
	let withSuggestedStatuses = base
	for (const job of jobs) {
		if (!job.vehicleId || job.status === 'Annullata') continue
		const vehicle = withSuggestedStatuses.vehicles.find((item) => item.id === job.vehicleId)
		if (!vehicle) continue
		const suggested = suggestVehicleStatus(withSuggestedStatuses.plannerSettings, vehicle, job.status)
		if (!suggested) continue
		withSuggestedStatuses = changeVehicleStatus(withSuggestedStatuses, vehicle.id, suggested, {
			source: 'automatic',
			note: `Suggerimento automatico da workflow: ${job.status}.`,
		})
	}

	const normalizedJobs = (withSuggestedStatuses.jobs ?? []).map((job) => {
		const at = now()
		const syncedPhases = job.phases.map((phase) => synchronizePhase(phase, at))
		const syncedJob = { ...job, phases: syncedPhases }
		const progressPercent = deriveJobProgress(syncedJob)
		const currentStatus = stabilizeJobStatusFromPhases(syncedJob)
		const blocks = activeWorkflowPhases(syncedJob).filter((phase) => phase.status === 'Bloccata' && phase.blockedReason.trim()).map((phase) => phase.blockedReason.trim())
		if (
			progressPercent === syncedJob.progressPercent
			&& currentStatus === job.status
			&& JSON.stringify(blocks) === JSON.stringify(job.blocks)
			&& JSON.stringify(syncedPhases) === JSON.stringify(job.phases)
		) return syncedJob
		return {
			...syncedJob,
			progressPercent,
			status: currentStatus,
			blocks,
		}
	})

	const vehicles = withSuggestedStatuses.vehicles.map((vehicle) => {
		const linkedJob = normalizedJobs.find((job) => isJobStatusOperational(job.status) && job.vehicleId === vehicle.id)
		if (!linkedJob) return vehicle
		const currentPhase = currentWorkflowPhase(linkedJob)
		const activeOperators = currentPhase ? phaseActiveOperators(currentPhase) : []
		const operator = latestOperator(linkedJob)
		const reason = blockedReason(linkedJob)
		const nextAssigned = activeOperators.length ? activeOperators : (operator ? [operator] : (vehicle.assignedEmployees ?? []))
		return {
			...vehicle,
			priority: linkedJob.priority,
			requestedDeliveryDate: linkedJob.expectedDeliveryDate || vehicle.requestedDeliveryDate,
			manualPlanningDate: linkedJob.entryDate || vehicle.manualPlanningDate,
			blockReason: reason,
			assignedEmployees: nextAssigned,
		}
	})

	const production = withSuggestedStatuses.production ?? {
		jobs: [],
		phaseHistory: [],
		workLogs: [],
		reports: [],
		paceStates: [],
		paceHistory: [],
		identities: [{ role: 'production' as const, operatorId: 'tablet-operator', operatorName: 'Operatore Produzione' }],
	}
	const byVehicle = new Map(production.jobs.map((job) => [job.vehicleId, job]))
	const operationalJobs = normalizedJobs.filter((job) => isJobStatusOperational(job.status) && job.vehicleId)
	const upserted = production.jobs.map((row) => ({ ...row }))
	for (const workflowJob of operationalJobs) {
		if (!workflowJob.vehicleId) continue
		const phase = currentWorkflowPhase(workflowJob)
		const activeOperators = phase ? phaseActiveOperators(phase) : []
		const nextRow: ProductionJobState = {
			vehicleId: workflowJob.vehicleId,
			phase: productionPhaseFromWorkflow(workflowJob),
			priority: workflowJob.priority,
			assignedWorks: [
				workflowJob.number,
				...workflowJob.lines.map((line) => line.description).filter(Boolean),
				...(activeOperators.length ? [`Operatori attivi: ${activeOperators.join(', ')}`] : []),
			],
			operationalNotes: blockedReason(workflowJob) || workflowJob.notes,
			promisedAt: workflowJob.expectedDeliveryDate,
			updatedAt: byVehicle.get(workflowJob.vehicleId)?.updatedAt || workflowJob.updatedAt || base.vehicles.find((vehicle) => vehicle.id === workflowJob.vehicleId)?.createdAt || now(),
		}
		const existing = byVehicle.get(workflowJob.vehicleId)
		if (!existing) {
			upserted.push(nextRow)
			continue
		}
		if (sameProductionJob(existing, nextRow)) continue
		const index = upserted.findIndex((row) => row.vehicleId === workflowJob.vehicleId)
		if (index >= 0) upserted[index] = { ...existing, ...nextRow }
	}

	return {
		...withSuggestedStatuses,
		vehicles,
		jobs: normalizedJobs,
		production: {
			...production,
			jobs: upserted,
		},
	}
}

export function calculateJobKpis(data: ErpData): {
	openJobs: number
	vehiclesInWork: number
	readyForDelivery: number
	deliveredThisMonth: number
	openValue: number
	completedValue: number
	delayedJobs: number
	averageWorkingHours: number
	onTimeCompletionRate: number
} {
	const jobs = data.jobs ?? []
	const monthKey = today().slice(0, 7)
	const openJobs = jobs.filter((job) => job.status !== 'Consegnata' && job.status !== 'Annullata')
	const completed = jobs.filter((job) => job.status === 'Consegnata')
	const deliveredThisMonth = completed.filter((job) => (job.deliveredAt || '').slice(0, 7) === monthKey).length
	const delayedJobs = openJobs.filter((job) => job.expectedDeliveryDate && job.expectedDeliveryDate < today()).length
	const totalPhaseMinutes = jobs
		.flatMap((job) => job.phases)
		.filter((phase) => phase.status === 'Completata')
		.reduce((sum, phase) => sum + phase.actualMinutes, 0)
	const completedPhases = jobs.flatMap((job) => job.phases).filter((phase) => phase.status === 'Completata').length
	const onTimeDone = completed.filter((job) => !job.expectedDeliveryDate || !job.deliveredAt || job.deliveredAt.slice(0, 10) <= job.expectedDeliveryDate).length
	return {
		openJobs: openJobs.length,
		vehiclesInWork: jobs.filter((job) => ['In lavorazione', 'In attesa', 'Controllo qualità'].includes(job.status)).length,
		readyForDelivery: jobs.filter((job) => job.status === 'Pronta consegna').length,
		deliveredThisMonth,
		openValue: round(openJobs.reduce((sum, job) => sum + job.total, 0)),
		completedValue: round(completed.reduce((sum, job) => sum + job.total, 0)),
		delayedJobs,
		averageWorkingHours: completedPhases ? round((totalPhaseMinutes / completedPhases) / 60) : 0,
		onTimeCompletionRate: completed.length ? round((onTimeDone / completed.length) * 100) : 0,
	}
}

export function findJobCurrentPhase(job: RepairJob): JobPhase | null {
	return job.phases.find((phase) => phase.status === 'In lavorazione')
		|| job.phases.find((phase) => phase.status === 'Bloccata')
		|| job.phases.find((phase) => phase.status !== 'Completata' && !phase.notRequired)
		|| null
}

export function estimateFinancialStage(data: ErpData, estimate: EstimateDocument): 'Preventivato' | 'Approvato' | 'Lavorato' | 'Fatturato' | 'Incassato' {
	if (estimate.status !== 'Approvato') return 'Preventivato'
	const job = (data.jobs ?? []).find((item) => item.id === estimate.convertedJobId)
	if (!job) return 'Approvato'
	if (job.status !== 'Consegnata') return 'Lavorato'
	const invoice = data.invoices.find((item) => item.lines.some((line) => line.vehicleId && line.vehicleId === job.vehicleId))
	if (!invoice) return 'Lavorato'
	const residual = Math.max(0, invoice.total - invoice.collectedAmount - invoice.ribaAllocatedAmount)
	return residual <= 0 ? 'Incassato' : 'Fatturato'
}
