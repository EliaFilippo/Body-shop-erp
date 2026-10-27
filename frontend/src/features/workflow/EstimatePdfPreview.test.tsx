import { fireEvent,render,screen } from '@testing-library/react'
import { describe,expect,it,vi } from 'vitest'
import { EstimatePdfPreview } from './EstimatePdfPreview'
import { downloadEstimatePdf } from '../../services/estimatePdf'
import { createEstimate } from '../../services/workflow'
import { emptyData } from '../../services/erp'
vi.mock('../../services/estimatePdf',()=>({estimatePdfFile:vi.fn(()=>new File(['pdf'],'GL587FB.pdf',{type:'application/pdf'})),downloadEstimatePdf:vi.fn()}))
describe('PDF preview and WhatsApp attachment preparation',()=>{
 it('downloads the PDF, opens the selected customer chat and leaves approval unchanged',()=>{
  let data=structuredClone(emptyData);data.customers=[{id:'c',name:'Cliente',type:'Privato',phone:'3331234567',email:'',address:'',taxId:'',createdAt:''}]
  data=createEstimate(data,{customerId:'c',plate:'GL587FB',companyName:'',contactName:'',date:'2026-10-27',notes:'',selectedPhases:[],lines:[{description:'Ripristino',category:'carrozzeria',quantity:1,unitPrice:100,discount:0,vatRate:22}]})
  const estimate=data.estimates![0],before=JSON.stringify(data),chat={opener:{},location:{href:''},close:vi.fn()}
  const open=vi.spyOn(window,'open').mockReturnValue(chat as unknown as Window)
  render(<EstimatePdfPreview data={data} estimate={estimate} onClose={()=>{}}/>)
  fireEvent.click(screen.getByRole('button',{name:'Scarica PDF e apri WhatsApp'}))
  expect(downloadEstimatePdf).toHaveBeenCalledWith(expect.objectContaining({name:'GL587FB.pdf'}))
  expect(new URL(chat.location.href).searchParams.get('phone')).toBe('393331234567')
  expect(screen.getByText(/PDF scaricato. Allegalo/)).toBeInTheDocument()
  expect(JSON.stringify(data)).toBe(before)
  open.mockRestore()
 })
})
