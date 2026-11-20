import { fireEvent,render,screen } from '@testing-library/react'
import { expect,it,vi } from 'vitest'
import { emptyData } from '../../services/erp'
import { RibaManagementPage } from './RibaManagementPage'
it('shows only the chosen customer vehicles in the two columns',()=>{
 const data=structuredClone(emptyData)
 data.customers=[{id:'c',name:'Cliente Alfa'},{id:'d',name:'Altro'}] as typeof data.customers
 data.vehicles=[{id:'v',plate:'AAA',customerId:'c',expectedRevenue:100},{id:'w',plate:'BBB',customerId:'d',expectedRevenue:200}] as typeof data.vehicles
 render(<RibaManagementPage data={data} onChange={vi.fn()}/> )
 fireEvent.change(screen.getByLabelText('Nome cliente'),{target:{value:'Alfa'}})
 fireEvent.click(screen.getByRole('button',{name:'Cliente Alfa'}))
 expect(screen.getByText(/AAA/)).toBeInTheDocument()
 expect(screen.queryByText(/BBB/)).not.toBeInTheDocument()
 expect(screen.getByRole('heading',{name:/RiBa caricate/})).toBeInTheDocument()
 expect(screen.getByRole('heading',{name:/RiBa da caricare/})).toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Carica RiBa'})).toBeInTheDocument()
})
