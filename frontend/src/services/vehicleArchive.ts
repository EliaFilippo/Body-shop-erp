import type { PlannerSettings, RepairJob, Vehicle } from '../types'
import { normalizePlate } from './erp'
import { isVehicleDeliveredStatus, isVehicleStatusSemantic } from './vehicleStatuses'

export function indexVehicleJobs(jobs: RepairJob[]) {
  const byId = new Map<string, RepairJob[]>()
  const byPlate = new Map<string, RepairJob[]>()
  for (const job of jobs) {
    const plate = normalizePlate(job.plate ?? '')
    if (!job.vehicleId && !plate) continue
    const index = job.vehicleId ? byId : byPlate
    const key = job.vehicleId || `${job.customerId}:${plate}`
    const group = index.get(key) ?? []
    group.push(job)
    index.set(key, group)
  }
  return (vehicle: Vehicle) => [
    ...(byId.get(vehicle.id) ?? []),
    ...(byPlate.get(`${vehicle.customerId}:${normalizePlate(vehicle.plate)}`) ?? []),
  ].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

export function isArchivedVehicle(settings: PlannerSettings, vehicle: Vehicle, jobs: RepairJob[]) {
  if (isVehicleStatusSemantic(settings, vehicle.status, 'cancelled')) return false
  return isVehicleDeliveredStatus(settings, vehicle.status)
    || (vehicle.coneNumber == null && vehicle.statusMode !== 'manual'
      && jobs.find(job => job.status !== 'Annullata')?.status === 'Consegnata')
}
