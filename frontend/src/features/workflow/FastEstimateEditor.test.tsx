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
})
