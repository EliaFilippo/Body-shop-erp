import {handleNightlyRequest} from '../../../frontend/src/services/nightlyPlanning'
const url=Deno.env.get('SUPABASE_URL')!
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
Deno.serve((request:Request)=>handleNightlyRequest(request,async(name,args)=>{
 const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(25000)})
 if(!response.ok)throw Error('Nightly RPC failed')
 return response.json()
}))
