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
  const euro=(n:number)=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
  const message=[
    `Buongiorno ${estimate.contactName||estimate.companyName},`,
    `ecco il preventivo ${estimate.number} di Carrozzeria Elias per la vettura ${estimate.plate}:`,
    ...estimate.lines.map(line=>`• ${line.description} × ${line.quantity}: ${euro(line.unitPrice*line.quantity)} + IVA`),
    `Imponibile: ${euro(estimate.taxableAmount)}`,
    `IVA: ${euro(estimate.vatAmount)}`,
    `Totale IVA inclusa: ${euro(estimate.total)}`,
    ...(estimate.requestedDeliveryDate?[`Consegna concordata: ${estimate.requestedDeliveryDate.split('-').reverse().join('/')}`]:[]),
    estimate.status==='Approvato'?'Grazie per la conferma.':'Per accettare, rispondi confermando questo preventivo.',
    'Carrozzeria Elias · San Vendemiano · 0438 402510',
  ].join('\n')
  return `https://web.whatsapp.com/send?phone=${target}&text=${encodeURIComponent(message)}`
}
