import { fireEvent,render,screen } from '@testing-library/react'
import { describe,it,expect,vi } from 'vitest'
import { emptyData } from '../../services/erp'
import { downloadEstimatePdf,estimatePdfFile } from '../../services/estimatePdf'
vi.mock('../../services/estimatePdf',()=>({estimatePdfFile:vi.fn(()=>new File(['pdf'],'AB123CD.pdf',{type:'application/pdf'})),downloadEstimatePdf:vi.fn()}))
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
  expect(url.searchParams.get('text')).toContain('in allegato il preventivo')
  expect(url.searchParams.get('text')).not.toContain('margine')
  expect(estimatePdfFile).toHaveBeenCalled()
  expect(downloadEstimatePdf).toHaveBeenCalledWith(expect.objectContaining({name:'AB123CD.pdf'}))
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

describe('righe libere nel preventivo fast',()=>{
 const fillCustomer=()=>{
  fireEvent.change(screen.getByLabelText('Targa'),{target:{value:'AB123CD'}})
  fireEvent.change(screen.getByLabelText('Cliente'),{target:{value:'new'}})
  fireEvent.change(screen.getByLabelText('Nome nuovo cliente'),{target:{value:'Mario Rossi'}})
  fireEvent.change(screen.getByLabelText('Telefono nuovo cliente'),{target:{value:'3331234567'}})
 }
 it('modifica il testo della riga di listino conservando tempario e pannello',()=>{
  const done=vi.fn();render(<FastEstimateEditor data={structuredClone(emptyData)} onDone={done} onCancel={()=>{}}/>)
  fillCustomer()
  fireEvent.change(screen.getByLabelText('Pannello'),{target:{value:'porta-ant-sx'}})
  fireEvent.click(screen.getByRole('button',{name:/^Porta anteriore SX ·/}))
  fireEvent.change(screen.getByLabelText('Descrizione riga 1'),{target:{value:'Ripristino graffio porta sinistra'}})
  fireEvent.click(screen.getByRole('button',{name:'Salva preventivo fast'}))
  const next=done.mock.calls[0][0]
  expect(next.estimates[0].lines[0]).toMatchObject({description:'Ripristino graffio porta sinistra',estimatedMinutes:180,panelId:'porta-ant-sx'})
  expect(next.quotes[0].lines[0].description).toBe('Ripristino graffio porta sinistra')
 })
 it('salva e conferma una riga manuale con prezzo e tempo sulla fase selezionata',()=>{
  const done=vi.fn();render(<FastEstimateEditor data={structuredClone(emptyData)} onDone={done} onCancel={()=>{}}/>)
  fillCustomer()
  fireEvent.click(screen.getByRole('button',{name:'+ Aggiungi lavorazione manuale'}))
  expect(screen.getByRole('button',{name:'Salva preventivo fast'})).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Descrizione riga 1'),{target:{value:'Ripristino supporto personalizzato'}})
  fireEvent.change(screen.getByLabelText('Fase riga 1'),{target:{value:'Lattoneria'}})
  fireEvent.change(screen.getByLabelText('Prezzo riga 1 €'),{target:{value:'125'}})
  fireEvent.change(screen.getByLabelText('Minuti riga 1'),{target:{value:'45'}})
  expect(screen.getByLabelText('Riepilogo preventivo fast')).toHaveTextContent('45 min')
  fireEvent.click(screen.getByLabelText('Il cliente ha già confermato questo preventivo'))
  fireEvent.click(screen.getByRole('button',{name:'Conferma e crea commessa'}))
  expect(done).toHaveBeenCalledOnce()
  const next=done.mock.calls[0][0]
  expect(next.estimates[0].lines[0]).toMatchObject({description:'Ripristino supporto personalizzato',estimatedMinutes:45,unitPrice:125})
  expect(next.estimates[0].total).toBe(152.5)
  expect(next.jobs[0].phases.find((phase:{name:string})=>phase.name==='Lattoneria')).toMatchObject({notRequired:false,estimatedMinutes:45})
  expect(next.quotes[0].lines[0].description).toBe('Ripristino supporto personalizzato')
 })
})

it('permette più tempi sotto lo stesso prezzo nella riga manuale',()=>{
 const done=vi.fn();render(<FastEstimateEditor data={structuredClone(emptyData)} onDone={done} onCancel={()=>{}}/>)
 fireEvent.change(screen.getByLabelText('Targa'),{target:{value:'AB123CD'}})
 fireEvent.change(screen.getByLabelText('Cliente'),{target:{value:'new'}})
 fireEvent.change(screen.getByLabelText('Nome nuovo cliente'),{target:{value:'Mario Rossi'}})
 fireEvent.change(screen.getByLabelText('Telefono nuovo cliente'),{target:{value:'3331234567'}})
 fireEvent.click(screen.getByRole('button',{name:'+ Aggiungi lavorazione manuale'}))
 fireEvent.change(screen.getByLabelText('Descrizione riga 1'),{target:{value:'Verniciatura paraurti'}})
 fireEvent.change(screen.getByLabelText('Fase riga 1'),{target:{value:'Verniciatura'}})
 fireEvent.change(screen.getByLabelText('Minuti riga 1'),{target:{value:'60'}})
 fireEvent.change(screen.getByLabelText('Prezzo riga 1 €'),{target:{value:'185'}})
 fireEvent.click(screen.getByRole('button',{name:'+ Aggiungi fase riga 1'}))
 expect(screen.getByRole('button',{name:'Salva preventivo fast'})).toBeDisabled()
 fireEvent.change(screen.getByLabelText('Fase 2 riga 1'),{target:{value:'Incartatura'}})
 fireEvent.change(screen.getByLabelText('Minuti fase 2 riga 1'),{target:{value:'20'}})
 fireEvent.click(screen.getByRole('button',{name:'+ Aggiungi fase riga 1'}))
 fireEvent.change(screen.getByLabelText('Fase 3 riga 1'),{target:{value:'Scartatura'}})
 fireEvent.change(screen.getByLabelText('Minuti fase 3 riga 1'),{target:{value:'10'}})
 expect(screen.getByLabelText('Riepilogo preventivo fast')).toHaveTextContent('90 min')
 fireEvent.click(screen.getByRole('button',{name:'Salva preventivo fast'}))
 expect(done.mock.calls[0][0].estimates[0].lines[0]).toMatchObject({unitPrice:185,estimatedMinutes:90,manualPhaseTimes:[{phase:'Verniciatura',minutes:60},{phase:'Incartatura',minutes:20},{phase:'Scartatura',minutes:10}]})
})

it('mostra il confronto economico prima della conferma e lo aggiorna cambiando prezzo e tempi',()=>{
 const data=structuredClone(emptyData)
 data.plannerSettings.monthlyRevenueGoal=25000
 data.plannerSettings.internalCostSettings={...data.plannerSettings.internalCostSettings!,usePlannerCapacity:false,budgetMaterialsPercent:20,
 monthlyCostItems:[{id:'p',category:'personale',description:'Personale',monthlyAmount:4000,active:true},{id:'s',category:'affitto',description:'Struttura',monthlyAmount:6000,active:true}],
 productiveCapacity:{productiveOperators:2,hoursPerOperatorPerDay:8,workingDaysPerMonth:20,efficiencyPercent:62.5}}
 const done=vi.fn()
 render(<FastEstimateEditor data={data} onDone={done} onCancel={()=>{}}/>)
 fireEvent.click(screen.getByRole('button',{name:'+ Aggiungi lavorazione manuale'}))
 fireEvent.change(screen.getByLabelText('Descrizione riga 1'),{target:{value:'Ripristino personalizzato'}})
 fireEvent.change(screen.getByLabelText('Fase riga 1'),{target:{value:'Verniciatura'}})
 fireEvent.change(screen.getByLabelText('Minuti riga 1'),{target:{value:'120'}})
 fireEvent.change(screen.getByLabelText('Prezzo riga 1 €'),{target:{value:'200'}})
 const preview=screen.getByLabelText('Convenienza del preventivo')
 expect(preview).toHaveTextContent('100,00')
 expect(preview).toHaveTextContent('125,00')
 expect(preview).toHaveTextContent('IN GUADAGNO · sotto l’obiettivo orario')
 fireEvent.change(screen.getByLabelText('Prezzo riga 1 €'),{target:{value:'50'}})
 expect(preview).toHaveTextContent('SOTTOCOSTO')
 fireEvent.change(screen.getByLabelText('Minuti riga 1'),{target:{value:'15'}})
 expect(preview).toHaveTextContent('IN GUADAGNO · obiettivo orario raggiunto')
 expect(done).not.toHaveBeenCalled()
})
