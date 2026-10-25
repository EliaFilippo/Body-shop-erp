import { useState } from 'react'
import { fireEvent,render,screen } from '@testing-library/react'
import { it,expect } from 'vitest'
import { FastPaymentTerms } from './FastPaymentTerms'
import type { EstimatePaymentTerms } from '../../types'
function Form(){
 const [value,setValue]=useState<EstimatePaymentTerms>({method:'Bonifico',days:0,endOfMonth:false,expectedInvoiceDate:'',atDelivery:true})
 return <FastPaymentTerms value={value} delivery="2026-10-26" onChange={setValue}/>
}
it('sceglie RIBA a 60 giorni con data incasso distinta dalla consegna',()=>{
 render(<Form/>)
 expect(screen.getByText('Incasso previsto: 26/10/2026')).toBeInTheDocument()
 fireEvent.change(screen.getByLabelText('Metodo di pagamento'),{target:{value:'R.I.B.A.'}})
 fireEvent.change(screen.getByLabelText('Scadenza pagamento'),{target:{value:'60'}})
 fireEvent.change(screen.getByLabelText('Data prevista fatturazione'),{target:{value:'2026-10-26'}})
 fireEvent.change(screen.getByLabelText('Data di incasso prevista'),{target:{value:'2026-12-28'}})
 expect(screen.getByText('Incasso previsto: 28/12/2026')).toBeInTheDocument()
 expect(screen.getByLabelText('Scadenza pagamento')).toHaveValue('60')
})

it('propone RIBA a 40 giorni e calcola la scadenza dalla data di fatturazione',()=>{
 render(<Form/>)
 fireEvent.change(screen.getByLabelText('Metodo di pagamento'),{target:{value:'R.I.B.A.'}})
 fireEvent.change(screen.getByLabelText('Scadenza pagamento'),{target:{value:'40'}})
 fireEvent.change(screen.getByLabelText('Data prevista fatturazione'),{target:{value:'2026-10-26'}})
 expect(screen.getByLabelText('Scadenza pagamento')).toHaveValue('40')
 expect(screen.getByText('Incasso previsto: 05/12/2026')).toBeInTheDocument()
})
