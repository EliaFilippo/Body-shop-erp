import type { AcceptanceQuote, EstimateLine, MinorDamagePreset, PlannerSettings, StandardWorkDefinition } from '../types'
import { computeLineInternalEconomics, resolvePriceListItem, resolveStandardRuleForLine } from './workflow'
import { eliasEntryForWork, eliasPricesForPanel, eliasWork, type EliasPriceEntry } from './eliasPriceList'
import { budgetLineSnapshot } from './quoteHourBudget'

const round = (value: number) => Math.round(value * 100) / 100
const safe = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0

export function recalculateDamageLine(line: EstimateLine, settings: PlannerSettings): EstimateLine {
  const estimatedMinutes = Math.round(safe(line.estimatedMinutes ?? 0))
  const unitPrice = round(safe(line.unitPrice))
  const taxableAmount = unitPrice
  const vatAmount = round(taxableAmount * safe(line.vatRate) / 100)
  const next = { ...line, quantity: 1, discount: 0, estimatedMinutes, lineTotalMinutes: estimatedMinutes,
    manualTimeOverride: true, unitPrice, taxableAmount, vatAmount, total: round(taxableAmount + vatAmount) }
  return { ...next, ...computeLineInternalEconomics(next, settings) }
}

export function makeDamageLine(settings: PlannerSettings, panel: { id: string; name: string }, work: StandardWorkDefinition,
  severity: 'lieve' | 'grave', vatRate: number, hourlyRate: number, preset?: MinorDamagePreset['lines'][number]): EstimateLine {
  const context = { panelId: panel.id, panelName: panel.name, standardWorkId: work.id, standardWorkName: work.name, description: work.name }
  const resolved = resolveStandardRuleForLine(settings.standardWorks ?? [], context, settings.standardWorkTimePresets ?? [])
  const listItem = resolvePriceListItem(settings.standardWorkPriceList ?? [], context)
  const minutes = preset?.minutes ?? resolved.standardMinutes
  return recalculateDamageLine({
    ...context, id: crypto.randomUUID(), damageSeverity: severity,
    materialsIncluded: preset?.materialsIncluded ?? Boolean(eliasEntryForWork(work.id)), priceVariant: preset?.priceVariant,
    category: /verniciatura/i.test(work.categoryOrPhase ?? '') ? 'verniciatura' : 'carrozzeria',
    panelSide: /-(sx|left)$/.test(panel.id) ? 'sx' : /-(dx|right)$/.test(panel.id) ? 'dx' : 'center',
    categoryOrPhase: work.categoryOrPhase, calculationType: 'per-panel',
    standardMinutes: resolved.standardMinutes, estimatedMinutes: minutes,
    requiredSkill: work.requiredSkill, cycleOrder: work.cycleOrder,
    technicalWaitMinutes: work.technicalWaitMinutes, technicalWaitBlocksPhaseNames: work.technicalWaitBlocksPhaseNames,
    quantity: 1, discount: 0, vatRate, taxableAmount: 0, vatAmount: 0, total: 0,
    unitPrice: severity === 'grave' ? minutes / 60 * hourlyRate : preset?.price ?? listItem?.unitPrice ?? 0,
  }, settings)
}

export function minorDamageLines(settings: PlannerSettings, panel: { id: string; name: string }, vatRate: number): EstimateLine[] {
  const preset = settings.minorDamagePresets?.find((item) => item.panelId === panel.id)
  const catalogWorks = (preset?.lines ?? []).flatMap((line) => { const entry = eliasEntryForWork(line.workId); return entry ? [eliasWork(entry)] : [] })
  return [...(settings.standardWorks ?? []), ...catalogWorks].filter((work) => work.active).flatMap((work) => {
    const saved = preset?.lines.find((line) => line.workId === work.id)
    if (preset && !saved) return []
    if (!preset && !resolvePriceListItem(settings.standardWorkPriceList ?? [], {
      panelName: panel.name, standardWorkId: work.id, standardWorkName: work.name, description: work.name,
    })) return []
    return [makeDamageLine(settings, panel, work, 'lieve', vatRate, 0, saved)]
  })
}

export function damageQuoteError(lines: EstimateLine[]): string {
  const invalid = lines.find((line) => !Number.isFinite(line.estimatedMinutes) || (line.estimatedMinutes ?? 0) <= 0
    || !Number.isFinite(line.unitPrice) || line.unitPrice <= 0)
  return invalid ? `Completa tempo e prezzo: ${invalid.panelName} · ${invalid.standardWorkName || invalid.description}.` : ''
}

export function makeMinorDamagePreset(panel: { id: string; name: string }, lines: EstimateLine[]): MinorDamagePreset {
  const selected = lines.filter((line) => line.panelId === panel.id)
  if (!selected.length) throw new Error('Seleziona almeno una lavorazione per questo pannello.')
  const error = damageQuoteError(selected)
  if (error) throw new Error(error)
  return { panelId: panel.id, panelName: panel.name, updatedAt: new Date().toISOString(),
    lines: selected.map((line) => ({ workId: line.standardWorkId!, minutes: line.estimatedMinutes!, price: line.unitPrice,
      materialsIncluded: line.materialsIncluded, priceVariant: line.priceVariant })) }
}

export function chooseEliasPrice(settings: PlannerSettings, lines: EstimateLine[], panel: { id: string; name: string }, entry: EliasPriceEntry,
  price: number, vatRate: number, severity: 'lieve' | 'grave', hourlyRate: number, rainSensor = false): EstimateLine[] {
  if (!entry.prices.includes(price)) throw new Error('Prezzo non presente nel listino Elias.')
  if (!eliasPricesForPanel(panel.id).some((item) => item.id === entry.id)) throw new Error('Lavorazione non disponibile per questo pannello.')
  const work = eliasWork(entry)
  const existing = lines.find((line) => line.panelId === panel.id && line.standardWorkId === work.id)
  const preset = settings.minorDamagePresets?.find((item) => item.panelId === panel.id)?.lines.find((line) => line.workId === work.id)
  const hasSensor = entry.id === 'parabrezza' && rainSensor
  const next = makeDamageLine(settings, panel, work, severity, vatRate, hourlyRate, {
    workId: work.id, minutes: existing?.estimatedMinutes ?? preset?.minutes ?? 0,
    price: price + (hasSensor ? 15 : 0), materialsIncluded: true,
    priceVariant: hasSensor ? 'sensore pioggia (+15 €)' : undefined,
  })
  // Le alternative della stessa famiglia sostituiscono la voce, evitando doppi addebiti.
  return [...lines.filter((line) => line.panelId !== panel.id || eliasEntryForWork(line.standardWorkId)?.family !== entry.family),
    { ...next, id: existing?.id ?? next.id }]
}

export function acceptanceEstimateLines(quote: AcceptanceQuote, settings?: PlannerSettings): Array<Partial<EstimateLine> & Pick<EstimateLine, 'description' | 'category' | 'quantity' | 'unitPrice' | 'discount' | 'vatRate'>> {
  const error = damageQuoteError(quote.damageLines ?? [])
  if (error) throw new Error(error)
  const lines = [
    ...(quote.damageLines ?? []).map((line) => ({ ...(settings ? budgetLineSnapshot(line, quote, settings) : line), description: `${line.standardWorkName || line.description} · ${line.panelName} (${line.damageSeverity || 'lieve'})${line.priceVariant && line.damageSeverity !== 'grave' ? ` · ${line.priceVariant}` : ''}${line.materialsIncluded ? ' · materiali inclusi' : ''}`, vatRate: quote.appliedVatRate })),
    ...quote.lines.filter((line) => line.kind !== 'discount' && line.quantity > 0 && line.unitPrice > 0).map((line) => ({
      description: line.description,
      category: line.kind === 'labor' ? 'carrozzeria' as const : line.kind === 'parts' ? 'ricambi' as const : line.kind === 'consumption' ? 'materiali' as const : line.kind === 'external' ? 'servizi esterni' as const : 'altre' as const,
      quantity: line.quantity, unitPrice: line.unitPrice, discount: 0, vatRate: quote.appliedVatRate,
      estimatedMinutes: line.kind === 'labor' ? Math.round(line.quantity * 60) : 0,
    })),
  ]
  if (!lines.length) throw new Error('Seleziona un pannello e aggiungi almeno una lavorazione con tempo e prezzo.')
  const total = round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0))
  const discount = Math.min(total, round(quote.lines.filter((line) => line.kind === 'discount').reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)))
  let remaining = discount
  return lines.map((line, index) => {
    const amount = index === lines.length - 1 ? remaining : Math.min(remaining, round(discount * line.quantity * line.unitPrice / total))
    remaining = round(remaining - amount)
    return { ...line, discount: amount }
  })
}
