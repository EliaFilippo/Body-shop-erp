import type { ErpData, Vehicle } from '../types'
import { addVehicle, changeVehicleStatus, updateVehicle } from './erp'

export type VehiclePersistenceAdapter = {
  save: (data: ErpData) => Promise<void>
  load: () => Promise<ErpData>
}

export async function saveVehicleWithPersistenceCheck({
  data,
  input,
  currentVehicle,
  save,
  load,
}: {
  data: ErpData
  input: Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'>
  currentVehicle?: Vehicle
} & VehiclePersistenceAdapter): Promise<{ data: ErpData; vehicleId: string }> {
  const baseNext = currentVehicle ? updateVehicle(data, currentVehicle.id, input) : addVehicle(data, input)
  const next = currentVehicle && currentVehicle.status !== input.status
    ? changeVehicleStatus(baseNext, currentVehicle.id, input.status, { source: 'manual', note: 'Aggiornamento manuale da dettaglio vettura.' })
    : baseNext

  const vehicleId = currentVehicle?.id ?? next.vehicles[0]?.id
  if (!vehicleId) throw new Error('Salvataggio vettura non riuscito')

  await save(next)

  const reloaded = await load()
  if (!reloaded.vehicles.some((vehicle) => vehicle.id === vehicleId)) {
    throw new Error('Salvataggio vettura non riuscito')
  }


  return { data: reloaded, vehicleId }
}
