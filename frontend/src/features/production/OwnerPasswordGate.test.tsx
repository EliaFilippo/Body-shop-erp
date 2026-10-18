import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { OwnerPasswordGate } from './OwnerPasswordGate'
const mock=vi.hoisted(()=>({login:vi.fn(),rpc:vi.fn()}))
vi.mock('../../services/cloudAuth',()=>({signInWithPassword:mock.login}))
vi.mock('../../services/liveProduction',()=>({productionRpc:mock.rpc}))
const session={accessToken:'old',refreshToken:'r',expiresIn:3600,userId:'owner',email:'owner@example.test'}
const connection={companyId:'c',session,config:{url:'https://example.test',anonKey:'key'}}
afterEach(()=>{cleanup();vi.useRealTimers();mock.login.mockReset();mock.rpc.mockReset()})
it('requires password verification, never renders protected data before unlock and relocks after five minutes',async()=>{
 vi.useFakeTimers()
 mock.login.mockResolvedValue({...session,accessToken:'verified'});mock.rpc.mockResolvedValue(null)
 render(<OwnerPasswordGate connection={connection} title="Report">{s=><p>Privato {s.accessToken}</p>}</OwnerPasswordGate>)
 expect(screen.queryByText(/Privato/)).not.toBeInTheDocument()
 fireEvent.change(screen.getByLabelText('Password del titolare'),{target:{value:'test-password'}})
 await act(async()=>{fireEvent.click(screen.getByText('Sblocca con password'))})
 expect(screen.getByText('Privato verified')).toBeInTheDocument()
 expect(mock.rpc).toHaveBeenCalledWith('production_report_access',{p_company_id:'c'},expect.objectContaining({accessToken:'verified'}),connection.config)
 act(()=>{vi.advanceTimersByTime(301000)})
 expect(screen.queryByText(/Privato/)).not.toBeInTheDocument()
})
it('does not unlock on a wrong password',async()=>{
 mock.login.mockRejectedValue(new Error('Invalid login'))
 render(<OwnerPasswordGate connection={connection} title="Report">{()=> <p>Privato</p>}</OwnerPasswordGate>)
 fireEvent.change(screen.getByLabelText('Password del titolare'),{target:{value:'wrong'}})
 fireEvent.click(screen.getByText('Sblocca con password'))
 expect(await screen.findByRole('alert')).toHaveTextContent('Sblocco non riuscito')
 expect(screen.queryByText('Privato')).not.toBeInTheDocument()
 expect(screen.getByLabelText('Password del titolare')).toHaveValue('')
})

it('requires server owner approval even after a successful account login',async()=>{
 mock.login.mockResolvedValue({...session,accessToken:'verified'});mock.rpc.mockRejectedValue(new Error('Owner required'))
 render(<OwnerPasswordGate connection={connection} title="Report">{()=> <p>Privato</p>}</OwnerPasswordGate>)
 fireEvent.change(screen.getByLabelText('Password del titolare'),{target:{value:'office-password'}})
 fireEvent.click(screen.getByText('Sblocca con password'))
 expect(await screen.findByRole('alert')).toHaveTextContent('Sblocco non riuscito')
 expect(screen.queryByText('Privato')).not.toBeInTheDocument()
})
