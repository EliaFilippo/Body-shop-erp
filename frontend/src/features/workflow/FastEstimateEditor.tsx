import { OptionalPanelPhases } from './OptionalPanelPhases'
import { useMemo, useRef, useState } from 'react'
import type { ErpData, EstimateLine } from '../../types'
import { Modal } from '../../components/Modal'
import { MoneyInput } from '../../components/MoneyInput'
import { createDefaultQuote } from '../../services/acceptance'
import { chooseEliasPrice, recalculateDamageLine, damageQuoteError, damageLineDescription } from '../../services/damageQuote'
import { eliasPricesForPanel, eliasEntryForWork } from '../../services/eliasPriceList'
import { createFastEstimate } from '../../services/fastEstimate'
import { fastEstimateWhatsAppLink } from '../../services/fastEstimateWhatsApp'
import { normalizePlate } from '../../services/erp'
import { WORK_CYCLE, phaseDisplayName } from '../../services/workCycle'
import { QUOTE_PANELS } from './vehiclePanels'
const euro=(n:number)=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})

export function FastEstimateEditor({data,onDone,onCancel}:{data:ErpData;onDone:(next:ErpData,confirmed:boolean)=>void;onCancel:()=>void}) {
 const [plate,setPlate]=useState('')
 const [customerId,setCustomerId]=useState('')
 const [name,setName]=useState('')
 const [phone,setPhone]=useState('')
 const [whatsappPhone,setWhatsappPhone]=useState<string | null>(null)
 const [panelId,setPanelId]=useState('')
 const [lines,setLines]=useState<EstimateLine[]>([])
 const [wash,setWash]=useState(false)
 const [confirmed,setConfirmed]=useState(false)
 const [delivery,setDelivery]=useState('')
 const [notes,setNotes]=useState('')
 const [error,setError]=useState('')
 const busy=useRef(false)
 const existing=data.vehicles.find(v=>normalizePlate(v.plate)===normalizePlate(plate))
 const owner=data.customers.find(c=>c.id===existing?.customerId)
 const recipient=owner||data.customers.find(c=>c.id===customerId)
 const targetPhone=whatsappPhone??(recipient?.phone||phone)
 const panel=QUOTE_PANELS.find(p=>p.id===panelId)
 const choices=panel?eliasPricesForPanel(panel.id,panel.name,data.plannerSettings):[]
 const quote=useMemo(()=>({...createDefaultQuote(data.plannerSettings,new Date().toISOString().slice(0,7)),manualOnlyPricing:true,damageLines:lines,selectedPhases:wash?['Lavaggio esterno']:[]}),[data.plannerSettings,lines,wash])
 const lineError=damageQuoteError(lines)
 const addManualLine=()=>setLines(current=>[...current,recalculateDamageLine({
  id:crypto.randomUUID(),manualFastLine:true,customerDescription:'',description:'',
  standardWorkId:`manual-fast:${crypto.randomUUID()}`,standardWorkName:'',categoryOrPhase:'',
  panelName:'Lavorazione manuale',category:'altre',calculationType:'per-vehicle',
  quantity:1,discount:0,vatRate:quote.appliedVatRate,unitPrice:0,estimatedMinutes:0,
  taxableAmount:0,vatAmount:0,total:0,materialsIncluded:true,
 },data.plannerSettings)])
 const manualTimes=(line:EstimateLine)=>line.manualPhaseTimes??[{phase:line.categoryOrPhase||'',minutes:line.estimatedMinutes||0}]
 const updateManualTimes=(line:EstimateLine,times:Array<{phase:string;minutes:number}>)=>setLines(current=>current.map(item=>item.id!==line.id?item:recalculateDamageLine({...item,manualPhaseTimes:times,standardWorkName:times[0]?.phase||'',categoryOrPhase:times[0]?.phase||'',requiredSkill:times[0]?.phase||''},data.plannerSettings)))
 const taxable=lines.reduce((sum,line)=>sum+line.unitPrice,0)
 const minutes=lines.reduce((sum,line)=>sum+(line.estimatedMinutes||0),0)+(wash?(data.plannerSettings.eliasExteriorWashMinutes??25):0)
 return <Modal title="Preventivo fast" onClose={onCancel}>
  <form onSubmit={e=>{e.preventDefault();if(busy.current)return;busy.current=true;try{
   const next=createFastEstimate(data,{plate,customerId:owner?.id||customerId,newCustomer:customerId==='new'?{name,phone}:undefined,quote,confirmed,requestedDeliveryDate:delivery,notes})
   const send=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='whatsapp'
   const link=send?fastEstimateWhatsAppLink(next.estimates![0],targetPhone):null
   const chat=link?window.open('about:blank','_blank'):null
   if(link&&!chat)throw new Error('Consenti le finestre popup per aprire WhatsApp, oppure salva il preventivo senza inviare.')
   try{onDone(next,confirmed)}catch(problem){chat?.close();throw problem}
   if(chat&&link){chat.opener=null;chat.location.href=link}
  }catch(problem){setError(problem instanceof Error?problem.message:'Creazione non riuscita.');busy.current=false}}}>
   <p>Per danni lievi: scegli la vettura, aggiungi i pannelli e salva. Prezzi e tempi arrivano dal listino; i danni gravi si gestiscono nel preventivo completo.</p>
   <div className="form-grid">
    <label>Targa<input required minLength={5} value={plate} list="fast-plates" autoComplete="off" onChange={e=>{setPlate(e.target.value.toUpperCase());setWhatsappPhone(null);setError('')}}/></label>
    <datalist id="fast-plates">{data.vehicles.map(v=><option value={v.plate} key={v.id}>{data.customers.find(c=>c.id===v.customerId)?.name}</option>)}</datalist>
    {owner?<p>Cliente riconosciuto: <strong>{owner.name}</strong></p>:<label>Cliente<select required value={customerId} onChange={e=>{setCustomerId(e.target.value);setWhatsappPhone(null)}}><option value="">Scegli cliente</option><option value="new">+ Nuovo cliente</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {!owner&&customerId==='new'&&<><label>Nome nuovo cliente<input required value={name} onChange={e=>setName(e.target.value)}/></label><label>Telefono nuovo cliente<input required type="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></label></>}
   </div>
   <section className="panel"><h3>Aggiungi un pannello</h3><label>Pannello<select value={panelId} onChange={e=>setPanelId(e.target.value)}><option value="">Scegli il pezzo preciso</option>{QUOTE_PANELS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="planner-actions">{choices.flatMap(entry=>entry.prices.map(price=><button type="button" className="secondary" key={`${entry.id}:${price}`} onClick={()=>{if(!panel)return;setLines(chooseEliasPrice(data.plannerSettings,lines,panel,entry,price,quote.appliedVatRate,'lieve',quote.hourlyRate));setError('')}}>{entry.name} · {entry.manualPricing?'Inserisci tempo e prezzo':euro(price)}</button>))}</div>
   </section>
   <button type="button" className="secondary" onClick={addManualLine}>+ Aggiungi lavorazione manuale</button>
   {lines.map((line,index)=><section className="panel" key={line.id}><strong>{line.manualFastLine?'Lavorazione manuale':line.standardWorkName}</strong><p>{line.estimatedMinutes||0} min · {euro(line.unitPrice)} IVA esclusa</p>
    <label>Descrizione riga {index+1}<input required value={damageLineDescription(line)} onChange={e=>setLines(lines.map(item=>item.id===line.id?{...item,customerDescription:e.target.value}:item))}/></label>
    {line.manualFastLine&&<section aria-label={`Tempi lavorazione riga ${index+1}`}>
     {manualTimes(line).map((time,timeIndex)=><div className="form-grid" key={timeIndex}>
      <label>{timeIndex===0?`Fase riga ${index+1}`:`Fase ${timeIndex+1} riga ${index+1}`}<select required value={time.phase} onChange={e=>updateManualTimes(line,manualTimes(line).map((item,i)=>i===timeIndex?{...item,phase:e.target.value}:item))}><option value="">Scegli fase</option>{WORK_CYCLE.filter(phase=>phase!=='Stuccatura'&&phase!=='Consegna').map(phase=><option key={phase} value={phase}>{phaseDisplayName(phase)}</option>)}</select></label>
      <label>{timeIndex===0?`Minuti riga ${index+1}`:`Minuti fase ${timeIndex+1} riga ${index+1}`}<input required type="number" min="1" step="1" value={time.minutes||''} onChange={e=>updateManualTimes(line,manualTimes(line).map((item,i)=>i===timeIndex?{...item,minutes:Number(e.target.value)}:item))}/></label>
      {manualTimes(line).length>1&&<button type="button" className="secondary" onClick={()=>updateManualTimes(line,manualTimes(line).filter((_,i)=>i!==timeIndex))}>Rimuovi fase {timeIndex+1} riga {index+1}</button>}
     </div>)}
     <button type="button" className="secondary" onClick={()=>updateManualTimes(line,[...manualTimes(line),{phase:'',minutes:0}])}>+ Aggiungi fase riga {index+1}</button>
     <p>Un solo prezzo per la riga; il tempo totale è la somma delle fasi. Verniciatura: massimo 3 vetture contemporaneamente, inclusa l’asciugatura.</p>
    </section>}
    <OptionalPanelPhases line={line} settings={data.plannerSettings} onChange={updated=>setLines(lines.map(item=>item.id===line.id?updated:item))}/><details open={line.manualFastLine||undefined}><summary>Modifica prezzo e tempi</summary><label>Prezzo riga {index+1} €<MoneyInput value={line.unitPrice} onValueChange={n=>setLines(lines.map(l=>l.id!==line.id?l:recalculateDamageLine({...l,unitPrice:n??0},data.plannerSettings)))}/></label>
    {(!line.manualFastLine&&(!line.minorDamageTimes||eliasEntryForWork(line.standardWorkId)?.manualPricing))&&<label>Minuti riga {index+1}<input type="number" min="1" value={line.estimatedMinutes||0} onChange={e=>setLines(lines.map(l=>l.id!==line.id?l:recalculateDamageLine({...l,estimatedMinutes:Number(e.target.value),minorDamageTimes:undefined},data.plannerSettings)))}/></label>}
    </details><button type="button" className="secondary" onClick={()=>setLines(lines.filter(l=>l.id!==line.id))}>Rimuovi {line.standardWorkName}</button>
   </section>)}
   <label><input type="checkbox" checked={wash} onChange={e=>setWash(e.target.checked)}/>Includi lavaggio esterno · {data.plannerSettings.eliasExteriorWashMinutes??25} min</label>
   <details><summary>Consegna concordata e note</summary><label>Data consegna concordata<input type="date" value={delivery} onChange={e=>setDelivery(e.target.value)}/></label><label>Note<input value={notes} onChange={e=>setNotes(e.target.value)}/></label></details>
   <section className="panel" aria-label="Riepilogo preventivo fast"><h3>{euro(taxable)} + IVA · {euro(lines.reduce((sum,l)=>sum+l.total,0))} totale</h3><p>Tempo tecnico: {minutes} min. I prezzi non allungano il tempario.</p><p>Condizioni di pagamento del cliente precompilate. Alla conferma: commessa, cono, pianificazione e pubblicazione sui tablet automatiche, con mansioni e disponibilità degli operatori.</p></section>
   <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Il cliente ha già confermato questo preventivo</label>
   <label>Numero WhatsApp del cliente<input type="tel" value={targetPhone} placeholder="+39 333 1234567" onChange={e=>setWhatsappPhone(e.target.value)}/></label>
   <p>WhatsApp apre il riepilogo con lavorazioni, IVA e totale. Conferma l’invio dall’account aziendale collegato; il preventivo resta da confermare finché non registri l’approvazione del cliente.</p>
   {lineError&&<p role="status">{lineError}</p>}
   {error&&<p role="alert">{error}</p>}
   <div className="planner-actions"><button type="button" className="secondary" onClick={onCancel}>Annulla</button><button type="submit" className="primary" disabled={!lines.length||Boolean(lineError)}>{confirmed?'Conferma e crea commessa':'Salva preventivo fast'}</button><button type="submit" value="whatsapp" className="primary" disabled={!lines.length||Boolean(lineError)}>Salva e invia su WhatsApp</button></div>
  </form>
 </Modal>
}
