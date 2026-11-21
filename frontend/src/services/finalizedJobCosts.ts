import type { PlannerSettings, RepairJob, Vehicle } from '../types'
import { isVehicleStatusSemantic } from './vehicleStatuses'
import { recordedJobVehicleCosts } from './jobMaterialCosts'

/** Resolve the accounting date and recorded costs for the visit without altering the job. */
export function finalizedJobCosts(job: RepairJob, vehicle: Vehicle | undefined, jobs: RepairJob[], settings: PlannerSettings) {
 const ownClosed = job.status === 'Consegnata' || job.status === 'Pronta consegna'
 const latestVisit = vehicle && !jobs.some(other => other.id !== job.id && other.vehicleId === vehicle.id && other.status !== 'Annullata' && other.entryDate > job.entryDate)
 const vehicleClosed = latestVisit && vehicle.status && (isVehicleStatusSemantic(settings, vehicle.status, 'ready') || isVehicleStatusSemantic(settings, vehicle.status, 'delivered'))
 const finalized = job.status !== 'Annullata' && Boolean(ownClosed || vehicleClosed)
 const phaseEnds = job.phases.map(p=>p.completedAt || p.endedAt || '').filter(Boolean).sort()
 const stamp = job.deliveredAt || (vehicleClosed ? vehicle?.deliveredAt : undefined) || phaseEnds.at(-1) || job.updatedAt
 const date = stamp && Number.isFinite(Date.parse(stamp)) ? new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date(stamp)) : undefined
 const costs = date && vehicle ? recordedJobVehicleCosts(vehicle,job,jobs,date) : undefined
 return {finalized,date,costs}
}
