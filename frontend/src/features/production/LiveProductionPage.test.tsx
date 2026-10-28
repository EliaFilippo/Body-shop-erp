import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LiveProductionPage } from './LiveProductionPage'

const mocked = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../services/cloudAuth', () => ({
  getCloudAuthConfig: () => ({ url: 'https://example.test', anonKey: 'public' }), signInWithPassword: vi.fn(), signOutCloud: vi.fn(),
}))
vi.mock('../../services/liveProduction', async original => ({ ...await original<typeof import('../../services/liveProduction')>(),
  productionRpc: mocked.rpc, refreshProductionSession: vi.fn(async session => session),
}))
vi.mock('../../services/cloudSync', () => ({ loadCloudSnapshot: vi.fn(async () => ({ revision: 1, payload: { plannerSettings: { operators: [{ id: 's', name: 'Stefania', active: true }] }, jobs: [] } })) }))
beforeEach(() => {
  sessionStorage.setItem('body-shop-erp.cloud-session.v1', JSON.stringify({ accessToken: 'token', refreshToken: 'refresh', userId: 'u1', email: 'test@example.test', expiresIn: 3600 }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ company_id: 'c1', role: 'production' }]))))
  mocked.rpc.mockReset()
})
afterEach(() => { cleanup();localStorage.clear();history.replaceState(null,'','/'); sessionStorage.clear(); vi.unstubAllGlobals() })

describe('profilo tablet', () => {
  it('shows tasks, personal hours and the identity of the phase signer before advancing to the next phase', async () => {
    let checked = false
    mocked.rpc.mockImplementation(async (name: string) => {
    if (name === 'production_productivity_report') return {alerts:[],operators:[],teams:[]}
    if (name === 'production_staff_hours') return []
    if (name === 'production_control_report') return {alerts:[],operators:[],teams:[]}
      if (name === 'production_phase_notices_action') return []
      if (name === 'production_complete_phase') { checked = true; return null }
      return { companyId: 'c1', role: 'production', operatorName: 'Mario', serverNow: new Date().toISOString(), members: [],
        today: { operatorId: 'a', name: 'Mario', serverNow: '', from: '2026-10-03', to: '2026-10-03', workedSeconds: 28860, ordinarySeconds: 28800, extraSeconds: 60, unconfigured: false,
          days: [{ date: '2026-10-03', workedSeconds: 28860, plannedSeconds: 28800, ordinarySeconds: 28800, extraSeconds: 60, running: false }] },
        jobs: [{ jobId: 'j1', coneNumber:12, plate: 'AA123BB', number: '1', remainingSeconds: 600, ownRemainingSeconds: 900, ownBurnFactor: 1.5, remainingPercent: 25, activeCount: checked ? 0 : 1,
          ownStatus: checked ? 'finished' : 'running', ownPhaseId: 'p1', operators: [], tasks: [{ id: 'l1', description: 'Porta da verniciare', quantity: 1 }],
          phases: [{ id: 'p1', name: 'Preparazione', notRequired: false, status: checked ? 'Completata' : 'In lavorazione', canComplete: true, checkedBy: checked ? 'Mario' : null, checkedAt: checked ? '2026-10-03T10:00:00Z' : null },
            { id: 'p2', name: 'Verniciatura', notRequired: false, status: 'Da fare', canComplete: false, checkedBy: null, checkedAt: null }],
        }] }
    })
    render(<LiveProductionPage />)
    await screen.findByText('Porta da verniciare')
    expect(screen.getByLabelText('Cono 12')).toHaveTextContent('12')
    expect(screen.getByText('Le mie ore di oggi')).toBeInTheDocument()
    expect(screen.getByText('0h 01m')).toBeInTheDocument()
    expect(screen.getByLabelText('Tempo residuo condiviso').textContent).toMatch(/^0:14:|^0:15:/)
    fireEvent.click(screen.getByRole('button', { name: '✓ Completa Preparazione' }))
    await screen.findByText(/Visto di Mario/)
    expect(screen.getByLabelText('Fase da lavorare su AA123BB')).toHaveValue('p2')
    expect(screen.queryByText('Profili dipendenti · monte ore')).not.toBeInTheDocument()
    expect(screen.queryByRole('link',{name:'Gestionale'})).not.toBeInTheDocument()
    expect(screen.queryByText('Accessi tablet con PIN')).not.toBeInTheDocument()
  })
  it('shows a shared low-budget clock and pauses only the authenticated operator', async () => {
    let paused = false
    mocked.rpc.mockImplementation(async (name: string) => {
    if (name === 'production_productivity_report') return {alerts:[],operators:[],teams:[]}
    if (name === 'production_staff_hours') return []
    if (name === 'production_control_report') return {alerts:[],operators:[],teams:[]}
      if (name === 'production_phase_notices_action') return []
      if (name === 'production_timer_action') { paused = true; return null }
      return { companyId: 'c1', role: 'production', operatorName: 'Mario', serverNow: new Date().toISOString(), members: [], jobs: [{
        jobId: 'j1', plate: 'AA123BB', number: '1', remainingSeconds: 600, remainingPercent: 19, activeCount: paused ? 1 : 2,
        ownStatus: paused ? 'paused' : 'running', operators: [{ name: 'Mario', status: paused ? 'paused' : 'running' }, { name: 'Luca', status: 'running' }],
      }] }
    })
    render(<LiveProductionPage />)
    await screen.findByText('AA123BB')
    expect(screen.getByText(/Tempo residuo con 2 operatori attivi/)).toBeInTheDocument()
    expect(screen.getByText(/rimane meno del 20%/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Pausa$/ }))
    await waitFor(() => expect(mocked.rpc).toHaveBeenCalledWith('production_timer_action', { p_company_id: 'c1', p_job_id: 'j1', p_action: 'pause' }, expect.objectContaining({ userId: 'u1' }), expect.anything()))
    await screen.findByText(/Tempo residuo con 1 operatori attivi/)
    expect(screen.getByText(/Mario: in pausa · Luca: al lavoro/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Riprendi' })).toBeEnabled()
  })
})

it('allows the owner to clear the operator binding and displays the saved result', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ company_id: 'c1', role: 'owner' }]))))
  let bound = true
  mocked.rpc.mockImplementation(async (name: string) => {
    if (name === 'production_productivity_report') return {alerts:[],operators:[],teams:[]}
    if (name === 'production_staff_hours') return []
    if (name === 'production_control_report') return {alerts:[],operators:[],teams:[]}
    if (name === 'production_unbind_profile') { bound = false; return null }
    return { companyId: 'c1', role: 'owner', operatorName: null, serverNow: new Date().toISOString(), jobs: [], members: [{ userId: 'u1', name: 'Filippo Elia', operatorId: bound ? 's' : null }], staff: [] }
  })
  render(<LiveProductionPage />)
  const select = await screen.findByLabelText('Operatore per Filippo Elia')
  expect(select).toHaveValue('s')
  fireEvent.change(select, { target: { value: '' } })
  await waitFor(() => expect(select).toHaveValue(''))
  expect(mocked.rpc).toHaveBeenCalledWith('production_unbind_profile', { p_company_id: 'c1', p_user_id: 'u1' }, expect.anything(), expect.anything())
})

it('shows the selected phase countdown separately from the whole vehicle', async () => {
  mocked.rpc.mockImplementation(async (name: string) => {
    if (name === 'production_productivity_report') return {alerts:[],operators:[],teams:[]}
    if (name === 'production_staff_hours') return []
    if (name === 'production_control_report') return {alerts:[],operators:[],teams:[]}
    if (name === 'production_phase_notices_action') return []
    return { companyId: 'c1', role: 'production', operatorName: 'Mario', serverNow: new Date().toISOString(), members: [], jobs: [{
      jobId: 'j1', plate: 'PHASE123', number: '1', remainingSeconds: 1800, ownRemainingSeconds: 1800, ownBurnFactor: 0, remainingPercent: 100, activeCount: 0, ownStatus: null, operators: [],
      phases: [300, 1200].map((seconds, i) => ({ id: `p${i}`, name: i ? 'Verniciatura' : 'Preparazione', notRequired: false, status: 'Da fare', canComplete: false, checkedBy: null, checkedAt: null,
        clock: { remainingSeconds: seconds, ownRemainingSeconds: seconds, ownBurnFactor: 0, remainingPercent: 100, activeCount: 0 } })),
    }] }
  })
  render(<LiveProductionPage />)
  await screen.findByText('PHASE123')
  expect(screen.getByLabelText('Tempo residuo condiviso')).toHaveTextContent('0:05:00')
  expect(screen.getByText('Residuo complessivo vettura: 0:30:00')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Fase da lavorare su PHASE123'), { target: { value: 'p1' } })
  expect(screen.getByLabelText('Tempo residuo condiviso')).toHaveTextContent('0:20:00')
})

it('keeps the shared standard allowance distinct from the economic countdown with two colleagues', async () => {
  mocked.rpc.mockImplementation(async (name: string) => {
    if (name === 'production_productivity_report') return {alerts:[],operators:[],teams:[]}
    if (name === 'production_staff_hours') return []
    if (name === 'production_control_report') return {alerts:[],operators:[],teams:[]}
    if(name==='production_phase_notices_action')return []
    return {companyId:'c1',role:'production',operatorName:'Stefania',serverNow:new Date().toISOString(),members:[],jobs:[{
      jobId:'j1',plate:'SHARED01',number:'1',remainingSeconds:3600,remainingPercent:100,activeCount:2,ownStatus:'running',ownPhaseId:'s',operators:[{name:'Stefania',status:'running'},{name:'Martin',status:'running'}],
      phases:[{id:'s',name:'Smontaggio',status:'Da fare',notRequired:false,canComplete:false,checkedBy:null,checkedAt:null,
        clock:{remainingSeconds:1800,ownRemainingSeconds:2400,ownBurnFactor:0,remainingPercent:80,activeCount:2},
        standardClock:{label:'Smontaggio / rimontaggio',totalMinutes:90,remainingSeconds:600,ownRemainingSeconds:1200,ownBurnFactor:0,remainingPercent:22,activeCount:2}}],
    }]}
  })
  render(<LiveProductionPage />)
  const standard=await screen.findByLabelText('Tempo standard della lavorazione')
  expect(standard).toHaveTextContent('Smontaggio / rimontaggio')
  expect(screen.getByLabelText('Tempo residuo condiviso')).toHaveTextContent('0:20:00')
  expect(standard).toHaveTextContent('Totale condiviso: 90 min')
  expect(screen.getByText('Residuo economico della fase: 0:40:00')).toBeInTheDocument()
  expect(screen.getByText(/Stefania: al lavoro · Martin: al lavoro/)).toBeInTheDocument()
})

it('shows the remaining washing standard on a paused legacy job without blaming a missing rate', async () => {
 mocked.rpc.mockImplementation(async (name:string)=> {
 if(name === 'production_control_report') return {alerts:[],operators:[],teams:[]}
  if(name==='production_phase_notices_action')return []
  return {companyId:'c1',role:'production',operatorName:'Stefania',serverNow:new Date().toISOString(),members:[],jobs:[{
   jobId:'j1',plate:'HFIEJI',number:'COMM-00001',remainingSeconds:3600,remainingPercent:100,activeCount:0,ownStatus:'paused',ownPhaseId:'wash',operators:[{name:'Stefania',status:'paused'}],
   phases:[{id:'wash',name:'Lavaggio esterno',status:'Da fare',notRequired:false,canComplete:true,checkedBy:null,checkedAt:null,
    clock:{remainingSeconds:null,ownRemainingSeconds:null,ownBurnFactor:0,remainingPercent:100,activeCount:0},
    standardClock:{label:'Lavaggio esterno',totalMinutes:25,remainingSeconds:900,ownRemainingSeconds:900,ownBurnFactor:0,remainingPercent:60,activeCount:0}}],
  }]}
 })
 render(<LiveProductionPage />)
 await screen.findByText('HFIEJI')
 expect(screen.getByLabelText('Tempo residuo condiviso')).toHaveTextContent('0:15:00')
 expect(screen.getByLabelText('Tempo standard della lavorazione')).toHaveTextContent('Totale condiviso: 25 min')
 expect(screen.queryByText(/costo operatore mancante/)).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Riprendi'})).toBeEnabled()
})

it('shows the selected front and rear bumper as individual work items on legacy jobs', async () => {
 mocked.rpc.mockImplementation(async (name:string)=> {
 if(name === 'production_control_report') return {alerts:[],operators:[],teams:[]}
  if(name==='production_phase_notices_action')return []
  return {companyId:'c1',role:'production',operatorName:'Stefania',serverNow:new Date().toISOString(),members:[],jobs:[{
   jobId:'j1',plate:'PANEL01',number:'1',remainingSeconds:3600,remainingPercent:100,activeCount:0,ownStatus:null,operators:[],
   tasks:[{id:'f',description:'½ paraurti anteriore/posteriore · Paraurti anteriore (lieve)',panel:'Paraurti anteriore',quantity:1},
          {id:'r',description:'½ paraurti anteriore/posteriore · Paraurti posteriore (lieve)',panel:'Paraurti posteriore',quantity:1}],
  }]}
 })
 render(<LiveProductionPage />)
 await screen.findByText('PANEL01')
 expect(screen.getByText('½ paraurti anteriore (lieve)')).toBeInTheDocument()
 expect(screen.getByText('½ paraurti posteriore (lieve)')).toBeInTheDocument()
 expect(screen.queryByText(/½ paraurti anteriore\/posteriore/)).not.toBeInTheDocument()
})

it('colora l’intera pagina al 20% della fase attiva e spegne l’avviso quando Stefania mette in pausa',async()=>{
 let paused=false
 mocked.rpc.mockImplementation(async(name:string)=>{
 if(name === 'production_control_report') return {alerts:[],operators:[],teams:[]}
  if(name==='production_phase_notices_action')return []
  if(name==='production_timer_action'){paused=true;return null}
  return {companyId:'c1',role:'production',operatorName:'Stefania',serverNow:new Date().toISOString(),members:[],jobs:[{
   jobId:'j1',plate:'WASH25',number:'COMM-1',remainingSeconds:3600,remainingPercent:100,activeCount:paused?0:1,ownStatus:paused?'paused':'running',ownPhaseId:'wash',operators:[{name:'Stefania',status:paused?'paused':'running'}],
   phases:[{id:'wash',name:'Lavaggio esterno',status:'Da fare',notRequired:false,canComplete:true,checkedBy:null,checkedAt:null,
    standardClock:{label:'Lavaggio esterno',totalMinutes:25,remainingSeconds:300,ownRemainingSeconds:300,ownBurnFactor:0,remainingPercent:20,activeCount:paused?0:1}}]
  }]}
 })
 render(<LiveProductionPage/>)
 await screen.findByText('ATTENZIONE: TEMPO RESIDUO AL 20% O MENO')
 expect(screen.getByRole('main')).toHaveClass('live-time-alert-screen')
 fireEvent.click(screen.getByRole('button',{name:'Pausa'}))
 await waitFor(()=>expect(screen.getByRole('main')).not.toHaveClass('live-time-alert-screen'))
 expect(screen.queryByText('ATTENZIONE: TEMPO RESIDUO AL 20% O MENO')).not.toBeInTheDocument()
})

it('shows only permitted phases and keeps Start disabled on a revoked paused card', async () => {
 mocked.rpc.mockImplementation(async (name: string) => {
  if(name==='production_phase_notices_action') return []
  return {companyId:'c1',role:'production',operatorName:'Stefania',serverNow:new Date().toISOString(),members:[],jobs:[{
   jobId:'j1',plate:'REVOKED',number:'1',remainingSeconds:3600,remainingPercent:100,activeCount:0,ownStatus:'paused',ownPhaseId:'s',dutiesFiltered:true,operators:[],phases:[]
  }]}
 })
 render(<LiveProductionPage />)
 await screen.findByText('REVOKED')
 expect(screen.getByRole('button',{name:'Riprendi'})).toBeDisabled()
 expect(screen.getByRole('button',{name:'Fine'})).toBeEnabled()
 expect(screen.queryByRole('option',{name:'Smontaggio'})).not.toBeInTheDocument()
})

it('mette in pausa la vettura con PULIZIE e permette il passaggio diretto alla ripresa',async()=>{
 let active=false
 mocked.rpc.mockImplementation(async(name:string)=>{
  if(name==='production_activity_action'){active=true;return null}
  if(name==='production_phase_notices_action')return []
  return {companyId:'c1',role:'production',operatorName:'Mario',serverNow:new Date().toISOString(),members:[],
   activity:{kind:active?'cleaning':null,elapsedSeconds:0,cleaningSeconds:0,coffeeSeconds:0},
   jobs:[{jobId:'j1',plate:'CLEAN123',number:'1',remainingSeconds:600,remainingPercent:100,activeCount:active?0:1,ownStatus:active?'paused':'running',operators:[]}]}
 })
 render(<LiveProductionPage/>)
 fireEvent.click(await screen.findByRole('button',{name:'PULIZIE'}))
 await screen.findByText('PULIZIE IN CORSO')
 expect(mocked.rpc).toHaveBeenCalledWith('production_activity_action',{p_company_id:'c1',p_kind:'cleaning'},expect.anything(),expect.anything())
 expect(screen.getByRole('button',{name:'Riprendi'})).toBeEnabled()
 expect(screen.getByRole('button',{name:'TERMINA ATTIVITÀ'})).toBeEnabled()
})

it('riconosce il link personale aperto in una pagina di Produzione già caricata',async()=>{
 sessionStorage.clear()
 mocked.rpc.mockResolvedValue({companyId:'c1',role:'production',operatorName:null,serverNow:new Date().toISOString(),members:[],jobs:[]})
 render(<LiveProductionPage/>)
 await screen.findByRole('heading',{name:'Accedi al tuo profilo'})
 const fragment='#company=10000000-0000-0000-0000-000000000001&operator=davide&tablet='+'b'.repeat(64)
 history.replaceState(null,'','/production.html'+fragment)
 fireEvent(window,new HashChangeEvent('hashchange'))
 await screen.findByLabelText('PIN personale')
 expect(screen.getByRole('heading',{name:'Accesso operatore'})).toBeInTheDocument()
 expect(sessionStorage.getItem('body-shop-erp.cloud-session.v1')).toBeNull()
 // Opening a vehicle anchor must leave the paired login intact.
 history.replaceState(null,'','/production.html#vettura-test')
 fireEvent(window,new HashChangeEvent('hashchange'))
 expect(screen.getByLabelText('PIN personale')).toBeInTheDocument()
})

it('finds an unplanned vehicle by cone and switches without stopping a colleague or completing a phase',async()=>{
 mocked.rpc.mockImplementation(async(name:string)=>{
  if(name==='production_phase_notices_action')return []
  if(name==='production_start_selected_job')return null
  return {companyId:'c1',role:'production',operatorName:'Mario',serverNow:new Date().toISOString(),members:[],program:[],jobs:[
   {jobId:'j1',plate:'AA111AA',number:'1',coneNumber:1,remainingSeconds:600,remainingPercent:100,activeCount:1,ownStatus:'running',operators:[]},
   {jobId:'j2',plate:'BB222BB',number:'2',coneNumber:22,remainingSeconds:600,remainingPercent:100,activeCount:0,ownStatus:null,operators:[]},
  ]}
 })
 render(<LiveProductionPage/>)
 await screen.findByText('BB222BB')
 fireEvent.change(screen.getByLabelText('Cerca targa o cono'),{target:{value:'22'}})
 expect(screen.queryByText('AA111AA')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Passa a questa vettura'}))
 await waitFor(()=>expect(mocked.rpc).toHaveBeenCalledWith('production_start_selected_job',{p_company_id:'c1',p_job_id:'j2',p_phase_id:null},expect.anything(),expect.anything()))
 expect(mocked.rpc.mock.calls.some(c=>c[0]==='production_complete_phase')).toBe(false)
})

it.each(['Stefania','Federica','Davide'])('allows %s to start an unplanned car directly from cleaning',async operatorName=>{
 mocked.rpc.mockImplementation(async(name:string)=>{
  if(name==='production_phase_notices_action')return []
  if(name==='production_start_selected_job')return null
  return {companyId:'c1',role:'production',operatorName,serverNow:new Date().toISOString(),members:[],program:[],
   activity:{kind:'cleaning',elapsedSeconds:0,cleaningSeconds:0,coffeeSeconds:0},
   jobs:[{jobId:'free',plate:'OUT123',number:'1',remainingSeconds:600,remainingPercent:100,activeCount:0,ownStatus:null,operators:[],
    phases:[{id:'mask',name:'Incartatura',notRequired:false,status:'Da fare',canComplete:false}]}]}
 })
 render(<LiveProductionPage/>)
 await screen.findByText('OUT123')
 const start=screen.getByRole('button',{name:'Start'})
 expect(start).toBeEnabled()
 fireEvent.click(start)
 await waitFor(()=>expect(mocked.rpc).toHaveBeenCalledWith('production_start_selected_job',{p_company_id:'c1',p_job_id:'free',p_phase_id:'mask'},expect.anything(),expect.anything()))
})
it('explains why a car cannot start instead of hiding the phase constraint',async()=>{
 mocked.rpc.mockImplementation(async(name:string)=>{
  if(name==='production_phase_notices_action')return []
  return {companyId:'c1',role:'production',operatorName:'Stefania',serverNow:new Date().toISOString(),members:[],program:[],
   jobs:[{jobId:'blocked',plate:'WAIT123',number:'1',remainingSeconds:600,remainingPercent:100,activeCount:0,ownStatus:null,operators:[],
    phases:[{id:'unmask',name:'Scartatura',notRequired:false,status:'Bloccata',blockedReason:'Attesa asciugatura fino alle 10:30',canComplete:false}]}]}
 })
 render(<LiveProductionPage/>)
 await screen.findByText('WAIT123')
 expect(screen.getByRole('button',{name:'Start'})).toBeDisabled()
 expect(screen.getByText('Avvio non disponibile: Attesa asciugatura fino alle 10:30')).toBeInTheDocument()
})

it('distinguishes a colleague timer from own active work without enabling colleague stop controls',async()=>{
 mocked.rpc.mockImplementation(async(name:string)=>{
  if(name==='production_phase_notices_action')return []
  return {companyId:'c1',role:'production',operatorName:'Stefania',serverNow:new Date().toISOString(),members:[],jobs:[
   {jobId:'other',plate:'GR737FD',number:'1',coneNumber:1,remainingSeconds:600,remainingPercent:19,activeCount:1,ownStatus:'finished',operators:[{name:'Filippo',status:'running'}]},
   {jobId:'mine',plate:'GY419RX',number:'5',coneNumber:5,remainingSeconds:600,remainingPercent:100,activeCount:1,ownStatus:'running',operators:[{name:'Stefania',status:'running'}]}
  ]}
 })
 render(<LiveProductionPage/>)
 const other=await screen.findByLabelText('Stato del tuo timer su GR737FD')
 expect(other).toHaveTextContent('Il tuo timer non è attivo')
 expect(other).toHaveTextContent('Filippo al lavoro')
 expect(other.closest('article')).not.toHaveClass('live-own','live-warning')
 const own=screen.getByLabelText('Stato del tuo timer su GY419RX')
 expect(own).toHaveTextContent('Il tuo timer è attivo')
 expect(own.closest('article')).toHaveClass('live-own')
 const otherCard=other.closest('article')!
 const buttons=Array.from(otherCard.querySelectorAll('button'))
 expect(buttons.find(b=>b.textContent==='Pausa')).toBeDisabled()
 expect(buttons.find(b=>b.textContent==='Fine')).toBeDisabled()
})

it('preserves automatic duties while manual mode selects blocked and completed phases',async()=>{
 mocked.rpc.mockImplementation(async(name:string)=>{
  if(name==='production_phase_notices_action')return []
  if(name==='production_manual_start')return null
  return {companyId:'c1',role:'production',operatorName:'Stefania',manualSelection:true,members:[],program:[],jobs:[{
   jobId:'manual',plate:'MANUAL',number:'1',manualStartAllowed:true,remainingSeconds:900,remainingPercent:100,activeCount:0,ownStatus:'finished',operators:[],
   phases:[{id:'blocked',name:'Lattoneria',status:'Bloccata',automaticAllowed:false,notRequired:false,canComplete:false},
    {id:'done',name:'Lucidatura',status:'Completata',automaticAllowed:false,notRequired:false,canComplete:false},
    {id:'delivery',name:'Consegna',status:'Da fare',automaticAllowed:false,notRequired:false,canComplete:false}]}]}
 })
 render(<LiveProductionPage/>);
 await screen.findByText('MANUAL')
 expect(screen.getByRole('button',{name:'Start'})).toBeDisabled()
 fireEvent.change(screen.getByLabelText('Modalità scelta lavoro'),{target:{value:'manual'}})
 const phases=screen.getByLabelText('Fase da lavorare su MANUAL')
 expect(phases).toHaveValue('blocked')
 expect(phases.querySelector('option[value="delivery"]')).toBeNull()
 fireEvent.change(phases,{target:{value:'done'}})
 expect(screen.getByText(/Intervento aggiuntivo: il visto precedente/)).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Avvia manualmente'}))
 await waitFor(()=>expect(mocked.rpc).toHaveBeenCalledWith('production_manual_start',{p_company_id:'c1',p_job_id:'manual',p_phase_id:'done'},expect.anything(),expect.anything()))
 await waitFor(()=>expect(screen.getByLabelText('Modalità scelta lavoro')).toBeEnabled())
 fireEvent.change(screen.getByLabelText('Modalità scelta lavoro'),{target:{value:'automatic'}})
 expect(screen.getByRole('button',{name:'Start'})).toBeDisabled()
 expect(mocked.rpc.mock.calls.some(c=>c[0]==='production_complete_phase')).toBe(false)
})


it('lets manual mode start an unquoted phase while the automatic option excludes it',async()=>{
 mocked.rpc.mockImplementation(async(name:string)=>{
  if(name==='production_phase_notices_action')return []
  if(name==='production_manual_start')return null
  return {companyId:'c1',role:'production',operatorName:'Stefania',manualSelection:true,members:[],program:[],jobs:[{
   jobId:'extra',plate:'EXTRA',number:'1',manualStartAllowed:true,remainingSeconds:900,remainingPercent:100,activeCount:0,ownStatus:null,operators:[],
   phases:[{id:'quoted',name:'Lattoneria',status:'Da fare',automaticAllowed:true,notRequired:false,canComplete:false},
    {id:'manual-phase:polishing',name:'Lucidatura',status:'Non prevista',automaticAllowed:false,notRequired:true,canComplete:false}]}]}
 })
 render(<LiveProductionPage/>);
 await screen.findByText('EXTRA')
 const select=screen.getByLabelText('Fase da lavorare su EXTRA')
 expect(select.querySelector('option[value="manual-phase:polishing"]')).toBeNull()
 fireEvent.change(screen.getByLabelText('Modalità scelta lavoro'),{target:{value:'manual'}})
 fireEvent.change(select,{target:{value:'manual-phase:polishing'}})
 expect(screen.getByText(/Fase non prevista nel preventivo: le ore effettive/)).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Avvia manualmente'}))
 await waitFor(()=>expect(mocked.rpc).toHaveBeenCalledWith('production_manual_start',{p_company_id:'c1',p_job_id:'extra',p_phase_id:'manual-phase:polishing'},expect.anything(),expect.anything()))
 expect(mocked.rpc.mock.calls.some(c=>c[0]==='production_complete_phase')).toBe(false)
})
