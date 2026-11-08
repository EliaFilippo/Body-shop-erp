import { useMemo, useState } from 'react'
import type { AcceptanceQuote, ErpData, EstimateDocument, EstimateLine } from '../types'
import { acceptanceEstimateLines } from '../services/damageQuote'
import { toRomePlanningClock } from '../services/romePlanningClock'
import { simulateEstimateProductionForecast } from '../services/planner'

export function DeliveryForecastPanel({ data, vehicleId, plate, requestedDeliveryDate, onRequestedDeliveryDateChange, quote, estimate }: { data: ErpData; vehicleId?: string; plate?: string; requestedDeliveryDate?: string; onRequestedDeliveryDateChange?: (date: string) => void; quote?: AcceptanceQuote; estimate?: EstimateDocument }) {
  const [revision, setRevision] = useState(0)
  const result = useMemo(() => {
    void revision // Explicit refresh without changing the quote.
    try {
      const vehicle = data.vehicles.find(item => item.id === vehicleId)
      const lines = quote ? acceptanceEstimateLines(quote, data.plannerSettings) as EstimateLine[] : estimate?.lines ?? []
      const targetPlate = vehicle?.plate || plate?.trim()
      if (!lines.length || !targetPlate) return { error: 'Aggiungi la vettura e le lavorazioni per vedere la previsione.' }
      return { forecast: simulateEstimateProductionForecast(data, { vehicleId, plate: targetPlate, lines, selectedPhases: quote?.selectedPhases ?? estimate?.selectedPhases, priority: estimate?.priority, requestedDeliveryDate: requestedDeliveryDate ?? estimate?.requestedDeliveryDate, referenceAt: onRequestedDeliveryDateChange ? toRomePlanningClock(new Date().toISOString()) : undefined }) }
    } catch (problem) { return { error: problem instanceof Error ? problem.message : 'Completa le lavorazioni.' } }
  }, [data, vehicleId, plate, requestedDeliveryDate, onRequestedDeliveryDateChange, quote, estimate, revision])
  const forecast = result.forecast
  const date = forecast?.advisedDeliveryDate
  const startDate = forecast && (onRequestedDeliveryDateChange ? forecast.estimatedStartAt.slice(0, 10) : forecast.firstAvailabilityDate)
  return <section className="panel" aria-label="Previsione consegna preventivo">
    <h3>Previsione di consegna prima dell’invio</h3>
    {onRequestedDeliveryDateChange && <label>Data consegna concordata<input type="date" value={requestedDeliveryDate ?? ''} onChange={event => onRequestedDeliveryDateChange(event.target.value)} /></label>}
    {onRequestedDeliveryDateChange && requestedDeliveryDate && <p role="status"><strong>{forecast?.requestedDeliveryCompatible === true
      ? 'Data compatibile con il piano attuale.'
      : forecast?.requestedDeliveryCompatible === false
        ? 'Data non compatibile con il piano attuale.'
        : 'Compatibilità da verificare.'}</strong></p>}
    <strong>{date ? `Consegna indicativa: ${date.split('-').reverse().join('/')}` : 'Data da calcolare'}</strong>
    {result.error && <p role="status">{result.error}</p>}
    {!!forecast?.blockingReasons?.length && <p role="status">{forecast.blockingReasons.join(' ')}</p>}
    {date && <p>Inizio previsto: {startDate?.split('-').reverse().join('/')} · Affidabilità: {forecast?.reliability}.</p>}
    {forecast?.requestedDeliveryCompatible === false && <p role="status">La data richiesta è precedente alla prima consegna prevista.</p>}
    <p>Stima indicativa sul carico e sui calendari attuali, sulle mansioni abilitate, sui tempi inseriti e sull’attesa dopo la verniciatura. Ricalcolala prima di comunicarla al cliente.{!onRequestedDeliveryDateChange && ' Non imposta la data di consegna concordata.'}</p>
    <button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}>Ricalcola previsione consegna</button>
  </section>
}
