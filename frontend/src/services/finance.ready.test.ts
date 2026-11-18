// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { vehicleReadyForInvoice } from './finance'
import { emptyData } from './erp'
import type { Vehicle, RepairJob } from '../types'
it('rende fatturabile la vettura pronta o con tutte le fasi complete prima della consegna',()=>{
 const data=structuredClone(emptyData)
 const vehicle={id:'v',plate:'TEST',status:'in-lavorazione'} as Vehicle
 data.jobs=[{id:'j',vehicleId:'v',status:'In lavorazione',phases:[{name:'Lavaggio esterno',status:'Completata',notRequired:false},{name:'Consegna',status:'Da fare'}]} as RepairJob]
 expect(vehicleReadyForInvoice(data,vehicle)).toBe(true)
 data.jobs[0].phases[0].status='In lavorazione'
 expect(vehicleReadyForInvoice(data,vehicle)).toBe(false)
 vehicle.status='pronta'
 expect(vehicleReadyForInvoice(data,vehicle)).toBe(true)
})
