import type { RepairJob, Vehicle } from '../types'
import { recordedJobVehicleCosts } from './jobMaterialCosts'
/** Read-only fallback: attribute vehicle consumables only to an unambiguous visit. */
export function archivedJobMaterials(vehicle:Vehicle,job:RepairJob,jobs:RepairJob[]):RepairJob {
 if(job.materialActualCost)return job
 const deliveredAt=job.deliveredAt||vehicle.deliveredAt
 if(!deliveredAt||!Number.isFinite(Date.parse(deliveredAt)))return job
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date(deliveredAt))
 const amount=recordedJobVehicleCosts(vehicle,job,jobs,day).materials
 if(amount===undefined)return job
 return {...job,materialActualCost:{amount:Math.round(amount*100)/100,at:deliveredAt,note:'Materiali di consumo già registrati sulla vettura, riferiti a questa lavorazione.'}}
}
