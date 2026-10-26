import { act,fireEvent,render,screen,within } from '@testing-library/react'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { DailyEmployeeHours,type DailyHoursReport } from './DailyEmployeeHours'
import { productionRpc } from '../../services/liveProduction'
import type { NoticesConnection } from './PhaseNotices'
vi.mock('../../services/liveProduction',()=>({productionRpc:vi.fn()}))
const connection={companyId:'company',session:{accessToken:'token'},config:{url:'https://example.test',anonKey:'key'}} as NoticesConnection
const report:DailyHoursReport={day:'2026-10-26',serverNow:'2026-10-26T10:00:00Z',canAdjust:true,jobs:[{id:'j',plate:'AA123BB',number:'COMM-1'}],operators:[{operatorId:'a',name:'Davide',vehicleSeconds:3600,cleaningSeconds:1800,coffeeSeconds:600,otherSeconds:0,totalSeconds:5400,ordinarySeconds:5400,extraSeconds:0,adjustments:[],entries:[{kind:'vehicle',jobId:'j',plate:'AA123BB',number:'COMM-1',phase:'Smontaggio',startedAt:'2026-10-26T08:00:00Z',endedAt:'2026-10-26T09:00:00Z',seconds:3600,running:false}]}]}
async function setup(value=report){vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));vi.mocked(productionRpc).mockResolvedValueOnce(value);render(<DailyEmployeeHours connection={connection}/>);await act(async()=>{});return within(screen.getByRole('article',{name:'Monte ore Davide'}))}
afterEach(()=>{vi.useRealTimers();vi.resetAllMocks()})
describe('daily employee hours',()=>{
 it('shows vehicle identity and includes cleaning in the working total with coffee separate',async()=>{
  const card=await setup()
  expect(card.getByText('AA123BB · COMM-1')).toBeInTheDocument()
  expect(card.getByText('Smontaggio')).toBeInTheDocument()
  expect(card.getByText('Totale lavorato').parentElement).toHaveTextContent('1 h 30 min')
  expect(card.getByText('Pulizie').parentElement).toHaveTextContent('0 h 30 min')
  expect(card.getByText(/Pausa caffè:/).textContent).toContain('0 h 10 min')
 })
 it('requires a password and reason, saves a signed correction and clears the password',async()=>{
  const card=await setup()
  vi.mocked(productionRpc).mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({...report,operators:[{...report.operators[0],cleaningSeconds:2700,totalSeconds:6300}]})
  fireEvent.click(card.getByText('Correggi ore con password'))
  fireEvent.change(card.getByLabelText('Attività da correggere'),{target:{value:'cleaning'}})
  fireEvent.change(card.getByLabelText('Operazione'),{target:{value:'remove'}})
  fireEvent.change(card.getByLabelText('Minuti da aggiungere o togliere'),{target:{value:'15'}})
  fireEvent.change(card.getByLabelText('Causale della rettifica'),{target:{value:'Timer lasciato attivo'}})
  fireEvent.change(card.getByLabelText('Password dei blocchi'),{target:{value:'test-password'}})
  await act(async()=>{fireEvent.click(card.getByRole('button',{name:'Salva rettifica protetta'}))})
  expect(productionRpc).toHaveBeenNthCalledWith(2,'production_private_password',expect.objectContaining({p_action:'unlock',p_password:'test-password'}),connection.session,connection.config)
  expect(productionRpc).toHaveBeenNthCalledWith(3,'production_adjust_hours',expect.objectContaining({p_delta_minutes:-15,p_reason:'Timer lasciato attivo',p_kind:'cleaning',p_job_id:null,p_request_id:expect.any(String)}),connection.session,connection.config)
  expect(card.getByLabelText('Password dei blocchi')).toHaveValue('')
  expect(card.getByText(/Rettifica salvata/)).toBeInTheDocument()
 })
 it('does not save when the password fails and never offers corrections to office readers',async()=>{
  const card=await setup()
  vi.mocked(productionRpc).mockResolvedValueOnce({ok:false,message:'Password non corretta'})
  fireEvent.click(card.getByText('Correggi ore con password'))
  fireEvent.change(card.getByLabelText('Attività da correggere'),{target:{value:'other'}})
  fireEvent.change(card.getByLabelText('Minuti da aggiungere o togliere'),{target:{value:'30'}})
  fireEvent.change(card.getByLabelText('Causale della rettifica'),{target:{value:'Lavoro non registrato'}})
  fireEvent.change(card.getByLabelText('Password dei blocchi'),{target:{value:'wrong'}})
  await act(async()=>{fireEvent.click(card.getByRole('button',{name:'Salva rettifica protetta'}))})
  expect(productionRpc).toHaveBeenCalledTimes(2)
  expect(card.getByText('Password non corretta')).toBeInTheDocument()
 })
 it('supports read-only office access without an edit password',async()=>{
  const card=await setup({...report,canAdjust:false})
  expect(card.queryByText('Correggi ore con password')).not.toBeInTheDocument()
  expect(card.getByText('Totale lavorato')).toBeInTheDocument()
 })
})
