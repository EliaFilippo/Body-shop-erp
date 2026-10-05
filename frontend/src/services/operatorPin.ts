import type { CloudAuthConfig, CloudAuthSession } from './cloudAuth'
export interface TabletPairing { companyId: string; operatorId: string; pairing: string }
const pairingKey = 'body-shop-erp.tablet-pairing.v1'
export function validPairing(value: unknown): value is TabletPairing {
  const p = value as TabletPairing | null
  return !!p && /^[0-9a-f-]{36}$/i.test(p.companyId) && typeof p.operatorId==='string' && !!p.operatorId && p.operatorId.length<=128 && /^[a-f0-9]{64}$/.test(p.pairing)
}
export function readTabletPairing(): TabletPairing | null {
  try {
    const params = new URLSearchParams(location.hash.slice(1))
    const incoming = { companyId:params.get('company') || '',operatorId:params.get('operator') || '',pairing:params.get('tablet') || '' }
    if (validPairing(incoming)) {
      localStorage.setItem(pairingKey,JSON.stringify(incoming))
      // Un link tablet non deve riutilizzare il profilo ufficio aperto prima.
      sessionStorage.removeItem('body-shop-erp.cloud-session.v1')
      history.replaceState(null,'',location.pathname+location.search)
      return incoming
    }
    const stored: unknown = JSON.parse(localStorage.getItem(pairingKey) || 'null')
    return validPairing(stored) ? stored : null
  } catch { return null }
}
export function tabletLink(pairing:TabletPairing, baseUrl = new URL('production.html',new URL(import.meta.env.BASE_URL,location.origin)).href) {
  return `${baseUrl}#${new URLSearchParams({ company:pairing.companyId,operator:pairing.operatorId,tablet:pairing.pairing })}`
}
async function callPin<T>(body:Record<string,unknown>,config:CloudAuthConfig,session?:CloudAuthSession,fetcher:typeof fetch=fetch):Promise<T> {
  const res=await fetcher(`${config.url}/functions/v1/operator-pin`,{ method:'POST',headers:{ 'Content-Type':'application/json',apikey:config.anonKey,
    Authorization:`Bearer ${session?.accessToken ?? config.anonKey}` },body:JSON.stringify(body),signal:AbortSignal.timeout(15000) })
  const payload=await res.json()
  if (!res.ok) throw new Error(payload.message || 'Accesso PIN non ancora attivato. Contatta il titolare.')
  return payload as T
}
export const identifyTablet=(pairing:TabletPairing,config:CloudAuthConfig) => callPin<{name:string}>({ action:'identify',...pairing },config)
export async function signInWithPin(pairing:TabletPairing,pin:string,config:CloudAuthConfig,fetcher:typeof fetch=fetch) {
  if (!/^\d{6}$/.test(pin)) throw new Error('Inserisci il PIN di 6 cifre.')
  return callPin<CloudAuthSession>({ action:'login',...pairing,pin },config,undefined,fetcher)
}
export async function configureOperatorPin(companyId:string,operatorId:string,pin:string,session:CloudAuthSession,config:CloudAuthConfig,fetcher:typeof fetch=fetch) {
  if (!/^\d{6}$/.test(pin) || /^(\d)\1{5}$/.test(pin) || ['123456','654321'].includes(pin)) throw new Error('Scegli un PIN di 6 cifre non ripetute o consecutive.')
  return callPin<{name:string;pairing:string}>({ action:'configure',companyId,operatorId,pin },config,session,fetcher)
}
