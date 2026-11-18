import { useEffect, useState } from 'react'
import type { ErpData, Vehicle } from '../../types'
import { previewVehicleSchedule } from '../../services/vehicleScheduleDates'

export function VehicleScheduleDates({ data, vehicle, onSave }: {
  data: ErpData; vehicle: Vehicle; onSave: (start: string, delivery: string) => void
}) {
  const [start, setStart] = useState(vehicle.scheduledStartDate ?? '')
  const [delivery, setDelivery] = useState(vehicle.requestedDeliveryDate ?? '')
  const [message, setMessage] = useState('')
  const [compatible, setCompatible] = useState<boolean | null>(null)
  useEffect(() => {
    setStart(vehicle.scheduledStartDate ?? '')
    setDelivery(vehicle.requestedDeliveryDate ?? '')
  }, [vehicle.id, vehicle.scheduledStartDate, vehicle.requestedDeliveryDate])
  const clearResult = () => { setMessage(''); setCompatible(null) }
  return <form aria-label={`Programmazione ${vehicle.plate}`} className="vehicle-schedule-dates" onSubmit={event => {
    event.preventDefault()
    try {
      if (!start && !delivery) {
        onSave('', '')
        setMessage('Programmazione rimossa.')
        return
      }
      const result = previewVehicleSchedule(data, vehicle.id, start, delivery)
      onSave(start, delivery)
      setCompatible(result.compatible)
      const date = result.date?.split('-').reverse().join('/')
      setMessage(result.compatible === null ? 'Date impostate · consegna non stimabile: verifica tempi, mansioni, ricambi e blocchi.'
        : result.compatible ? `Date impostate · consegna compatibile. Fine lavori stimata ${date}.`
          : `Date impostate · consegna a rischio. Prima fine lavori stimata ${date}.`)
    } catch (error) { setCompatible(null); setMessage(error instanceof Error ? error.message : 'Verifica non riuscita.') }
  }}>
    <label>Inizio lavori<input type="date" value={start} onChange={event => { setStart(event.target.value); clearResult() }} /></label>
    <label>Consegna richiesta<input type="date" value={delivery} min={start || undefined} onChange={event => { setDelivery(event.target.value); clearResult() }} /></label>
    <button type="submit">Verifica e imposta date</button>
    <button type="button" onClick={() => { onSave('', ''); setStart(''); setDelivery(''); setCompatible(null); setMessage('Programmazione rimossa.') }}>Togli programmazione</button>
    {message && <p role="status" style={{ color: compatible === true ? 'var(--green)' : compatible === false ? 'var(--red)' : undefined }}>{message}</p>}
  </form>
}
