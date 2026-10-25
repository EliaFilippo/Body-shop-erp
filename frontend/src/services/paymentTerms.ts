import type { EstimatePaymentTerms } from '../types'
export function expectedPaymentDate(terms:EstimatePaymentTerms|undefined,delivery=''):string {
 if(!terms)return ''
 if(terms.expectedCollectionDate)return terms.expectedCollectionDate
 if(terms.atDelivery)return delivery
 if(!terms.expectedInvoiceDate)return ''
 const date=new Date(`${terms.expectedInvoiceDate}T12:00:00Z`)
 date.setUTCDate(date.getUTCDate()+terms.days)
 if(terms.endOfMonth)date.setUTCMonth(date.getUTCMonth()+1,0)
 return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):''
}
export function paymentTermsText(terms:EstimatePaymentTerms|undefined,delivery=''):string {
 if(!terms)return ''
 const date=expectedPaymentDate(terms,delivery)
 return `${terms.atDelivery?'Bonifico alla consegna':terms.method} · ${terms.days} giorni${terms.endOfMonth?' fine mese':''}${date?` · incasso previsto ${date.split('-').reverse().join('/')}`:''}`
}
