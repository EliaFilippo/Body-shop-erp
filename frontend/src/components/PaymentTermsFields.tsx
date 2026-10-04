import type { EstimatePaymentTerms } from '../types'

export function PaymentTermsFields({ value, onChange }: { value: EstimatePaymentTerms; onChange: (value: EstimatePaymentTerms) => void }) {
 return <fieldset className="full"><legend>Condizioni di pagamento concordate</legend>
  <label>Modalità<select value={value.method} onChange={e => onChange({ ...value, method: e.target.value as EstimatePaymentTerms['method'] })}>{['Bonifico','R.I.B.A.','Contanti','POS','Personalizzato'].map(method => <option key={method}>{method}</option>)}</select></label>
  <label>Giorni dalla fatturazione<input type="number" min="0" max="365" step="1" value={value.days} onChange={e => onChange({ ...value, days: Number(e.target.value) })} /></label>
  <label><input type="checkbox" checked={value.endOfMonth} onChange={e => onChange({ ...value, endOfMonth: e.target.checked })} />Fine mese</label>
  <label>Data prevista fatturazione<input type="date" value={value.expectedInvoiceDate} onChange={e => onChange({ ...value, expectedInvoiceDate: e.target.value })} /></label>
  <p>La previsione a 30, 60 e 90 giorni include i preventivi confermati con una data di fatturazione prevista. Non registra un incasso effettivo.</p>
 </fieldset>
}
