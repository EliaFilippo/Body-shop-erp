import { describe, expect, it } from 'vitest'
import type { PlannerSettings } from '../types'
import { appendAcceptancePhotoEntry, buildAcceptanceQuoteSummary, calculateMonthlyHourlyRate, createAcceptanceDraft, createDefaultQuote, createPhotoArchiveEntry, toggleAcceptanceChecklistItem } from './acceptance'

const settings: PlannerSettings = {
  operators: [
    { id: 'op-1', name: 'Mario', dailyHours: 8, active: true },
    { id: 'op-2', name: 'Luca', dailyHours: 8, active: true },
  ],
  workingDays: [1, 2, 3, 4, 5],
  efficiencyPercent: 80,
  safetyMarginPercent: 15,
  holidays: [],
  closures: [],
  absences: [],
  monthlyRevenueGoal: 24000,
  ownerWithdrawalAmount: 3000,
  ownerWithdrawalPlannedDate: '2026-08-31',
  monthlyMarginGoal: null,
}

describe('accettazione preventiva', () => {
  it('calcola la tariffa oraria mensile dalle ore produttive disponibili', () => {
    const result = calculateMonthlyHourlyRate(settings, '2026-08', '2026-08-03')
    expect(result.rate).toBe(24000 / (5 * 2 * 8 * 0.8))
    expect(result.productiveHours).toBe(5 * 2 * 8 * 0.8)
  })

  it('crea un preventivo con materiale consumo inizialmente al 20% della manodopera', () => {
    const quote = createDefaultQuote(settings, '2026-08', 100)
    const summary = buildAcceptanceQuoteSummary(quote)
    expect(summary.materials.total).toBe(7500)
    expect(summary.total).toBeCloseTo(54900)
    expect(summary.marginPercent).toBeCloseTo(18.03)
  })

  it('genera una pratica di accettazione digitale con checklist e dati di ingresso', () => {
    const draft = createAcceptanceDraft('customer-1', 'vehicle-1', settings, '2026-08')
    expect(draft.intake?.mileage).toBe('')
    expect(draft.intake?.checklist.some((item) => item.label === 'Danni registrati')).toBe(true)
    expect(draft.intake?.accessories).toEqual([])
  })

  it('crea un elemento di archivio fotografico collegato a pratica e vettura', () => {
    const photo = createPhotoArchiveEntry('acc-1', 'veh-1', 'ingresso', 'foto.jpg', 'data:image/jpeg;base64,abc', 'Foto ingresso')
    expect(photo.acceptanceId).toBe('acc-1')
    expect(photo.vehicleId).toBe('veh-1')
    expect(photo.category).toBe('ingresso')
  })

  it('aggiorna lo stato della checklist e aggiunge la foto all archivio', () => {
    const draft = createAcceptanceDraft('customer-1', 'vehicle-1', settings, '2026-08')
    const firstItem = draft.intake?.checklist[0]
    expect(firstItem).toBeDefined()
    const toggled = toggleAcceptanceChecklistItem(draft, firstItem!.id)
    expect(toggled.intake?.checklist[0].checked).toBe(true)

    const photo = createPhotoArchiveEntry('acc-1', 'veh-1', 'ingresso', 'foto.jpg', 'data:image/jpeg;base64,abc', 'Foto ingresso')
    const withPhoto = appendAcceptancePhotoEntry(draft, photo)
    expect(withPhoto.photos).toHaveLength(1)
    expect(withPhoto.damagePhotos).toContain(photo.dataUrl)
  })
})
