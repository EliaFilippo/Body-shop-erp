import {render,screen} from '@testing-library/react'
import {expect,it} from 'vitest'
import type {RepairJob,Vehicle} from '../../types'
import {emptyData} from '../../services/erp'
import {ArchivedOperatingProfit} from './ArchivedVehicleDetails'
it('shows the recorded contribution once, without allocating general expenses already in the objective',()=>{
 const settings=structuredClone(emptyData.plannerSettings)
 settings.operators=[{id:'a',name:'Anna',hourlyCost:20,dailyHours:8,active:true}]
 const job={id:'j',status:'Consegnata',entryDate:'2026-11-10',deliveredAt:'2026-11-19T16:00:00Z',taxableAmount:232,materialActualCost:{amount:5,at:'',note:''},lines:[],phases:[{id:'p',name:'Lucidatura',tabletWorkedSeconds:3600,operatorAssignments:[{id:'tablet:a',operatorName:'Anna',workedMinutes:60,endedAt:'2026-11-19T15:00:00Z'}]}]} as unknown as RepairJob
 const vehicle={id:'v',plate:'TEST',status:'Consegnata',costEntries:[]} as unknown as Vehicle
 render(<ArchivedOperatingProfit vehicle={vehicle} job={job} jobs={[job]} settings={settings}/> )
 expect(screen.getAllByText(/207,00/)).toHaveLength(2)
 expect(screen.queryByText('Quota spese generali')).not.toBeInTheDocument()
 expect(screen.getByText(/Le spese generali sono già comprese nell’obiettivo mensile/)).toBeVisible()
 expect(screen.getByText('Manodopera effettiva').nextElementSibling).toHaveTextContent('20,00')
})
