import {render,screen,fireEvent} from '@testing-library/react'
import {it,expect,vi} from 'vitest'
import {MonthlyGoalsSettingsPage} from './MonthlyGoalsSettingsPage'
import {emptyData} from '../../services/erp'
it('preserves the margin goal including general expenses independently of owner withdrawal',()=>{
 const data=structuredClone(emptyData)
 data.plannerSettings.monthlyMarginGoal=12000
 data.plannerSettings.ownerWithdrawalAmount=3000
 const save=vi.fn()
 render(<MonthlyGoalsSettingsPage data={data} onSave={save}/> )
 fireEvent.click(screen.getByText('Salva obiettivi'))
 expect(save.mock.calls[0][0].monthlyMarginGoal).toBe(12000)
 expect(save.mock.calls[0][0].monthlyGoalHistory[0].marginGoal).toBe(12000)
})
