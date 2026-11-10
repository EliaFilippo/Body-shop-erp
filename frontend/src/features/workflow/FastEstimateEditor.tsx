import { estimatePdfFile, downloadEstimatePdf } from '../../services/estimatePdf'
import { DeliveryForecastPanel } from '../../components/DeliveryForecastPanel'
import { QuoteEconomicsPreview } from './QuoteEconomicsPreview'
import { FastPaymentTerms } from './FastPaymentTerms'
import { OptionalPanelPhases } from './OptionalPanelPhases'
import { useMemo, useRef, useState } from 'react'
import type { ErpData, EstimateDocument, EstimateLine, EstimatePaymentTerms } from '../../types'
import { Modal } from '../../components/Modal'
import { MoneyInput } from '../../components/MoneyInput'
import { createDefaultQuote } from '../../services/acceptance'
import { chooseEliasPrice, recalculateDamageLine, damageQuoteIssue, damageLineForSave, damageLineDescription, acceptanceEstimateLines } from '../../services/damageQuote'
import { eliasPricesForPanel, eliasEntryForWork } from '../../services/eliasPriceList'
import { createFastEstimate } from '../../services/fastEstimate'
import { fastEstimateWhatsAppLink } from '../../services/fastEstimateWhatsApp'
import { normalizePlate } from '../../services/erp'
import { WORK_CYCLE, phaseDisplayName } from '../../services/workCycle'
import { QUOTE_PANELS } from './vehiclePanels'
const euro=(n:number)=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})

export function FastEstimateEditor({data,livePrograms,initial,onDone,onCancel}:{data:ErpData;initial?:EstimateDocument;livePrograms?:ErpData['operatorPrograms'];onDone:(next:ErpData,confirmed:boolean,pdfPrepared?:boolean)=>void;onCancel:()=>void}) {
 const forecastData = useMemo(() => livePrograms ? {...data,operatorPrograms:livePrograms} : data, [data,livePrograms])
 const [discountInput, setDiscountInput] = useState(() => {
  const gross = initial?.lines.reduce((sum,line)=>sum+line.quantity*line.unitPrice,0) ?? 0
  const savedDiscount = initial?.lines.reduce((sum,line)=>sum+line.discount,0) ?? 0
  return gross>0 && savedDiscount>0 ? String(savedDiscount/gross*100) : ''
 })
 const [plate,setPlate]=useState(initial?.plate??'')
 const [customerId,setCustomerId]=useState(initial?.customerId??'')
 const [name,setName]=useState('')
 const [phone,setPhone]=useState('')
 const [whatsappPhone,setWhatsappPhone]=useState<string | null>(null)
 const [panelId,setPanelId]=useState('')
 const [lines,setLines]=useState<EstimateLine[]>(initial?.lines??[])
 const [wash,setWash]=useState(initial?.selectedPhases?.includes('Lavaggio esterno')??false)
 const [confirmed,setConfirmed]=useState(false)
 const [delivery,setDelivery]=useState(initial?.requestedDeliveryDate??'')
 const [planningPrecedence,setPlanningPrecedence]=useState(initial?.planningPrecedence??false)
 const [termsOverride,setTermsOverride]=useState<EstimatePaymentTerms|null>(initial?.paymentTerms??null)
 const [notes,setNotes]=useState(initial?.notes??'')
 const [error,setError]=useState('')
 const busy=useRef(false)
 const lineElements=useRef(new Map<string,HTMLElement>())
 const existing=data.vehicles.find(v=>normalizePlate(v.plate)===normalizePlate(plate))
 const owner=data.customers.find(c=>c.id===existing?.customerId)
 const recipient=owner||data.customers.find(c=>c.id===customerId)
 const terms:EstimatePaymentTerms=termsOverride??{method:recipient?.usualPaymentMethod??'Bonifico',days:recipient?.paymentDays??0,endOfMonth:Boolean(recipient?.endOfMonth),expectedInvoiceDate:'',atDelivery:!recipient}
 const targetPhone=whatsappPhone??(recipient?.phone||phone)
 const panel=QUOTE_PANELS.find(p=>p.id===panelId)
 const choices=panel?eliasPricesForPanel(panel.id,panel.name,data.plannerSettings):[]
 const discountPercent = Number(discountInput.trim().replace(',', '.'))
 const invalidDiscount = !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100
 const subtotal = lines.reduce((sum, line) => sum + line.unitPrice, 0)
 const discount = invalidDiscount ? 0 : Math.round(subtotal * discountPercent) / 100
 const quote = useMemo(() => {
  const base = createDefaultQuote(data.plannerSettings, new Intl.DateTimeFormat('sv-SE', {
   timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit',
  }).format(new Date()))
  return {
   ...base,
   appliedVatRate: initial?.lines[0]?.vatRate ?? base.appliedVatRate,
   manualOnlyPricing: true,
   damageLines: lines.map(damageLineForSave),
   selectedPhases: wash ? ['Lavaggio esterno'] : [],
   lines: discount > 0 ? [...base.lines, {
    id: 'fast-discount', kind: 'discount' as const, description: 'Sconto preventivo',
    quantity: 1, unitPrice: discount, unitCost: 0, source: 'manual' as const,
   }] : base.lines,
  }
 }, [data.plannerSettings, lines, wash, discount, initial])
 const lineIssue=damageQuoteIssue(lines)
 const lineError=lineIssue?.message??''
 const goToIssue=()=>{
  if(!lineIssue)return
  const row=lineElements.current.get(lineIssue.lineId)
  row?.querySelectorAll('details').forEach(details=>{details.open=true})
  row?.scrollIntoView?.({behavior:'smooth',block:'center'})
  const field=row?.querySelector<HTMLElement>('[aria-invalid="true"], input:invalid, select:invalid')??row?.querySelector<HTMLElement>('input')
  field?.focus()
 }
 const addManualLine=()=>setLines(current=>[recalculateDamageLine({
  id:crypto.randomUUID(),manualFastLine:true,customerDescription:'',description:'',
  standardWorkId:`manual-fast:${crypto.randomUUID()}`,standardWorkName:'',categoryOrPhase:'',
  panelName:'Lavorazione manuale',category:'altre',calculationType:'per-vehicle',
  quantity:1,discount:0,vatRate:quote.appliedVatRate,unitPrice:0,estimatedMinutes:0,
  taxableAmount:0,vatAmount:0,total:0,materialsIncluded:true,
 },data.plannerSettings),...current])
 const manualTimes=(line:EstimateLine)=>line.manualPhaseTimes??[{phase:line.categoryOrPhase||'',minutes:line.estimatedMinutes||0}]
 const updateManualTimes=(line:EstimateLine,times:Array<{phase:string;minutes:number}>)=>setLines(current=>current.map(item=>item.id!==line.id?item:recalculateDamageLine({...item,manualPhaseTimes:times,standardWorkName:times[0]?.phase||'',categoryOrPhase:times[0]?.phase||'',requiredSkill:times[0]?.phase||''},data.plannerSettings)))
 const taxable = subtotal - discount
 const netLines = lines.length && !lineError ? acceptanceEstimateLines(quote) : []
 const total = netLines.length ? netLines.reduce((sum, line) => {
  const net = Math.round((line.quantity * line.unitPrice - line.discount) * 100) / 100
  return sum + net + Math.round(net * line.vatRate) / 100
 }, 0) : taxable * (1 + quote.appliedVatRate / 100)
 const minutes=lines.reduce((sum,line)=>sum+(line.estimatedMinutes||0),0)+(wash?(data.plannerSettings.eliasExteriorWashMinutes??25):0)
 return <Modal title="Preventivo fast" onClose={onCancel}>
  <form onSubmit={e=>{e.preventDefault();if(busy.current||invalidDiscount)return;busy.current=true;try{
   const next=createFastEstimate(data,{estimateId:initial?.id,plate,customerId:owner?.id||customerId,newCustomer:customerId==='new'?{name,phone}:undefined,quote,confirmed,requestedDeliveryDate:delivery,planningPrecedence,notes,paymentTerms:terms},undefined,livePrograms)
   const saved = initial ? next.estimates!.find(item=>item.id===initial.id)! : next.estimates![0]
   const send=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='whatsapp'
   const link=send?fastEstimateWhatsAppLink(saved,targetPhone):null
   const file=send?estimatePdfFile(next,saved):null
   const chat=link?window.open('about:blank','_blank'):null
   if(link&&!chat)throw new Error('Consenti le finestre popup per aprire WhatsApp, oppure salva il preventivo senza inviare.')
   try{if(file)downloadEstimatePdf(file);onDone(next,confirmed,send)}catch(problem){chat?.close();throw problem}
   if(chat&&link){chat.opener=null;chat.location.href=link}
  }catch(problem){setError(problem instanceof Error?problem.message:'Creazione non riuscita.');busy.current=false}}}>
   <p>Per danni lievi: scegli la vettura, aggiungi i pannelli e salva. Prezzi e tempi arrivano dal listino; i danni gravi si gestiscono nel preventivo completo.</p>
   <div className="form-grid">
    <label>Targa<input required minLength={5} readOnly={Boolean(initial)} value={plate} list="fast-plates" autoComplete="off" onChange={e=>{setPlate(e.target.value.toUpperCase());setWhatsappPhone(null);setTermsOverride(null);setError('')}}/></label>
    <datalist id="fast-plates">{data.vehicles.map(v=><option value={v.plate} key={v.id}>{data.customers.find(c=>c.id===v.customerId)?.name}</option>)}</datalist>
    {owner?<p>Cliente riconosciuto: <strong>{owner.name}</strong></p>:<label>Cliente<select required value={customerId} onChange={e=>{setCustomerId(e.target.value);setWhatsappPhone(null);setTermsOverride(null)}}><option value="">Scegli cliente</option><option value="new">+ Nuovo cliente</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {!owner&&customerId==='new'&&<><label>Nome nuovo cliente<input required value={name} onChange={e=>setName(e.target.value)}/></label><label>Telefono nuovo cliente<input required type="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></label></>}
   </div>
   <section className="panel"><h3>Aggiungi un pannello</h3><label>Pannello<select value={panelId} onChange={e=>setPanelId(e.target.value)}><option value="">Scegli il pezzo preciso</option>{QUOTE_PANELS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="planner-actions">{choices.flatMap(entry=>entry.prices.map(price=><button type="button" className="secondary" key={`${entry.id}:${price}`} onClick={()=>{if(!panel)return;setLines(current=>{
     const updated=chooseEliasPrice(data.plannerSettings,current,panel,entry,price,quote.appliedVatRate,'lieve',quote.hourlyRate)
     return [...updated.slice(-1),...updated.slice(0,-1)]
    });setError('')}}>{entry.name} · {entry.manualPricing?'Inserisci tempo e prezzo':euro(price)}</button>))}</div>
   </section>
   <button type="button" className="secondary" onClick={addManualLine}>+ Aggiungi lavorazione manuale</button>
   {lines.map((line,index)=><section className="panel" key={line.id} ref={element=>{if(element)lineElements.current.set(line.id,element);else lineElements.current.delete(line.id)}}><strong>Riga {index+1} · {line.manualFastLine?'Lavorazione manuale':line.standardWorkName}</strong><p>{line.estimatedMinutes||0} min · {euro(line.unitPrice)} IVA esclusa</p>
    <label>Descrizione riga {index+1}<input required value={damageLineDescription(line)} onChange={e=>setLines(lines.map(item=>item.id===line.id?{...item,customerDescription:e.target.value}:item))}/></label>
    {line.manualFastLine&&<section aria-label={`Tempi lavorazione riga ${index+1}`}>
     {manualTimes(line).map((time,timeIndex)=><div className="form-grid" key={timeIndex}>
      <label>{timeIndex===0?`Fase riga ${index+1}`:`Fase ${timeIndex+1} riga ${index+1}`}<select required={Boolean(time.phase||time.minutes||manualTimes(line).length===1)} aria-invalid={Boolean(!time.phase&&time.minutes)} value={time.phase} onChange={e=>updateManualTimes(line,manualTimes(line).map((item,i)=>i===timeIndex?{...item,phase:e.target.value}:item))}><option value="">Scegli fase</option>{WORK_CYCLE.filter(phase=>phase!=='Consegna').map(phase=><option key={phase} value={phase}>{phaseDisplayName(phase)}</option>)}</select></label>
      <label>{timeIndex===0?`Minuti riga ${index+1}`:`Minuti fase ${timeIndex+1} riga ${index+1}`}<input required={Boolean(time.phase||time.minutes||manualTimes(line).length===1)} aria-invalid={Boolean(time.phase&&time.minutes<=0)} type="number" min="1" step="1" value={time.minutes||''} onChange={e=>updateManualTimes(line,manualTimes(line).map((item,i)=>i===timeIndex?{...item,minutes:Number(e.target.value)}:item))}/></label>
      {manualTimes(line).length>1&&<button type="button" className="secondary" onClick={()=>updateManualTimes(line,manualTimes(line).filter((_,i)=>i!==timeIndex))}>Rimuovi fase {timeIndex+1} riga {index+1}</button>}
     </div>)}
     <button type="button" className="secondary" onClick={()=>updateManualTimes(line,[...manualTimes(line),{phase:'',minutes:0}])}>+ Aggiungi fase riga {index+1}</button>
     <p>Un solo prezzo per la riga; il tempo totale è la somma delle fasi. Verniciatura: massimo 3 vetture contemporaneamente, inclusa l’asciugatura.</p>
     <small>Le fasi aggiuntive lasciate completamente vuote non vengono salvate. Se scegli una fase, inserisci i minuti oppure rimuovila.</small>
    </section>}
    {lineIssue?.lineId===line.id&&<p className="damage-incomplete">{lineIssue.message}</p>}
    <OptionalPanelPhases line={line} settings={data.plannerSettings} onChange={updated=>setLines(lines.map(item=>item.id===line.id?updated:item))}/><details open={line.manualFastLine||undefined}><summary>Modifica prezzo e tempi</summary><label>Prezzo riga {index+1} €<MoneyInput value={line.unitPrice} onValueChange={n=>setLines(lines.map(l=>l.id!==line.id?l:recalculateDamageLine({...l,unitPrice:n??0},data.plannerSettings)))}/></label>
    {(!line.manualFastLine&&(!line.minorDamageTimes||eliasEntryForWork(line.standardWorkId)?.manualPricing))&&<label>Minuti riga {index+1}<input type="number" min="1" value={line.estimatedMinutes||0} onChange={e=>setLines(lines.map(l=>l.id!==line.id?l:recalculateDamageLine({...l,estimatedMinutes:Number(e.target.value),minorDamageTimes:undefined},data.plannerSettings)))}/></label>}
    </details><button type="button" className="secondary" onClick={()=>setLines(lines.filter(l=>l.id!==line.id))}>Rimuovi {line.standardWorkName}</button>
   </section>)}
   <label><input type="checkbox" checked={wash} onChange={e=>setWash(e.target.checked)}/>Includi lavaggio esterno · {data.plannerSettings.eliasExteriorWashMinutes??25} min</label>
   <DeliveryForecastPanel data={forecastData} vehicleId={existing?.id} plate={plate} quote={quote} estimate={initial} requestedDeliveryDate={delivery} onRequestedDeliveryDateChange={date=>{setDelivery(date);if(!date)setPlanningPrecedence(false)}} planningPrecedence={planningPrecedence} onPlanningPrecedenceChange={setPlanningPrecedence}/>
   <details><summary>Note</summary><label>Note<input value={notes} onChange={e=>setNotes(e.target.value)}/></label></details>
   <FastPaymentTerms value={terms} delivery={delivery} onChange={setTermsOverride}/>
   <section className="panel" aria-label="Riepilogo preventivo fast"><label>Sconto (%)<input inputMode="decimal" value={discountInput} onChange={e => setDiscountInput(e.target.value)} placeholder="0" aria-invalid={invalidDiscount}/></label>
    {invalidDiscount && <p role="alert">Inserisci una percentuale da 0 a 100.</p>}
    {discount > 0 && <p>Imponibile prima dello sconto {euro(subtotal)} · Sconto {euro(discount)}</p>}
    <h3>{euro(taxable)} + IVA · {euro(total)} totale</h3><p>Tempo tecnico: {minutes} min. I prezzi non allungano il tempario.</p><p>Condizioni di pagamento del cliente precompilate. Alla conferma: commessa, cono, pianificazione e pubblicazione sui tablet automatiche, con mansioni e disponibilità degli operatori.</p></section>
   <QuoteEconomicsPreview quote={quote} settings={data.plannerSettings} nightly={data.nightlyPlanning?.economics}/>
   <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Il cliente ha già confermato questo preventivo</label>
   <label>Numero WhatsApp del cliente<input type="tel" value={targetPhone} placeholder="+39 333 1234567" onChange={e=>setWhatsappPhone(e.target.value)}/></label>
   <p>Il gestionale scarica il preventivo PDF e apre WhatsApp. Nella chat premi la graffetta → Documento e allega il PDF appena scaricato. Conferma l’invio dall’account aziendale collegato; il preventivo resta da confermare finché non registri l’approvazione del cliente.</p>
   {lineError&&<p role="status">{lineError} <button type="button" className="secondary" onClick={goToIssue}>Vai alla riga {lineIssue!.lineIndex+1} da completare</button></p>}
   {error&&<p role="alert">{error}</p>}
   <div className="planner-actions"><button type="button" className="secondary" onClick={onCancel}>Annulla</button><button type="submit" className="primary" disabled={!lines.length||Boolean(lineError)||invalidDiscount}>{confirmed?'Conferma e crea commessa':'Salva preventivo fast'}</button><button type="submit" value="whatsapp" className="primary" disabled={!lines.length||Boolean(lineError)||invalidDiscount}>Salva e invia su WhatsApp</button></div>
  </form>
 </Modal>
}
