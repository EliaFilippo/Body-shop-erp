import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProductionControlPanel } from './ProductionControlPanel'
const mock = vi.hoisted(() => ({rpc:vi.fn()}))
vi.mock('../../services/liveProduction', () => ({productionRpc:mock.rpc}))
const connection = {companyId:'c',session:{accessToken:'token',refreshToken:'r',userId:'u',email:'a@b.test',expiresIn:3600},config:{url:'https://example.test',anonKey:'key'}}
afterEach(() => {cleanup();mock.rpc.mockReset()})
it('shows global office alert and acknowledges it without erasing history', async () => {
 const alert = {id:1,plate:'AB123',number:'COMM-1',phase:'Lavaggio esterno',overrunSeconds:300,operators:[{name:'Stefania'}],active:true,acknowledgedAt:null}
 mock.rpc.mockResolvedValue({alerts:[alert],operators:[],teams:[]})
 render(<ProductionControlPanel connection={connection} />)
 expect(await screen.findByText('1 sforamenti da verificare')).toBeInTheDocument()
 expect(screen.getByText(/Stefania · Timer attivo/)).toBeInTheDocument()
 mock.rpc.mockResolvedValue({alerts:[{...alert,acknowledgedAt:'2026-10-18T16:00:00Z'}],operators:[],teams:[]})
 fireEvent.click(screen.getByText('Preso in carico'))
 await waitFor(() => expect(screen.queryByText('1 sforamenti da verificare')).not.toBeInTheDocument())
 expect(mock.rpc.mock.calls[1][1]).toMatchObject({p_company_id:'c',p_ack_id:1})
 fireEvent.click(screen.getByText('Mostra storico avvisi'))
 expect(screen.getByText(/preso in carico il/)).toBeInTheDocument()
})
