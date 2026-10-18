import { useState } from 'react'
import type { EliasCatalogOverride, MinorDamageTimes, PlannerSettings } from '../../types'
import { ELIAS_PRICE_LIST, MINOR_TIME_LABELS, eliasCatalogOverride, configuredEliasEntry, configuredEliasTimes, eliasPricesForPanel, type EliasPriceEntry } from '../../services/eliasPriceList'
import { QUOTE_PANELS } from '../workflow/vehiclePanels'

function CatalogRow({entry,panelId,settings,onSave}:{entry:EliasPriceEntry;panelId:string;settings:PlannerSettings;onSave:(settings:PlannerSettings)=>void}) {
 const [prices,setPrices]=useState(entry.prices.join(' / '))
 const [manual,setManual]=useState(Boolean(entry.manualPricing))
 const [times,setTimes]=useState<MinorDamageTimes>(configuredEliasTimes(entry,settings,panelId)||{})
 const [message,setMessage]=useState('')
 const key=panelId?`${panelId}:${entry.id}`:entry.id
 return <details className="panel"><summary><strong>{entry.name}</strong> · {manual?'Prezzo manuale':`${entry.prices.join(' / ')} €`} · {Object.values(configuredEliasTimes(entry,settings,panelId)||{}).reduce((a,b)=>a+(b??0),0)} min per pezzo</summary>
  <p>Importi IVA esclusa, materiali inclusi. S/R, I/S e V sono ciascuno un monte minuti complessivo.</p>
  <div className="form-grid"><label>Prezzi {entry.name} €<input value={prices} onChange={e=>setPrices(e.target.value)} placeholder="150 oppure 150 / 170" /></label>
   <label><input type="checkbox" checked={manual} onChange={e=>setManual(e.target.checked)}/>Prezzo da inserire manualmente nel preventivo</label>
   {Object.entries(MINOR_TIME_LABELS).map(([field,label])=><label key={field}>{label} · minuti<input type="number" min="0" step="1" aria-label={`${entry.name}: ${label} minuti`} value={times[field as keyof MinorDamageTimes]??0} onChange={e=>setTimes({...times,[field]:Number(e.target.value)})}/></label>)}
  </div>
  <button type="button" className="primary" onClick={()=>{
   const amounts=prices.split(/[\/;|]/).map(n=>Number(n.trim().replace(',','.')))
   if(!manual&&(!amounts.length||amounts.some(n=>!Number.isFinite(n)||n<=0))){setMessage('Inserisci prezzi validi maggiori di zero.');return}
   if(Object.values(times).some(n=>!Number.isFinite(n)||Number(n)<0||!Number.isInteger(n))){setMessage('Inserisci minuti interi maggiori o uguali a zero.');return}
   const after:EliasCatalogOverride={prices:amounts.every(n=>Number.isFinite(n)&&n>0)?amounts:entry.prices,times:{...times},manualPricing:manual}
   onSave({...settings,eliasPriceOverrides:{...settings.eliasPriceOverrides,[key]:after},eliasPriceHistory:[{at:new Date().toISOString(),key,before:settings.eliasPriceOverrides?.[key],after},...(settings.eliasPriceHistory||[])].slice(0,1000)})
   setMessage('Voce salvata per i prossimi preventivi.')
  }}>Salva {entry.name}</button>
  {settings.eliasPriceOverrides?.[key]&&<button type="button" className="secondary" onClick={()=>{
   const overrides={...settings.eliasPriceOverrides};delete overrides[key]
   onSave({...settings,eliasPriceOverrides:overrides,eliasPriceHistory:[{at:new Date().toISOString(),key,before:settings.eliasPriceOverrides?.[key],after:{}},...(settings.eliasPriceHistory||[])].slice(0,1000)})
  }}>Ripristina valori di base</button>}
  {message&&<p role="status">{message}</p>}
 </details>
}
export function EliasCatalogSettings({settings,onSave}:{settings:PlannerSettings;onSave:(settings:PlannerSettings)=>void}) {
 const [panelId,setPanelId]=useState('')
 const [search,setSearch]=useState('')
 const [wash,setWash]=useState(settings.eliasExteriorWashMinutes??25)
 const panel=QUOTE_PANELS.find(p=>p.id===panelId)
 const entries=panel?eliasPricesForPanel(panel.id,panel.name,settings):ELIAS_PRICE_LIST.map(e=>configuredEliasEntry(e,settings))
 return <section aria-label="Tempi e prezzi preimpostati">
  <div className="panel"><h2>Tempi e prezzi preimpostati</h2><p>Modifica il listino generale oppure scegli un pannello preciso per impostare un’eccezione. Le modifiche valgono per i nuovi preventivi; quelli salvati conservano prezzi e tempi.</p>
   <div className="form-grid"><label>Applica a<select value={panelId} onChange={e=>setPanelId(e.target.value)}><option value="">Listino generale · ogni singolo pezzo</option>{QUOTE_PANELS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label>Cerca lavorazione<input value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
   <label>Lavaggio esterno · minuti per vettura<input type="number" min="1" step="1" value={wash} onChange={e=>setWash(Number(e.target.value))}/></label>
   <button type="button" className="secondary" disabled={!Number.isInteger(wash)||wash<1} onClick={()=>onSave({...settings,eliasExteriorWashMinutes:wash})}>Salva tempo lavaggio esterno</button>
  </div>
  {entries.filter(e=>e.name.toLowerCase().includes(search.toLowerCase())).map(entry=><CatalogRow key={`${panelId}:${entry.id}:${JSON.stringify(eliasCatalogOverride(settings,entry.id,panelId))}`} entry={entry} panelId={panelId} settings={settings} onSave={onSave}/>)}
  {!!settings.eliasPriceHistory?.length&&<details className="panel"><summary>Ultime modifiche al listino</summary>{settings.eliasPriceHistory.slice(0,10).map((h,i)=><p key={i}>{new Date(h.at).toLocaleString('it-IT')} · {h.key} · {h.after.prices?.join(' / ')||'Valori di base'} €</p>)}</details>}
 </section>
}
