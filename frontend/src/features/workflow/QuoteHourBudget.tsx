import type { AcceptanceQuote, PlannerSettings } from '../../types'
import type { marginTargetRate } from '../../services/marginTargetRate'
import { QuoteEconomicsPreview } from './QuoteEconomicsPreview'
export function QuoteHourBudget({quote,settings,activePanelId,onChange,marginTarget}:{quote:AcceptanceQuote;settings:PlannerSettings;activePanelId:string;onChange:(quote:AcceptanceQuote)=>void;marginTarget?:ReturnType<typeof marginTargetRate>}){
 const choices=settings.operators.filter(op=>op.active)
 const lines=(quote.damageLines??[]).filter(line=>line.panelId===activePanelId)
 return <section aria-label="Ore a disposizione">
 <QuoteEconomicsPreview quote={quote} settings={settings} marginTarget={marginTarget}/>
 <label>Operatore di riferimento del preventivo<select value={quote.budgetOperatorId??''} onChange={e=>onChange({...quote,budgetOperatorId:e.target.value})}><option value="">Media operatori attivi</option>{choices.map(op=><option key={op.id} value={op.id}>{op.name}</option>)}</select></label>
 {lines.length>0&&<label>Operatore per questo pannello<select value={lines[0].budgetOperatorId??''} onChange={e=>onChange({...quote,damageLines:(quote.damageLines??[]).map(line=>line.panelId===activePanelId?{...line,budgetOperatorId:e.target.value}:line)})}><option value="">Operatore di riferimento</option>{choices.map(op=><option key={op.id} value={op.id}>{op.name}</option>)}</select></label>}
 <p>Le ore economiche non modificano i tempi tecnici assegnati alle fasi.</p>
 </section>
}
