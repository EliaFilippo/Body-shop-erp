import { useState } from 'react'
import type { ErpData, QuoteDocument } from '../../types'
import { Modal } from '../../components/Modal'
import { attachQuotePhotos, confirmQuoteFromCustomerMessage } from '../../services/documents'

export function QuoteActions({ data, quote, onChange }: { data: ErpData; quote: QuoteDocument; onChange: (data:ErpData)=>void }) {
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [confirm,setConfirm]=useState(false)
 const [channel,setChannel]=useState<'whatsapp'|'email'>('whatsapp');const [message,setMessage]=useState('')
 const [receivedAt,setReceivedAt]=useState('')
 const download=(file:File)=>{const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
 const pdf=async(share:boolean)=>{setError('');setBusy(true);try{const {quotePdfFile}=await import('../../services/quoteShare');const file=quotePdfFile(data,quote)
  if(share && navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:`Preventivo ${quote.number}`})}
  else {download(file);if(share)setError('PDF scaricato con le foto: allegalo alla bozza WhatsApp o email aperta con Comunica.')}
 }catch(e){if(!(e instanceof Error&&e.name==='AbortError'))setError(e instanceof Error?e.message:'Condivisione non riuscita.')}finally{setBusy(false)}}
 return <>
  <button disabled={busy} onClick={()=>void pdf(false)}>Scarica PDF con foto</button>
  <button disabled={busy} onClick={()=>void pdf(true)}>Condividi PDF</button>
  {quote.status!=='accettato'&&<label className="tag">Foto ({quote.photos?.length ?? 0}/6)<input aria-label={`Foto preventivo ${quote.number}`} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={async e=>{
   const files=Array.from(e.currentTarget.files??[]);e.currentTarget.value='';if(!files.length)return;setBusy(true);setError('')
   try{const {readQuotePhotos}=await import('../../services/quoteShare');if(files.length+(quote.photos?.length??0)>6)throw new Error('Massimo 6 foto per preventivo.');onChange(attachQuotePhotos(data,quote.id,[...(quote.photos??[]),...await readQuotePhotos(files)]))}catch(e){setError(e instanceof Error?e.message:'Foto non caricate.')}finally{setBusy(false)}
  }}/></label>}
  {quote.status!=='accettato'&&!!quote.photos?.length&&<button disabled={busy} onClick={()=>{try{onChange(attachQuotePhotos(data,quote.id,[]))}catch(e){setError(e instanceof Error?e.message:'Rimozione non riuscita.')}}}>Rimuovi foto</button>}
  {quote.status!=='accettato'&&quote.estimateId&&<button onClick={()=>{setError('');setReceivedAt(new Date().toISOString());setConfirm(true)}}>Registra conferma cliente</button>}
  {quote.customerConfirmation&&<small>Conferma {quote.customerConfirmation.channel} · {new Date(quote.customerConfirmation.receivedAt).toLocaleString('it-IT')}</small>}
  {error&&<small role="status">{error}</small>}
  {confirm&&<Modal title={`Conferma cliente · ${quote.number}`} onClose={()=>setConfirm(false)}>
   <form className="form-grid" onSubmit={e=>{e.preventDefault();try{onChange(confirmQuoteFromCustomerMessage(data,quote.id,{channel,message,receivedAt,recordedAt:new Date().toISOString()}));setConfirm(false);setMessage('')}catch(e){setError(e instanceof Error?e.message:'Conferma non registrata.')}}}>
    <p className="full">Verifica che il cliente confermi questo preventivo e queste condizioni. Registrando la risposta viene creata automaticamente una sola commessa. Le risposte esterne non vengono lette automaticamente.</p>
    <label>Risposta ricevuta su<select value={channel} onChange={e=>setChannel(e.target.value as 'whatsapp'|'email')}><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></label>
    <label>Data e ora ricevute (con fuso orario)<input required value={receivedAt} onChange={e=>setReceivedAt(e.target.value)}/></label>
    <label className="full">Messaggio di conferma del cliente<textarea required value={message} onChange={e=>setMessage(e.target.value)} /></label>
    {error&&<p role="alert">{error}</p>}
    <div className="form-actions"><button type="button" onClick={()=>setConfirm(false)}>Annulla</button><button className="primary" type="submit">Conferma e avvia il flusso</button></div>
   </form>
  </Modal>}
 </>
}
