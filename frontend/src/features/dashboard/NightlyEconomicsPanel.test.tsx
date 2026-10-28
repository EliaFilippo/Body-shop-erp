import {it,expect} from 'vitest'
import {render,screen} from '@testing-library/react'
import {NightlyEconomicsPanel} from './NightlyEconomicsPanel'
import {calculateNightlyEconomics} from '../../services/nightlyEconomics'
import {emptyData} from '../../services/erp'
it('distinguishes cost, required revenue rate and date-specific target even without usable data',()=>{
 const snapshot=calculateNightlyEconomics(structuredClone(emptyData),{serverNow:'2026-10-28T02:00:00Z',entries:[],dailyWork:[]},'2026-10-28')
 render(<NightlyEconomicsPanel snapshot={snapshot}/>)
 expect(screen.getByText('Costo orario consuntivo · struttura e personale')).toBeInTheDocument()
 expect(screen.getByText('Tariffa obiettivo sul fatturato residuo')).toBeInTheDocument()
 expect(screen.getByText('Obiettivo del 2026-10-28')).toBeInTheDocument()
 expect(screen.getAllByText('Dato non disponibile').length).toBeGreaterThanOrEqual(2)
 expect(screen.getByText(/Priorità ai box/)).toBeInTheDocument()
})
