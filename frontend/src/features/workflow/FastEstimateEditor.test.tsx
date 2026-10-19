import { fireEvent,render,screen } from '@testing-library/react'
import { describe,it,expect,vi } from 'vitest'
import { emptyData } from '../../services/erp'
import { FastEstimateEditor } from './FastEstimateEditor'
describe('percorso fast in ufficio',()=>{
 it('bastano targa, cliente, pezzo e lavorazione per salvare un preventivo',()=>{
  const data=structuredClone(emptyData)
  data.customers=[{id:'c',name:'Mario Rossi',phone:'333',type:'Privato',email:'',taxId:'',address:'',createdAt:''}]
  const done=vi.fn();render(<FastEstimateEditor data={data} onDone={done} onCancel={()=>{}}/>)
  fireEvent.change(screen.getByLabelText('Targa'),{target:{value:'AB123CD'}})
  fireEvent.change(screen.getByLabelText('Cliente'),{target:{value:'c'}})
  fireEvent.change(screen.getByLabelText('Pannello'),{target:{value:'porta-ant-sx'}})
  fireEvent.click(screen.getByRole('button',{name:/^Porta anteriore SX ·/}))
  expect(screen.getByLabelText('Riepilogo preventivo fast')).toHaveTextContent('180 min')
  fireEvent.click(screen.getByRole('button',{name:'Salva preventivo fast'}))
  expect(done).toHaveBeenCalledOnce()
  const [next,confirmed]=done.mock.calls[0]
  expect(confirmed).toBe(false);expect(next.estimates).toHaveLength(1);expect(next.jobs||[]).toHaveLength(0)
 })
 it('solo la spunta cliente confermato abilita la creazione della commessa',()=>{
  const data=structuredClone(emptyData)
  const done=vi.fn();render(<FastEstimateEditor data={data} onDone={done} onCancel={()=>{}}/>)
  fireEvent.change(screen.getByLabelText('Targa'),{target:{value:'AB123CD'}})
  fireEvent.change(screen.getByLabelText('Cliente'),{target:{value:'new'}})
  fireEvent.change(screen.getByLabelText('Nome nuovo cliente'),{target:{value:'Mario Rossi'}})
  fireEvent.change(screen.getByLabelText('Telefono nuovo cliente'),{target:{value:'3331234567'}})
  fireEvent.change(screen.getByLabelText('Pannello'),{target:{value:'porta-ant-sx'}})
  fireEvent.click(screen.getByRole('button',{name:/^Porta anteriore SX ·/}))
  fireEvent.click(screen.getByLabelText('Il cliente ha già confermato questo preventivo'))
  fireEvent.click(screen.getByRole('button',{name:'Conferma e crea commessa'}))
  expect(done.mock.calls[0][0].jobs).toHaveLength(1)
 })
 it('apre WhatsApp Web al cliente senza approvare automaticamente il preventivo',()=>{
  const data=structuredClone(emptyData)
  data.customers=[{id:'c',name:'Mario Rossi',phone:'3331234567',type:'Privato',email:'',taxId:'',address:'',createdAt:''}]
  const chat={opener:{},location:{href:''},close:vi.fn()}
  const open=vi.spyOn(window,'open').mockReturnValue(chat as unknown as Window)
  const done=vi.fn();render(<FastEstimateEditor data={data} onDone={done} onCancel={()=>{}}/>)
  fireEvent.change(screen.getByLabelText('Targa'),{target:{value:'AB123CD'}})
  fireEvent.change(screen.getByLabelText('Cliente'),{target:{value:'c'}})
  fireEvent.change(screen.getByLabelText('Pannello'),{target:{value:'porta-ant-sx'}})
  fireEvent.click(screen.getByRole('button',{name:/^Porta anteriore SX ·/}))
  fireEvent.click(screen.getByRole('button',{name:'Salva e invia su WhatsApp'}))
  expect(done).toHaveBeenCalledOnce()
  expect(done.mock.calls[0][1]).toBe(false)
  expect(done.mock.calls[0][0].estimates[0].status).toBe('Bozza')
  const url=new URL(chat.location.href)
  expect(url.hostname).toBe('web.whatsapp.com')
  expect(url.searchParams.get('phone')).toBe('393331234567')
  expect(url.searchParams.get('text')).toContain('Totale IVA inclusa:')
  expect(url.searchParams.get('text')).not.toContain('margine')
  open.mockRestore()
 })
 it('numero mancante impedisce apertura e salvataggio parziale',()=>{
  const data=structuredClone(emptyData)
  data.customers=[{id:'c',name:'Mario Rossi',phone:'',type:'Privato',email:'',taxId:'',address:'',createdAt:''}]
  const done=vi.fn();render(<FastEstimateEditor data={data} onDone={done} onCancel={()=>{}}/>)
  fireEvent.change(screen.getByLabelText('Targa'),{target:{value:'AB123CD'}})
  fireEvent.change(screen.getByLabelText('Cliente'),{target:{value:'c'}})
  fireEvent.change(screen.getByLabelText('Pannello'),{target:{value:'porta-ant-sx'}})
  fireEvent.click(screen.getByRole('button',{name:/^Porta anteriore SX ·/}))
  fireEvent.click(screen.getByRole('button',{name:'Salva e invia su WhatsApp'}))
  expect(done).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('numero WhatsApp valido')
 })

})
