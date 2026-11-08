import { useMemo,useState } from 'react'
import type { ErpData } from '../../types'
import { Modal } from '../../components/Modal'
import { MoneyInput } from '../../components/MoneyInput'
import { createVehicleRiba,ribaVehicleOptions } from '../../services/vehicleRiba'
const money=(n:number)=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date())
export function VehicleRibaModal({data,vehicleId,onClose,onSave}:{data:ErpData;vehicleId?:string;onClose:()=>void;onSave:(next:ErpData)=>void}){
 const options = useMemo(() => ribaVehicleOptions(data).filter(option => !vehicleId || option.vehicleId === vehicleId), [data, vehicleId])
 const vehicle = data.vehicles.find(item => item.id === vehicleId)
 const firstOption = vehicleId && options.length === 1 ? options[0] : undefined
 const [selected,setSelected]=useState<Record<string,number>>(() => firstOption ? {[firstOption.key]: firstOption.amount} : {})
 const suggestedDue = firstOption ? data.invoices.find(invoice => invoice.id === firstOption.invoiceId)?.dueDate ?? '' : ''
 const [number,setNumber]=useState(''),[bank,setBank]=useState(!vehicleId || data.bankAccounts.length === 1 ? data.bankAccounts[0]?.id ?? '' : '')
 const [presentation,setPresentation]=useState(today()),[due,setDue]=useState(suggestedDue),[collection,setCollection]=useState('')
 const [mode,setMode]=useState<'maturity'|'advance'>('maturity')
 const [advanceDate,setAdvanceDate]=useState(today()),[advanceAmount,setAdvanceAmount]=useState<number|null>(null)
 const [fees,setFees]=useState(0),[interest,setInterest]=useState(0),[error,setError]=useState('')
 const total=Object.values(selected).reduce((sum,n)=>sum+n,0)
 return <Modal title={vehicle ? `Ri.Ba. caricata · ${vehicle.plate}` : "Carica RIBA per vetture"} onClose={onClose}><form onSubmit={e=>{e.preventDefault();try{onSave(createVehicleRiba(data,{number,bankAccountId:bank,presentationDate:presentation,dueDate:due,collectionDate:collection||due,selections:Object.entries(selected).map(([key,amount])=>({key,amount})),mode,advanceDate,advanceAmount:advanceAmount??total,fees,interest}))}catch(problem){setError(problem instanceof Error?problem.message:'Registrazione non riuscita.')}}}>
  <p>{vehicle ? 'Controlla la fattura, l’importo e le date effettive della distinta prima di confermare.' : 'Seleziona le vetture con fattura e residuo disponibile. Questa operazione registra una distinta effettiva, separata dalle date dei preventivi.'}</p>
  {suggestedDue && <p>La scadenza proposta viene dalla fattura. Verifica la data della distinta bancaria.</p>}
  <div className="form-grid">
   <label>Numero distinta<input required value={number} onChange={e=>setNumber(e.target.value)}/></label>
   <label>Banca RIBA<select required value={bank} onChange={e=>setBank(e.target.value)}><option value="">Scegli banca</option>{data.bankAccounts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
   <label>Data caricamento RIBA<input required type="date" value={presentation} onChange={e=>setPresentation(e.target.value)}/></label>
   <label>Scadenza bancaria RIBA<input required type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
   <label>Data incasso RIBA<input required type="date" value={collection||due} onChange={e=>setCollection(e.target.value)}/></label>
   <label>Gestione RIBA<select value={mode} onChange={e=>setMode(e.target.value as 'maturity'|'advance')}><option value="maturity">A maturazione</option><option value="advance">Con anticipo bancario</option></select></label>
  </div>
  <div className="table-wrap"><table><thead><tr><th>Seleziona vettura</th><th>Fattura / cliente</th><th>Importo RIBA IVA inclusa</th></tr></thead><tbody>{options.map(option=><tr key={option.key}><td><label><input type="checkbox" checked={selected[option.key]!==undefined} onChange={e=>setSelected(current=>{const next={...current};if(e.target.checked)next[option.key]=option.amount;else delete next[option.key];return next})}/>{option.plate}</label></td><td>{option.invoiceNumber}<small>{option.customerName}</small></td><td>{selected[option.key]!==undefined?<MoneyInput aria-label={`Importo RIBA ${option.plate} ${option.invoiceNumber}`} minValue={.01} maxValue={option.amount} value={selected[option.key]} onValueChange={amount=>setSelected({...selected,[option.key]:amount??0})}/>:money(option.amount)}</td></tr>)}</tbody></table></div>
  {!options.length&&<p>Nessuna fattura con residuo disponibile. Verifica che la fattura sia stata emessa e che l’importo non sia già registrato.</p>}
  <section className="panel" aria-label="Riepilogo RIBA"><strong>{Object.keys(selected).length} vetture selezionate · Totale {money(total)}</strong><p>Avviso in Finanza e scadenziario a partire da 15 giorni prima della scadenza bancaria.</p></section>
  {mode==='advance'&&<div className="form-grid">
   <label>Data anticipo effettivo<input required type="date" max={today()} value={advanceDate} onChange={e=>setAdvanceDate(e.target.value)}/></label>
   <label>Importo anticipo<MoneyInput minValue={.01} maxValue={total} value={advanceAmount??total} onValueChange={setAdvanceAmount}/></label>
   <label>Commissioni bancarie<MoneyInput minValue={0} value={fees} onValueChange={value=>setFees(value??0)}/></label>
   <label>Interessi bancari<MoneyInput minValue={0} value={interest} onValueChange={value=>setInterest(value??0)}/></label>
   <p>Liquidità dall’anticipo: {money(Math.max(0,(advanceAmount??total)-fees-interest))}. Residuo a maturazione: {money(Math.max(0,total-(advanceAmount??total)))}.</p>
  </div>}
  {error&&<p role="alert">{error}</p>}
  <div className="form-actions"><button type="button" onClick={onClose}>Annulla</button><button type="submit" className="primary" disabled={!Object.keys(selected).length||!bank}>Registra RIBA</button></div>
 </form></Modal>
}
