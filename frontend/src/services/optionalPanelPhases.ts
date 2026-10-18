import type { EstimateLine, PlannerSettings } from '../types'
import { recalculateDamageLine } from './damageQuote'
import { configuredEliasTimes, eliasEntryForWork } from './eliasPriceList'

export function optionalPanelPhases(line: EstimateLine, settings: PlannerSettings): Array<{key:'sr'|'lc';minutes:number;label:string}> {
 const entry=eliasEntryForWork(line.standardWorkId)
 if(!entry||!line.minorDamageTimes||line.panelId==='vettura-intera'||entry.id==='parabrezza')return []
 // Polishing-only services (whole car, sides, headlights, touch-ups) stay independent.
 if(!['is','v','la'].some(key=>Number(line.minorDamageTimes?.[key as 'is'|'v'|'la'])>0))return []
 const defaults=configuredEliasTimes(entry,settings,line.panelId)
 return (['sr','lc'] as const).flatMap(key=>{
  const minutes=line.minorDamageTimes?.[key]||line.optionalPanelTimes?.[key]||defaults?.[key]||0
  return minutes>0?[{key,minutes,label:key==='sr'?'Smontaggio / rimontaggio necessario':'Lucidatura del pezzo verniciato necessaria'}]:[]
 })
}
export function setOptionalPanelPhase(line: EstimateLine,key:'sr'|'lc',enabled:boolean,settings:PlannerSettings):EstimateLine {
 const option=optionalPanelPhases(line,settings).find(item=>item.key===key)
 if(!option)return line
 const times={...line.minorDamageTimes,[key]:enabled?option.minutes:0}
 return recalculateDamageLine({...line,minorDamageTimes:times,optionalPanelTimes:{...line.optionalPanelTimes,[key]:option.minutes},
  estimatedMinutes:Object.values(times).reduce((sum,n)=>sum+(n??0),0)},settings)
}
