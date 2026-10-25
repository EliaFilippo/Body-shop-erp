import type { EstimatePaymentTerms } from '../../types'
import { expectedPaymentDate } from '../../services/paymentTerms'
export function FastPaymentTerms({value,delivery,onChange}:{value:EstimatePaymentTerms;delivery:string;onChange:(value:EstimatePaymentTerms)=>void}){
 const date=expectedPaymentDate(value,delivery)
 return <fieldset><legend>Pagamento del preventivo Fast</legend>
  <div className="form-grid">
   <label>Metodo di pagamento<select value={value.atDelivery?'delivery':value.method} onChange={e=>onChange({...value,method:e.target.value==='delivery'?'Bonifico':e.target.value as EstimatePaymentTerms['method'],atDelivery:e.target.value==='delivery',days:e.target.value==='delivery'?0:value.days,endOfMonth:e.target.value==='delivery'?false:value.endOfMonth})}>
    <option value="delivery">Bonifico alla consegna</option><option>Bonifico</option><option value="R.I.B.A.">RIBA</option><option>Contanti</option><option>POS</option><option>Personalizzato</option>
   </select></label>
   {!value.atDelivery&&<><label>Scadenza pagamento<select value={value.days} onChange={e=>onChange({...value,days:Number(e.target.value)})}>{[...new Set([0,30,40,60,75,90,value.days])].sort((a,b)=>a-b).map(days=><option key={days} value={days}>{days===0?'Immediato':`${days} giorni`}</option>)}</select></label>
   <label>Data prevista fatturazione<input type="date" value={value.expectedInvoiceDate} onChange={e=>onChange({...value,expectedInvoiceDate:e.target.value})}/></label>
   <label><input type="checkbox" checked={value.endOfMonth} onChange={e=>onChange({...value,endOfMonth:e.target.checked})}/>Fine mese</label></>}
   <label>Data di incasso prevista<input type="date" value={value.expectedCollectionDate??''} onChange={e=>onChange({...value,expectedCollectionDate:e.target.value})}/></label>
  </div>
  <p>{date?`Incasso previsto: ${date.split('-').reverse().join('/')}`:'Indica la data di incasso, la data di fatturazione o la consegna concordata per calcolare la previsione.'}</p>
  <small>È una previsione del preventivo. Le date delle RIBA effettivamente caricate si registrano separatamente in Finanza.</small>
 </fieldset>
}
