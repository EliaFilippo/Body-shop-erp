import type { ErpData } from '../types'
import { buildCompletionPlan } from './completionPlanning'

export function setVehicleScheduleDates(data: ErpData, vehicleId: string, start: string, delivery: string): ErpData {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value
  if ((start && !valid(start)) || (delivery && !valid(delivery))) throw new Error('Inserisci date valide.')
  if (Boolean(start) !== Boolean(delivery)) throw new Error('Inserisci entrambe le date, oppure cancella entrambe per togliere la programmazione.')
  if (start && delivery < start) throw new Error('La consegna deve essere successiva o uguale all’inizio lavori.')
  if (!data.vehicles.some(vehicle => vehicle.id === vehicleId)) throw new Error('Vettura non trovata.')
  return { ...data,
    vehicles: data.vehicles.map(vehicle => vehicle.id === vehicleId ? { ...vehicle, scheduledStartDate: start || undefined, requestedDeliveryDate: delivery } : vehicle),
    jobs: data.jobs?.map(job => job.vehicleId === vehicleId && !['Consegnata', 'Annullata'].includes(job.status)
      ? { ...job, expectedDeliveryDate: delivery } : job),
  }
}

export function previewVehicleSchedule(data: ErpData, vehicleId: string, start: string, delivery: string, now = new Date().toISOString()) {
  const next = setVehicleScheduleDates(data, vehicleId, start, delivery)
  const job = next.jobs?.find(job => job.vehicleId === vehicleId && !['Consegnata', 'Annullata'].includes(job.status))
  if (!job) return { date: null, compatible: null }
  const plan = buildCompletionPlan(next, { serverNow: now, entries: [] }, 0)
  const forecast = plan.forecasts.find(item => item.jobId === job.id)
  return { date: forecast?.date ?? null, compatible: forecast?.date ? forecast.date <= delivery : null }
}
