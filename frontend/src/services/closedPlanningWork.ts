import type { ErpData, OperatorProgramTask } from '../types'
import { isVehicleStatusSemantic, isVehicleWaitingForParts } from './vehicleStatuses'

export function closedPlanningWork(data: ErpData) {
  const vehicleIds = new Set(data.vehicles.filter(vehicle =>
    isVehicleStatusSemantic(data.plannerSettings, vehicle.status, 'delivered')
    || isVehicleStatusSemantic(data.plannerSettings, vehicle.status, 'cancelled'),
  ).map(vehicle => vehicle.id))
  const jobIds = new Set((data.jobs ?? []).filter(job =>
    job.status === 'Consegnata' || job.status === 'Annullata' || vehicleIds.has(job.vehicleId ?? ''),
  ).map(job => job.id))
  return {
    jobIds,
    hasTask: (task: OperatorProgramTask) => jobIds.has(task.jobId) || vehicleIds.has(task.vehicleId),
  }
}

export function waitingPartsPlanningWork(data: ErpData) {
  const vehicleIds = new Set(data.vehicles.filter(vehicle => isVehicleWaitingForParts(data.plannerSettings, vehicle)).map(vehicle => vehicle.id))
  const jobIds = new Set((data.jobs ?? []).filter(job => vehicleIds.has(job.vehicleId ?? '')).map(job => job.id))
  return {
    jobIds,
    hasTask: (task: OperatorProgramTask) => jobIds.has(task.jobId) || vehicleIds.has(task.vehicleId),
  }
}
