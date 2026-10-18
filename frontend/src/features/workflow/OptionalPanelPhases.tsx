import type { EstimateLine, PlannerSettings } from '../../types'
import { optionalPanelPhases,setOptionalPanelPhase } from '../../services/optionalPanelPhases'
export function OptionalPanelPhases({line,settings,onChange}:{line:EstimateLine;settings:PlannerSettings;onChange:(line:EstimateLine)=>void}) {
 const options=optionalPanelPhases(line,settings)
 if(!options.length)return null
 return <fieldset><legend>Lavorazioni facoltative · {line.panelName}</legend>
  {options.map(option=><label key={option.key}><input type="checkbox" checked={Number(line.minorDamageTimes?.[option.key])>0}
   onChange={e=>onChange(setOptionalPanelPhase(line,option.key,e.target.checked,settings))}/>{option.label} · {option.minutes} min</label>)}
  <small>Togli la spunta se non serve. La lucidatura totale della vettura si aggiunge separatamente da “Vettura intera / interni”. Il prezzo del pezzo resta quello scelto.</small>
 </fieldset>
}
