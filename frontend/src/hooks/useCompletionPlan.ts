import {useEffect,useRef,useState} from 'react'
import type {CloudAuthConfig,CloudAuthSession} from '../services/cloudAuth'
import type {CompletionPlan} from '../services/completionPlanning'
import {productionRpc} from '../services/liveProduction'
export function useCompletionPlan(companyId:string|undefined,session:CloudAuthSession|null,config:CloudAuthConfig|null){
 const [plan,setPlan]=useState<CompletionPlan|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('')
 const known=useRef(-1)
 useEffect(()=>{
  setPlan(null);setPending(false);known.current=-1
  if(!companyId||!session||!config)return
  let cancelled=false,running=false
  const refresh=async()=>{
   if(running||document.hidden)return
   running=true
   try{
    const result=await productionRpc<{pending:boolean;reset?:boolean;plan?:CompletionPlan}>('production_completion_plan',{p_company_id:companyId,p_known_generation:known.current},session,config)
    if(cancelled)return
    if(result.reset){known.current=-1;setPlan(null)}
    else if(result.plan){known.current=result.plan.generation;setPlan(result.plan)}
    setPending(result.pending);setError('')
   }catch{if(!cancelled)setError('Aggiornamento del piano temporaneamente non disponibile.')}
   finally{running=false}
  }
  void refresh();const timer=setInterval(()=>void refresh(),5000)
  const online=()=>void refresh();window.addEventListener('online',online)
  return()=>{cancelled=true;clearInterval(timer);window.removeEventListener('online',online)}
 },[companyId,session?.userId,config])
 return {plan,pending,error}
}
