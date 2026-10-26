import { fireEvent,render,screen,within } from '@testing-library/react'
import { describe,expect,it,vi } from 'vitest'
import { DeliveredJobReports } from './DeliveredJobReports'
import { emptyData } from '../../services/erp'
import { createEstimate,approveEstimateAndCreateJob } from '../../services/workflow'
const makeReportJob=()=>{
 let data=createEstimate(structuredClone(emptyData),{customerId:'c',plate:'TEST123',companyName:'',contactName:'',date:'2026-10-26',notes:'',selectedPhases:[],lines:[{description:'Riparazione',category:'carrozzeria',quantity:1,unitPrice:500,discount:0,vatRate:22,estimatedMinutes:120,internalHourlyRateUsed:30,budgetMaterialsCost:100}]})
 data=approveEstimateAndCreateJob(data,data.estimates![0].id)
 return {...data.jobs![0],status:'Consegnata' as const}
}
describe('delivered vehicle report page',()=>{
 it('shows only delivered cars, searches plates and exposes materials without opening the work editor',()=>{
  const job=makeReportJob()
  const onSave=vi.fn(),onBack=vi.fn()
  render(<DeliveredJobReports jobs={[job,{...job,id:'open',plate:'OPEN',status:'In lavorazione'}]} customerById={()=>undefined} onBack={onBack} onSaveMaterials={onSave}/>)
  const report=screen.getByRole('article',{name:`Report TEST123 ${job.number}`})
  expect(within(report).getByText('Ore lavorate registrate')).toBeInTheDocument()
  expect(within(report).getByText('Materiali reali')).toBeInTheDocument()
  expect(screen.queryByText('OPEN')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Cerca vettura consegnata'),{target:{value:'missing'}})
  expect(screen.getByText('Nessuna vettura corrisponde alla ricerca.')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Cerca vettura consegnata'),{target:{value:'TEST123'}})
  fireEvent.click(screen.getByText('Inserisci materiali reali'))
  const field=screen.getByLabelText('Totale materiali effettivi · IVA esclusa')
  fireEvent.change(field,{target:{value:'80'}})
  fireEvent.click(screen.getByRole('button',{name:'Salva costo reale materiali'}))
  expect(onSave).toHaveBeenCalledWith(job.id,80,'')
  fireEvent.click(screen.getByRole('button',{name:/Torna a Preventivi/}))
  expect(onBack).toHaveBeenCalledOnce()
 })
})
