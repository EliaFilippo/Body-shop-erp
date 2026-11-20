import { useState } from 'react'
import type { ErpData } from '../../types'
import { ribaVehicleOptions } from '../../services/vehicleRiba'
import { ribaCustomerIds,setRibaInvoiceReference } from '../../services/ribaManagement'
import { settleRibaBatch } from '../../services/finance'
import type { RibaBatch } from '../../types'
import { VehicleRibaModal } from './VehicleRibaModal'
const money=(n:number)=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
export function RibaManagementPage({data,onChange}:{data:ErpData;onChange:(data:ErpData)=>void}) {
 const [query,setQuery]=useState(''),[customerId,setCustomerId]=useState(''),[vehicleId,setVehicleId]=useState<string>()
 const [error,setError]=useState('')
 const eligible=ribaCustomerIds(data)
 const customers=data.customers.filter(c=>eligible.has(c.id)).filter(c=>c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
 const customer=data.customers.find(c=>c.id===customerId)
 const pending=ribaVehicleOptions(data).filter(o=>data.vehicles.find(v=>v.id===o.vehicleId)?.customerId===customerId && (!o.invoiceId || data.invoices.find(i=>i.id===o.invoiceId)?.paymentMethod==='R.I.B.A.'))
 const loaded=data.ribaBatches.filter(b=>!['Stornata','Insoluta'].includes(b.status)).flatMap(b=>{
 const links=[...(b.vehicleLinks??[]),...(b.pendingVehicleLinks??[])]
 const rows=links.filter(l=>data.vehicles.find(v=>v.id===l.vehicleId)?.customerId===customerId).map(l=>({vehicleId:l.vehicleId,plate:l.plate,amount:l.amount,batch:b}))
 for(const a of b.allocations){if(links.some(l=>'invoiceId' in l && l.invoiceId===a.invoiceId))continue;const invoice=data.invoices.find(i=>i.id===a.invoiceId&&i.customerId===customerId);if(!invoice)continue;const vehicles=[...new Set(invoice.lines.map(l=>l.vehicleId).filter(Boolean))];if(!vehicles.length&&invoice.vehicleId)vehicles.push(invoice.vehicleId);const weights=vehicles.map(id=>invoice.lines.filter(l=>l.vehicleId===id).reduce((s,l)=>s+l.total,0));const total=weights.reduce((s,n)=>s+n,0);let assigned=0;vehicles.forEach((id,index)=>{const amount=index===vehicles.length-1?a.amount-assigned:Math.round(a.amount*(total?weights[index]/total:1/vehicles.length)*100)/100;assigned+=amount;rows.push({vehicleId:id,plate:data.vehicles.find(v=>v.id===id)?.plate??'Vettura',amount,batch:b})})}
 return rows
 })
 return <section className="panel"><h2>Gestione RiBa</h2><label>Nome cliente<input value={query} onChange={e=>{setQuery(e.target.value);setCustomerId('')}} placeholder="Cerca cliente…" /></label><div className="row-actions">{customers.map(c=><button key={c.id} onClick={()=>{setCustomerId(c.id);setQuery(c.name)}}>{c.name}</button>)}</div>{error&&<p role="alert">{error}</p>}{!customers.length&&<p>Nessun cliente con RiBa caricate o disponibili da caricare.</p>}{customer&&<><h3>{customer.name}</h3><p>Totali IVA inclusa, su tutti i periodi. Le caricate comprendono anche le distinte incassate; quelle stornate o insolute sono escluse. Le quote delle vecchie distinte senza dettaglio vettura sono ripartite in proporzione alle righe fattura.</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,320px),1fr))',gap:20}}><section><h3>RiBa caricate · {money(loaded.reduce((s,r)=>s+r.amount,0))}</h3>{loaded.map((r,i)=><div className="panel" key={`${r.batch.id}-${i}`}><strong>{r.plate} · {money(r.amount)}</strong><p>Distinta {r.batch.number} · {r.batch.status}</p><p>Caricata {r.batch.presentationDate} · Scadenza {r.batch.dueDate}</p><RibaRowActions data={data} batch={r.batch} vehicleId={r.vehicleId} onChange={onChange} onError={setError}/><button onClick={()=>setVehicleId(r.vehicleId)}>Gestisci RiBa</button></div>)}{!loaded.length&&<p>Nessuna RiBa caricata.</p>}</section><section><h3>RiBa da caricare · {money(pending.reduce((s,r)=>s+r.amount,0))}</h3>{pending.map(r=><div className="panel" key={r.key}><strong>{r.plate} · {r.amount>0?money(r.amount):'Importo da inserire'}</strong><p>{r.invoiceNumber}</p><button onClick={()=>setVehicleId(r.vehicleId)}>Carica RiBa</button></div>)}{!pending.length&&<p>Nessuna vettura disponibile da caricare.</p>}</section></div></>}{vehicleId&&<VehicleRibaModal data={data} vehicleId={vehicleId} onClose={()=>setVehicleId(undefined)} onAddBank={bank=>onChange({...data,bankAccounts:[...data.bankAccounts,bank]})} onSave={next=>{onChange(next);setVehicleId(undefined)}}/>}</section>
}

function RibaRowActions({data,batch,vehicleId,onChange,onError}:{data:ErpData;batch:RibaBatch;vehicleId:string;onChange:(data:ErpData)=>void;onError:(message:string)=>void}) {
 const linkedInvoice=data.invoices.find(i=>batch.allocations.some(a=>a.invoiceId===i.id)&&(i.vehicleId===vehicleId||i.lines.some(l=>l.vehicleId===vehicleId)))
 const saved=batch.invoiceReferences?.find(r=>r.vehicleId===vehicleId)?.number??linkedInvoice?.number??''
 const [number,setNumber]=useState(saved)
 const [date,setDate]=useState(()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date()))
 const perform=(action:()=>void)=>{try{action();onError('')}catch(e){onError(e instanceof Error?e.message:'Operazione non riuscita.')}}
 return <div><label>Numero fattura · riferimento<input value={number} onChange={e=>setNumber(e.target.value)}/></label><button onClick={()=>perform(()=>onChange(setRibaInvoiceReference(data,batch.id,vehicleId,number)))}>Salva numero fattura</button><small>Riferimento della vettura: non emette né modifica una fattura fiscale.</small>{batch.status==='Chiusa'?<p className="tag">Pagata · incasso definitivo registrato</p>:<><label>Data pagamento<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button onClick={()=>{if(window.confirm(`Registrare come pagata l’intera distinta ${batch.number} di ${money(batch.total)}? Sono incluse tutte le vetture della distinta, anche di altri clienti. L’incasso aggiorna il saldo bancario una sola volta.`))perform(()=>onChange(settleRibaBatch(data,batch.id,date)))}}>Segna distinta pagata</button></>}</div>
}
