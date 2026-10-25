import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FinancePage } from './FinancePage'
import { emptyData } from '../../services/erp'
import type { ErpData } from '../../types'
const mock=vi.hoisted(()=>({login:vi.fn(),rpc:vi.fn()}))
vi.mock('../../services/cloudAuth',()=>({signInWithPassword:mock.login}))
vi.mock('../../services/liveProduction',async original=>({...await original<typeof import('../../services/liveProduction')>(),productionRpc:mock.rpc}))
afterEach(cleanup)
it('keeps confirmed quotes visible before unlock and after relocking modifications',async()=>{
 const data=structuredClone(emptyData)
 const quote={id:'q',number:'CONFIRMED-SECRET',customerId:'c',vehicleId:'v',lines:[],status:'accettato',issueDate:'2026-10-18',dueDate:'2026-11-18',taxableAmount:100,vatAmount:22,total:122} as unknown as NonNullable<ErpData['quotes']>[number]
 data.quotes=[quote,{...quote,id:'draft',number:'DRAFT-VISIBLE',status:'bozza'}]
 const session={accessToken:'old',refreshToken:'r',expiresIn:3600,userId:'owner',email:'owner@example.test'}
 mock.login.mockResolvedValue({...session,accessToken:'verified'});mock.rpc.mockResolvedValue({ok:true})
 render(<FinancePage data={data} onChange={vi.fn()} customerById={()=>undefined} setError={vi.fn()} setNotice={vi.fn()} passwordConnection={{companyId:'c',session,config:{url:'https://example.test',anonKey:'key'}}} />)
 expect(screen.getByText('CONFIRMED-SECRET')).toBeInTheDocument()
 expect(screen.getByText('DRAFT-VISIBLE')).toBeInTheDocument()
 fireEvent.change(screen.getByLabelText('Password dei blocchi'),{target:{value:'test-password'}})
 fireEvent.click(screen.getByText('Sblocca con password'))
 expect(await screen.findByText('CONFIRMED-SECRET')).toBeInTheDocument()
 fireEvent.click(screen.getByText('Blocca'))
 expect(screen.getByText('CONFIRMED-SECRET')).toBeInTheDocument()
})
