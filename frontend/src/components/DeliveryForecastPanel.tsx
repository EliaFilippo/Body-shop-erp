import { useMemo, useState } from 'react'
import type { AcceptanceQuote, ErpData, EstimateDocument, EstimateLine } from '../types'
import { acceptanceEstimateLines } from '../services/damageQuote'
import { simulateEstimateProductionForecast } from '../services/planner'

export function DeliveryForecastPanel({ data, vehicleId, quote, estimate }: { data: ErpData; vehicleId?: string; quote?: AcceptanceQuote; estimate?: EstimateDocument }) {
  const [revision, setRevision] = useState(0)
  const result = useMemo(() => {
    void revision // Explicit refresh without changing the quote.
    try {
      const vehicle = data.vehicles.find(item => item.id === vehicleId)
      const lines = quote ? acceptanceEstimateLines(quote, data.plannerSettings) as EstimateLine[] : estimate?.lines ?? []
      if (!lines.length || !vehicle) return { error: 'Aggiungi la vettura e le lavorazioni per vedere la previsione.' }
      return { forecast: simulateEstimateProductionForecast(data, { vehicleId, plate: vehicle.plate, lines, selectedPhases: quote?.selectedPhases ?? estimate?.selectedPhases, priority: estimate?.priority, requestedDeliveryDate: estimate?.requestedDeliveryDate }) }
    } catch (problem) { return { error: problem instanceof Error ? problem.message : 'Completa le lavorazioni.' } }
  }, [data, vehicleId, quote, estimate, revision])
  const forecast = result.forecast
  const date = forecast?.advisedDeliveryDate
  return <section className="panel" aria-label="Previsione consegna preventivo">
    <h3>Previsione di consegna prima dell’invio</h3>
    <strong>{date ? `Consegna indicativa: ${date.split('-').reverse().join('/')}` : 'Data da calcolare'}</strong>
    {result.error && <p role="status">{result.error}</p>}
    {!!forecast?.blockingReasons?.length && <p role="status">{forecast.blockingReasons.join(' ')}</p>}
    {date && <p>Inizio previsto: {forecast?.firstAvailabilityDate.split('-').reverse().join('/')} · Affidabilità: {forecast?.reliability}.</p>}
    {forecast?.requestedDeliveryCompatible === false && <p role="status">La data richiesta è precedente alla prima consegna prevista.</p>}
    <p>Stima indicativa sul carico e sui calendari attuali, sulle mansioni abilitate, sui tempi inseriti e sull’attesa dopo la verniciatura. Ricalcolala prima di comunicarla al cliente. Non imposta la data di consegna concordata.</p>
    <button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}>Ricalcola previsione consegna</button>
  </section>
}
