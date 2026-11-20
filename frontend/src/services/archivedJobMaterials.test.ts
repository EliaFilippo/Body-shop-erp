import { expect,it } from 'vitest'
import type { RepairJob,Vehicle } from '../types'
import { archivedJobMaterials } from './archivedJobMaterials'
const job={id:'j',vehicleId:'v',entryDate:'2026-11-10',deliveredAt:'2026-11-18T16:01:00Z',status:'Consegnata'} as RepairJob
const vehicle={id:'v',costEntries:[{category:'vernice',usedAt:'2026-11-18',total:86.27},{category:'ricambi',usedAt:'2026-11-18',total:100}]} as Vehicle
it('uses already recorded consumables once, excluding spare parts',()=>{
 const next=archivedJobMaterials(vehicle,job,[job])
 expect(next.materialActualCost?.amount).toBe(86.27)
 expect(job.materialActualCost).toBeUndefined()
 expect(archivedJobMaterials(vehicle,next,[next])).toBe(next)
})
it('preserves explicit actual totals including zero',()=>{
 const explicit={...job,materialActualCost:{amount:0,at:'',note:''}}
 expect(archivedJobMaterials(vehicle,explicit,[explicit])).toBe(explicit)
})
it('does not attribute costs from other or ambiguous visits',()=>{
 expect(archivedJobMaterials(vehicle,job,[job,{...job,id:'other'}]).materialActualCost).toBeUndefined()
 expect(archivedJobMaterials({...vehicle,costEntries:[{...vehicle.costEntries![0],usedAt:'2026-11-19'}]},job,[job]).materialActualCost).toBeUndefined()
})
