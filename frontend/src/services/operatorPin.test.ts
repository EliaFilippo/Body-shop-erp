import { afterEach,describe,expect,it,vi } from 'vitest'
import { configureOperatorPin,readTabletPairing,signInWithPin,tabletLink,validPairing } from './operatorPin'
const pairing={companyId:'10000000-0000-0000-0000-000000000001',operatorId:'stefania',pairing:'a'.repeat(64)}
const config={url:'https://example.test',anonKey:'public'}
afterEach(()=>{localStorage.clear();sessionStorage.clear();history.replaceState(null,'','/');vi.unstubAllGlobals()})
describe('accesso PIN personale',()=>{
  it('activates a tablet from the fragment, removes its link from history and discards an office session',()=>{
    sessionStorage.setItem('body-shop-erp.cloud-session.v1','owner-token')
    history.replaceState(null,'',tabletLink(pairing,location.origin+'/production.html'))
    expect(readTabletPairing()).toEqual(pairing)
    expect(location.hash).toBe('')
    expect(sessionStorage.getItem('body-shop-erp.cloud-session.v1')).toBeNull()
    expect(readTabletPairing()).toEqual(pairing)
    expect(validPairing({...pairing,pairing:'123'})).toBe(false)
  })
  it('never sends a login with an invalid PIN and conveys lockout without fabricating success',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({message:'Troppi tentativi. Riprova tra 15 minuti.'}),{status:401}))
    await expect(signInWithPin(pairing,'12',config,fetcher)).rejects.toThrow('6 cifre')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(signInWithPin(pairing,'483927',config,fetcher)).rejects.toThrow('15 minuti')
    expect(fetcher).toHaveBeenCalledWith('https://example.test/functions/v1/operator-pin',expect.objectContaining({body:JSON.stringify({action:'login',...pairing,pin:'483927'})}))
    expect(localStorage.getItem('body-shop-erp.cloud-session.v1')).toBeNull()
  })
  it('uses the authenticated owner only for configuration and does not persist a PIN',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({name:'Stefania',pairing:pairing.pairing})))
    const session={accessToken:'owner',refreshToken:'refresh',expiresIn:3600,userId:'u',email:'owner@example.test'}
    await expect(configureOperatorPin(pairing.companyId,pairing.operatorId,'111111',session,config,fetcher)).rejects.toThrow('Scegli un PIN')
    expect(fetcher).not.toHaveBeenCalled()
    await configureOperatorPin(pairing.companyId,pairing.operatorId,'483927',session,config,fetcher)
    expect(fetcher).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer owner'})}))
    expect(localStorage.length).toBe(0)
  })
})
