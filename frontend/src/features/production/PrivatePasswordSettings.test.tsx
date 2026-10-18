import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PrivatePasswordSettings } from './PrivatePasswordSettings'
const mock=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../services/liveProduction',()=>({productionRpc:mock.rpc}))
const connection={companyId:'c',session:{accessToken:'token',refreshToken:'r',userId:'u',email:'u@test.it',expiresIn:3600},config:{url:'https://example.test',anonKey:'key'}}
afterEach(()=>{cleanup();mock.rpc.mockReset()})
it('lets the owner choose the first separate password, confirms it and clears both fields',async()=>{
 mock.rpc.mockResolvedValueOnce({configured:false}).mockResolvedValueOnce({ok:true})
 render(<PrivatePasswordSettings connection={connection}/>)
 const first=await screen.findByLabelText('Nuova password dei blocchi')
 fireEvent.change(first,{target:{value:'chosen-private-123'}})
 fireEvent.change(screen.getByLabelText('Ripeti nuova password'),{target:{value:'chosen-private-123'}})
 fireEvent.click(screen.getByText('Imposta password dei blocchi'))
 expect(await screen.findByText(/Password dei blocchi salvata/)).toBeInTheDocument()
 expect(first).toHaveValue('')
 expect(mock.rpc.mock.calls[1][1]).toMatchObject({p_action:'set',p_password:null,p_new_password:'chosen-private-123'})
 expect(screen.getByLabelText('Password attuale dei blocchi')).toHaveValue('')
})
it('requires the previous secret to rotate and rejects mismatched confirmation without sending a password',async()=>{
 mock.rpc.mockResolvedValue({configured:true})
 render(<PrivatePasswordSettings connection={connection}/>)
 fireEvent.change(await screen.findByLabelText('Password attuale dei blocchi'),{target:{value:'old-private-123'}})
 fireEvent.change(screen.getByLabelText('Nuova password dei blocchi'),{target:{value:'new-private-456'}})
 fireEvent.change(screen.getByLabelText('Ripeti nuova password'),{target:{value:'mismatch-456'}})
 fireEvent.click(screen.getByText('Cambia password dei blocchi'))
 expect(await screen.findByText('Le password non coincidono.')).toBeInTheDocument()
 expect(mock.rpc).toHaveBeenCalledTimes(1)
})
