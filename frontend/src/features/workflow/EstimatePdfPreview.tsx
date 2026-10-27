import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../components/Modal'
import type { ErpData, EstimateDocument } from '../../types'
import { downloadEstimatePdf, estimatePdfFile } from '../../services/estimatePdf'
import { fastEstimateWhatsAppLink } from '../../services/fastEstimateWhatsApp'
export function EstimatePdfPreview({data,estimate,onClose}:{data:ErpData;estimate:EstimateDocument;onClose:()=>void}){
 const result=useMemo(()=>{try{return {file:estimatePdfFile(data,estimate),error:''}}catch(e){return {file:null,error:e instanceof Error?e.message:'PDF non disponibile.'}}},[data,estimate])
 const [url,setUrl]=useState(''),[phone,setPhone]=useState(data.customers.find(c=>c.id===estimate.customerId)?.phone??''),[message,setMessage]=useState('')
 useEffect(()=>{if(!result.file||typeof URL.createObjectURL!=='function')return;const next=URL.createObjectURL(result.file);setUrl(next);return()=>URL.revokeObjectURL(next)},[result.file])
 return <Modal title={`Preventivo PDF · ${estimate.plate}`} onClose={onClose}>
  <p>Documento cliente con intestazione, lavorazioni, imponibile, IVA e totale. Costi interni e margini non vengono mostrati.</p>
  {(!data.companyProfile?.vatId||!data.companyProfile?.address)&&<p role="status">Completa l’intestazione in Finanza → Profilo azienda e progressivi → Aggiorna dati azienda.</p>}
  {result.error&&<p role="alert">{result.error}</p>}
  {result.file&&<><p><strong>{result.file.name}</strong></p>{url&&<iframe title="Anteprima preventivo PDF" src={url} style={{width:'100%',height:'65vh',border:'1px solid #aaa'}}/>}
   <label>Numero WhatsApp destinatario<input type="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
   <p>Il PDF viene scaricato. Nella chat WhatsApp premi la graffetta → Documento, scegli il PDF e conferma l’invio dall’account aziendale.</p>
   <div className="planner-actions"><button className="primary" onClick={()=>{try{downloadEstimatePdf(result.file!);setMessage('PDF scaricato.')}catch{setMessage('Download non riuscito. Riprova dal browser.')}}}>Scarica PDF</button>
    <button className="primary" onClick={()=>{let chat:Window|null=null;try{const link=fastEstimateWhatsAppLink(estimate,phone);chat=window.open('about:blank','_blank');if(!chat)throw Error('Consenti le finestre popup per aprire WhatsApp.');downloadEstimatePdf(result.file!);chat.opener=null;chat.location.href=link;setMessage('PDF scaricato. Allegalo come Documento nella chat WhatsApp aperta.')}catch(e){chat?.close();setMessage(e instanceof Error?e.message:'Invio non preparato.')}}}>Scarica PDF e apri WhatsApp</button></div>
  </>}
  {message&&<p role="status">{message}</p>}
 </Modal>
}
