import { useMemo, useState } from 'react'
import type { AcceptanceQuote, ErpData, EstimateDocument, EstimateLine } from '../types'
import { acceptanceEstimateLines } from '../services/damageQuote'
import { toRomePlanningClock } from '../services/romePlanningClock'
import { simulateEstimateProductionForecast } from '../services/planner'

export function DeliveryForecastPanel({ data, vehicleId, plate, requestedDeliveryDate, onRequestedDeliveryDateChange, planningPrecedence, onPlanningPrecedenceChange, quote, estimate }: { data: ErpData; vehicleId?: string; plate?: string; requestedDeliveryDate?: string; onRequestedDeliveryDateChange?: (date: string) => void; planningPrecedence?: boolean; onPlanningPrecedenceChange?: (value: boolean) => void; quote?: AcceptanceQuote; estimate?: EstimateDocument }) {
  const [revision, setRevision] = useState(0)
  const result = useMemo(() => {
    void revision // Explicit refresh without changing the quote.
    try {
      const vehicle = data.vehicles.find(item => item.id === vehicleId)
      const lines = quote ? acceptanceEstimateLines(quote, data.plannerSettings) as EstimateLine[] : estimate?.lines ?? []
      const targetPlate = vehicle?.plate || plate?.trim()
      if (!targetPlate) return { error: 'Inserisci la targa per verificare la consegna.' }
      if (!lines.length) return { error: 'Aggiungi una lavorazione per verificare la consegna.' }
      return { forecast: simulateEstimateProductionForecast(data, { vehicleId, plate: targetPlate, lines, selectedPhases: quote?.selectedPhases ?? estimate?.selectedPhases, priority: estimate?.priority, planningPrecedence: planningPrecedence ?? estimate?.planningPrecedence, requestedDeliveryDate: requestedDeliveryDate ?? estimate?.requestedDeliveryDate, referenceAt: onRequestedDeliveryDateChange ? toRomePlanningClock(new Date().toISOString()) : undefined }) }
    } catch (problem) { return { error: problem instanceof Error ? problem.message : 'Completa le lavorazioni.' } }
  }, [data, vehicleId, plate, requestedDeliveryDate, onRequestedDeliveryDateChange, planningPrecedence, quote, estimate, revision])
  const forecast = result.forecast
  const date = forecast?.advisedDeliveryDate
  const verifiedDate = onRequestedDeliveryDateChange && requestedDeliveryDate
  const startDate = forecast && (onRequestedDeliveryDateChange ? forecast.estimatedStartAt.slice(0, 10) : forecast.firstAvailabilityDate)
  return <section className="panel" aria-label="Previsione consegna preventivo">
    <h3>Previsione di consegna prima dell’invio</h3>
    {onRequestedDeliveryDateChange && <label>Data consegna concordata<input type="date" value={requestedDeliveryDate ?? ''} onChange={event => onRequestedDeliveryDateChange(event.target.value)} /></label>}
    {requestedDeliveryDate && onPlanningPrecedenceChange && <fieldset>
      <legend>Ordine di lavorazione</legend>
      <label><input type="radio" name="fast-planning-order" checked={!planningPrecedence} onChange={() => onPlanningPrecedenceChange(false)} /> Segui il programma</label>
      <label><input type="radio" name="fast-planning-order" checked={Boolean(planningPrecedence)} onChange={() => onPlanningPrecedenceChange(true)} /> Dai precedenza a questa vettura</label>
      {planningPrecedence && <p>Alla conferma della commessa, la vettura passa davanti alle lavorazioni ancora da avviare. Le consegne già previste possono slittare.</p>}
    </fieldset>}
    {verifiedDate && <p role="status">Data verificata {verifiedDate.split('-').reverse().join('/')} · <strong>{forecast?.requestedDeliveryCompatible === true
      ? planningPrecedence ? 'Data compatibile con precedenza.' : 'Data compatibile con il piano attuale.'
      : forecast?.requestedDeliveryCompatible === false
        ? planningPrecedence ? 'Data non compatibile anche con precedenza.' : 'Data non compatibile con il piano attuale.'
        : 'Compatibilità da verificare.'}</strong></p>}
    <strong>{date ? `${verifiedDate ? 'Prima consegna stimata' : 'Consegna indicativa'}: ${date.split('-').reverse().join('/')}` : 'Data da calcolare'}</strong>
    {result.error && <p role="status">{result.error}</p>}
    {!!forecast?.blockingReasons?.length && <p role="status">{forecast.blockingReasons.join(' ')}</p>}
    {date && <p>Inizio previsto: {startDate?.split('-').reverse().join('/')} · Affidabilità: {forecast?.reliability}.</p>}
    {verifiedDate && forecast?.requestedDeliveryCompatible === true && forecast.reliability === 'Bassa' && <p>La data è compatibile, ma il carico dell’officina è alto.</p>}
    {forecast?.requestedDeliveryCompatible === false && <p role="status">La data richiesta è precedente alla prima consegna prevista.</p>}
    <p>Stima indicativa sul carico e sui calendari attuali, sulle mansioni abilitate, sui tempi inseriti e sull’attesa dopo la verniciatura. Ricalcolala prima di comunicarla al cliente.{!onRequestedDeliveryDateChange && ' Non imposta la data di consegna concordata.'}</p>
    <button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}>Ricalcola previsione consegna</button>
  </section>
}
