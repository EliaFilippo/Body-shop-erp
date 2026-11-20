import { render, screen, fireEvent } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MonthlyPayrollActuals } from './MonthlyPayrollActuals'
import { emptyData } from '../../services/erp'
it('saves a zero actual for the selected competence month without altering operator rates',()=>{
 const data=structuredClone(emptyData),save=vi.fn()
 render(<MonthlyPayrollActuals data={data} onSave={save}/> )
 fireEvent.change(screen.getByLabelText('Mese di competenza'),{target:{value:'2026-10'}})
 expect(screen.getByText('Salva costo effettivo')).toBeDisabled()
 fireEvent.change(screen.getByLabelText('Costo effettivo dipendenti (€)'),{target:{value:'0'}})
 fireEvent.click(screen.getByText('Salva costo effettivo'))
 expect(save).toHaveBeenCalledOnce()
 expect(save.mock.calls[0][0].monthlyPayrollActuals[0]).toMatchObject({monthKey:'2026-10',amount:0})
 expect(save.mock.calls[0][0].operators).toEqual(data.plannerSettings.operators)
})
