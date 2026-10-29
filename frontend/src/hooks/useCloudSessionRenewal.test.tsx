import {useState} from 'react'
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {useCloudSessionRenewal} from './useCloudSessionRenewal'
import {clearCloudSession,persistCloudSession} from '../services/cloudSession'
import type {CloudAuthSession} from '../services/cloudAuth'
const config={url:'https://heartbeat.example.test',anonKey:'public'}
let initial:CloudAuthSession
function Screen(){const [session,setSession]=useState<CloudAuthSession|null>(initial);useCloudSessionRenewal(session,config,setSession,()=>setSession(null));return <><span>{session?.accessToken??'signed-out'}</span><input aria-label="Bozza" defaultValue=""/></>}
beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.useFakeTimers();initial={accessToken:'before',refreshToken:'refresh',userId:'u',email:'u@example.test',expiresIn:3600,expiresAt:Date.now()+80000};persistCloudSession(initial,'office',config);vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({access_token:'after',refresh_token:'rotated',expires_in:3600,user:{id:'u'}}))))})
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('rinnova prima della scadenza mantenendo la bozza aperta',async()=>{render(<Screen/>);fireEvent.change(screen.getByLabelText('Bozza'),{target:{value:'Lavoro in corso'}});await act(async()=>{await vi.advanceTimersByTimeAsync(30000)});expect(screen.getByText('after')).toBeInTheDocument();expect(screen.getByLabelText('Bozza')).toHaveValue('Lavoro in corso');expect(fetch).toHaveBeenCalledTimes(1)})
it('un logout esplicito viene recepito dalle schede con lo stesso utente',async()=>{render(<Screen/>);await act(async()=>{clearCloudSession('u',config)});expect(screen.getByText('signed-out')).toBeInTheDocument();expect(fetch).not.toHaveBeenCalled()})
