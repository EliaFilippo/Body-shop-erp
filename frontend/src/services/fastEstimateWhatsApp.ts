import type { EstimateDocument } from '../types'

export function normalizeWhatsAppPhone(value: string): string {
  const raw=value.trim()
  if(!/^[+\d\s().-]+$/.test(raw))throw new Error('Inserisci un numero WhatsApp valido del cliente.')
  let digits=raw.replace(/\D/g,'')
  if(raw.startsWith('00'))digits=digits.slice(2)
  else if(!raw.startsWith('+'))digits=`39${digits}`
  if(!/^[1-9]\d{7,14}$/.test(digits))throw new Error('Inserisci un numero WhatsApp valido del cliente, con prefisso internazionale per i numeri esteri.')
  return digits
}

/** Draft only: opening WhatsApp is never evidence of sending or customer approval. */
export function fastEstimateWhatsAppLink(estimate: EstimateDocument, phone: string): string {
  const target=normalizeWhatsAppPhone(phone)
  const message=`Buongiorno ${estimate.contactName||estimate.companyName}, in allegato il preventivo ${estimate.number} per la vettura ${estimate.plate}.\nCarrozzeria Elias`
  return `https://web.whatsapp.com/send?phone=${target}&text=${encodeURIComponent(message)}`
}
