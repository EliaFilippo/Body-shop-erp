import {act,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {RemoteTimers} from './RemoteTimers'
import {productionRpc} from '../../services/liveProduction'
import type {NoticesConnection} from './PhaseNotices'
vi.mock('../../services/liveProduction',()=>({productionRpc:vi.fn()}))
const connection={companyId:'company',session:{accessToken:'token'},config:{url:'https://example.test',anonKey:'key'}} as NoticesConnection
const report={serverNow:'2026-10-27T10:00:00Z',canStop:true,timers:[
 {key:'vehicle:9007199254740993',operatorId:'a',name:'Davide',kind:'vehicle',plate:'AA123BB',startedAt:'2026-10-26T08:00:00Z'},
 {key:'activity:uuid',operatorId:'b',name:'Stefania',kind:'cleaning',startedAt:'2026-10-27T08:00:00Z'}]}
afterEach(()=>{vi.useRealTimers();vi.resetAllMocks()})
async function setup(value=report){vi.useFakeTimers();vi.mocked(productionRpc).mockResolvedValueOnce(value);render(<RemoteTimers connection={connection} onBack={()=>{}}/>);await act(async()=>{})}
it('stops exactly the reviewed timer after unlocking, retaining full ID precision',async()=>{
 await setup()
 expect(screen.getByText('Pulizie')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Ferma timer di Davide'}))
 expect(screen.getByRole('button',{name:'Conferma stop dei timer selezionati'})).toBeDisabled()
 fireEvent.change(screen.getByLabelText('Password dei blocchi'),{target:{value:'secret-test'}})
 vi.mocked(productionRpc).mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({stoppedCount:1,report:{...report,timers:[report.timers[1]]}})
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Conferma stop dei timer selezionati'})))
 expect(productionRpc).toHaveBeenNthCalledWith(3,'production_stop_timers',{p_company_id:'company',p_keys:['vehicle:9007199254740993']},connection.session,connection.config)
 expect(screen.getByText(/Fermati 1 timer/)).toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Ferma timer di Stefania'})).toBeInTheDocument()
 expect(screen.queryByLabelText('Password dei blocchi')).not.toBeInTheDocument()
})
it('does not issue a stop on a wrong password',async()=>{
 await setup()
 fireEvent.click(screen.getByRole('button',{name:'Ferma tutti i timer visualizzati'}))
 fireEvent.change(screen.getByLabelText('Password dei blocchi'),{target:{value:'wrong'}})
 vi.mocked(productionRpc).mockResolvedValueOnce({ok:false,message:'Password errata'})
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Conferma stop dei timer selezionati'})))
 expect(productionRpc).toHaveBeenCalledTimes(2)
 expect(screen.getByRole('alert')).toHaveTextContent('Password errata')
 expect(screen.getByLabelText('Password dei blocchi')).toHaveValue('')
})
it('keeps office readers read only',async()=>{
 await setup({...report,canStop:false})
 expect(screen.queryByRole('button',{name:'Ferma tutti i timer visualizzati'})).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:'Ferma timer di Davide'})).not.toBeInTheDocument()
})
