import type { AcceptanceQuote, EstimateLine, MinorDamagePreset, PlannerSettings, StandardWorkDefinition } from '../types'
import { computeLineInternalEconomics, resolvePriceListItem, resolveStandardRuleForLine } from './workflow'

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
  return (settings.standardWorks ?? []).filter((work) => work.active).flatMap((work) => {
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
    lines: selected.map((line) => ({ workId: line.standardWorkId!, minutes: line.estimatedMinutes!, price: line.unitPrice })) }
}

export function acceptanceEstimateLines(quote: AcceptanceQuote): Array<Partial<EstimateLine> & Pick<EstimateLine, 'description' | 'category' | 'quantity' | 'unitPrice' | 'discount' | 'vatRate'>> {
  const error = damageQuoteError(quote.damageLines ?? [])
  if (error) throw new Error(error)
  const lines = [
    ...(quote.damageLines ?? []).map((line) => ({ ...line, description: `${line.standardWorkName || line.description} · ${line.panelName} (${line.damageSeverity || 'lieve'})`, vatRate: quote.appliedVatRate })),
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
