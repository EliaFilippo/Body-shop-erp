import { createClient } from 'npm:@supabase/supabase-js@2.58.0'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const headers = { 'Access-Control-Allow-Origin': 'https://eliafilippo.github.io',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' }
const response = (body: unknown, status = 200) => Response.json(body, { status, headers })
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('')
const admin = () => createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
async function credentials(company: string, operator: string) {
  const identity = `${company}:${operator}`
  const id = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(serviceKey), { name:'HMAC',hash:'SHA-256' },false,['sign'])
  const password = hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`operator-pin-v1:${identity}`)))
  return { email: `op-${id}@tablet.body-shop.invalid`, password }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null,{ headers })
  if (req.method !== 'POST') return response({ message:'Comando non valido.' },405)
  try {
    if (Number(req.headers.get('content-length') || 0)>4096) return response({ message:'Richiesta troppo grande.' },413)
    const body = await req.json()
    const { action, companyId, operatorId } = body
    if (!/^[0-9a-f-]{36}$/i.test(companyId || '') || typeof operatorId !== 'string' || !operatorId || operatorId.length>128)
      return response({ message:'Tablet non configurato.' },400)
    const db = admin()
    if (action === 'configure') {
      const token = req.headers.get('Authorization')?.replace(/^Bearer /i,'') || ''
      const { data: identity, error: authError } = await db.auth.getUser(token)
      if (authError || !identity.user) return response({ message:'Accedi con il profilo titolare.' },401)
      const { data: owner, error: ownerError } = await db.from('company_members').select('user_id')
        .eq('company_id',companyId).eq('user_id',identity.user.id).eq('role','owner').eq('active',true).maybeSingle()
      if (ownerError || !owner) return response({ message:'Solo il titolare può configurare i PIN.' },403)
      if (!/^[0-9]{6}$/.test(body.pin || '') || /^(\d)\1{5}$/.test(body.pin) || ['123456','654321'].includes(body.pin))
        return response({ message:'Scegli un PIN di 6 cifre non ripetute o consecutive.' },400)
      // Verifica la destinazione prima di creare un account tecnico.
      const { data: snapshot } = await db.from('erp_snapshots').select('payload').eq('company_id',companyId).single()
      const operator = snapshot?.payload?.plannerSettings?.operators?.find((o: { id:string; active:boolean }) => o.id===operatorId && o.active)
      if (!operator) return response({ message:'Operatore non attivo.' },400)
      const { data: existing, error: readError } = await db.from('production_pin_accounts').select('user_id').eq('company_id',companyId).eq('operator_id',operatorId).maybeSingle()
      if (readError) return response({ message:'Attivazione PIN sul server ancora da completare.' },503)
      const { data: bound, error: boundError } = await db.from('production_profiles').select('user_id').eq('company_id',companyId).eq('operator_id',operatorId).maybeSingle()
      if (boundError || (bound && bound.user_id!==existing?.user_id)) return response({ message:'Operatore già collegato a un altro account. Contatta il titolare per scollegarlo prima di attivare il PIN.' },409)
      const authCredentials = await credentials(companyId,operatorId)
      let userId = existing?.user_id
      if (!userId) {
        const { data: created, error: createError } = await db.auth.admin.createUser({ ...authCredentials,email_confirm:true,
          app_metadata:{ production_pin_company:companyId,production_pin_operator:operatorId } })
        if (createError || !created.user) return response({ message:'Creazione profilo non riuscita. Verifica che l’operatore non sia già collegato.' },409)
        userId = created.user.id
      }
      const pairing = hex(crypto.getRandomValues(new Uint8Array(32)).buffer)
      const { error } = await db.rpc('production_pin_configure',{ p_owner_id:identity.user.id,p_company_id:companyId,p_operator_id:operatorId,p_user_id:userId,p_pin:body.pin,p_pairing:pairing })
      if (error) return response({ message:error.message },400)
      // Consente di ripristinare l'accesso anche dopo rotazione della chiave server.
      if (existing) {
        const { error: updateError } = await db.auth.admin.updateUserById(userId,{ password:authCredentials.password })
        if (updateError) return response({ message:'PIN configurato ma accesso tecnico da ripristinare. Ripeti la configurazione prima di usare il tablet.' },503)
      }
      return response({ name:operator.name, pairing })
    }
    if (!['identify','login'].includes(action) || typeof body.pairing!=='string' || !/^[a-f0-9]{64}$/.test(body.pairing))
      return response({ message:'Collegamento tablet non valido.' },400)
    const { data: result, error } = await db.rpc('production_pin_access',{
      p_company_id:companyId,p_operator_id:operatorId,p_pairing:body.pairing,p_pin:action==='login' ? String(body.pin ?? '') : null })
    if (error) return response({ message:'Accesso PIN non ancora attivato sul server.' },503)
    if (action==='identify') return result?.name ? response({ name:result.name }) : response({ message:'Collegamento tablet non valido o revocato.' },401)
    if (!result?.userId) return response({ message:result?.blocked ? 'Troppi tentativi. Riprova tra 15 minuti.' : 'PIN o collegamento non valido.' },401)
    const userClient = createClient(url,anonKey,{ auth:{ persistSession:false,autoRefreshToken:false } })
    const { data: login, error: loginError } = await userClient.auth.signInWithPassword(await credentials(companyId,operatorId))
    if (loginError || !login.session || login.user?.id!==result.userId) return response({ message:'Accesso non riuscito. Contatta il titolare.' },401)
    return response({ accessToken:login.session.access_token,refreshToken:login.session.refresh_token,
      userId:login.user.id,email:login.user.email,expiresIn:login.session.expires_in })
  } catch { return response({ message:'Collegamento non riuscito. Riprova.' },503) }
})
