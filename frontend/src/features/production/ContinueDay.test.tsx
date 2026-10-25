import { fireEvent,render,screen } from '@testing-library/react'
import { describe,it,expect,vi } from 'vitest'
import { ContinueDay } from './ContinueDay'
import type { LiveFeed } from '../../services/liveProduction'
describe('continua giornata sul tablet',()=>{
 const feed={serverNow:'2026-10-26T17:00:00Z',dayContinuation:{canContinue:true,ordinaryEndMinute:1080,untilMinute:null,date:'2026-10-26'},jobs:[]} as unknown as LiveFeed
 it('richiede la fine disponibilità e non avvia un timer',()=>{
  const action=vi.fn()
  render(<ContinueDay feed={feed} busy={false} stale={false} onContinue={action}/>)
  fireEvent.click(screen.getByRole('button',{name:'Continua giornata'}))
  fireEvent.change(screen.getByLabelText('Disponibile fino alle'),{target:{value:'20:00'}})
  fireEvent.click(screen.getByRole('button',{name:'Conferma disponibilità extra'}))
  expect(action).toHaveBeenCalledWith('20:00')
 })
 it('non consente comandi con connessione non aggiornata',()=>{
  render(<ContinueDay feed={feed} busy={false} stale={true} onContinue={()=>{}}/>)
  expect(screen.getByRole('button',{name:'Continua giornata'})).toBeDisabled()
 })
})
