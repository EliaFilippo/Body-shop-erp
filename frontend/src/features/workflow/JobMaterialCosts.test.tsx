import { useState } from 'react'
import { fireEvent,render,screen } from '@testing-library/react'
import { it,expect } from 'vitest'
import type { RepairJob } from '../../types'
import { JobMaterialCosts } from './JobMaterialCosts'
it('mostra l’anteprima e salva i costi reali con margine aggiornato',()=>{
 const initial={id:'j',status:'Pronta consegna',taxableAmount:500,lines:[{category:'verniciatura',quantity:1,unitPrice:500,discount:0,taxableAmount:500,budgetMaterialsCost:100,internalCostAmount:160,internalHourlyRateUsed:30}],history:[]} as unknown as RepairJob
 function Editor(){const [job,setJob]=useState(initial);return <JobMaterialCosts job={job} onSave={(amount,note)=>setJob({...job,materialActualCost:{amount,note,at:''}})}/>}
 render(<Editor/>)
 const field=screen.getByLabelText('Totale materiali effettivi · IVA esclusa')
 fireEvent.change(field,{target:{value:'80'}});fireEvent.blur(field)
 expect(screen.getByText('360,00 €')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Salva costo reale materiali'}))
 expect(screen.getByRole('status')).toHaveTextContent('Costo reale salvato')
 expect(screen.getByText('80,00 €')).toBeInTheDocument()
})
