import { expect, it } from 'vitest'
import { emptyData } from './erp'
import type { Vehicle } from '../types'
import { setVehicleScheduleDates, previewVehicleSchedule } from './vehicleScheduleDates'
it('salva entrambe le date senza cambiare lo stato o la presenza della vettura',()=>{
 const data=structuredClone(emptyData)
 data.vehicles=[{id:'v',status:'in-lavorazione',presentInShop:true,requestedDeliveryDate:''} as Vehicle]
 const next=setVehicleScheduleDates(data,'v','2026-11-19','2026-11-20')
 expect(next.vehicles[0]).toMatchObject({scheduledStartDate:'2026-11-19',requestedDeliveryDate:'2026-11-20',status:'in-lavorazione',presentInShop:true})
 expect(data.vehicles[0].scheduledStartDate).toBeUndefined()
 expect(previewVehicleSchedule(data,'v','2026-11-19','2026-11-20')).toEqual({date:null,compatible:null})
 expect(()=>setVehicleScheduleDates(data,'v','2026-11-20','2026-11-19')).toThrow('consegna')
 expect(setVehicleScheduleDates(next,'v','','').vehicles[0].scheduledStartDate).toBeUndefined()
})
