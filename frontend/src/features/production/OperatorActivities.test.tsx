import { fireEvent,render,screen } from '@testing-library/react'
import { it,expect,vi } from 'vitest'
import { OperatorActivities } from './OperatorActivities'
it('offre i due pulsanti e ferma l’attività senza riprendere automaticamente una vettura',()=>{
 const action=vi.fn()
 const props={busy:false,stale:false,elapsed:5,onAction:action}
 const {rerender}=render(<OperatorActivities {...props} activity={{kind:null,elapsedSeconds:0,cleaningSeconds:120,coffeeSeconds:60}}/>)
 fireEvent.click(screen.getByRole('button',{name:'PULIZIE'}))
 expect(action).toHaveBeenLastCalledWith('cleaning')
 fireEvent.click(screen.getByRole('button',{name:'PAUSA CAFFÈ'}))
 expect(action).toHaveBeenLastCalledWith('coffee')
 rerender(<OperatorActivities {...props} activity={{kind:'coffee',elapsedSeconds:30,cleaningSeconds:120,coffeeSeconds:90}}/>)
 expect(screen.getByRole('button',{name:'PAUSA CAFFÈ'})).toBeDisabled()
 expect(screen.getByText('0:00:35')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'TERMINA ATTIVITÀ'}))
 expect(action).toHaveBeenLastCalledWith('end')
 rerender(<OperatorActivities {...props} stale activity={{kind:'coffee',elapsedSeconds:30,cleaningSeconds:120,coffeeSeconds:90}}/>)
 expect(screen.getByRole('button',{name:'TERMINA ATTIVITÀ'})).toBeDisabled()
 expect(screen.getByText('Da aggiornare')).toBeInTheDocument()
})
it('non mostra pulsanti operativi quando il server non ha ancora attivato la funzione',()=>{
 render(<OperatorActivities busy={false} stale={false} elapsed={0} onAction={()=>{}} activity={undefined}/>)
 expect(screen.getByRole('button',{name:'PULIZIE'})).toBeDisabled()
 expect(screen.getByText('Funzione da attivare dall’ufficio.')).toBeInTheDocument()
})
