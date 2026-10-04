import { jsPDF } from 'jspdf'
import type { ErpData, QuoteDocument } from '../types'

export function quotePdfFile(data: ErpData, quote: QuoteDocument): File {
 const pdf = new jsPDF(); let y=20
 const write=(text:string)=>{ for(const line of pdf.splitTextToSize(text,175) as string[]){if(y>275){pdf.addPage();y=20}pdf.text(line,18,y);y+=7} }
 const amount=(v:number)=>v.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
 const customer=data.customers.find(c=>c.id===quote.customerId)
 const vehicle=data.vehicles.find(v=>v.id===quote.vehicleId)
 write(data.companyProfile?.name || 'Elias Body Shop')
 write(`PREVENTIVO ${quote.number} - ${quote.issueDate}`)
 write(`Cliente: ${customer?.name || ''}`);write(`Vettura: ${vehicle?.plate || ''} ${vehicle?.make || ''} ${vehicle?.model || ''}`)
 write(`Validita preventivo: ${quote.dueDate}`);write('')
 quote.lines.forEach(l=>write(`${l.description} | Q.ta ${l.quantity} | ${amount(l.total)}`))
 write('');write(`Imponibile: ${amount(quote.taxableAmount)} - IVA: ${amount(quote.vatAmount)}`);write(`TOTALE: ${amount(quote.total)}`)
 if(quote.paymentTerms) write(`Pagamento: ${quote.paymentTerms.method} - ${quote.paymentTerms.days===0?'alla consegna':`${quote.paymentTerms.days} giorni`}${quote.paymentTerms.endOfMonth?' fine mese':''}`)
 if(quote.notes)write(`Note: ${quote.notes}`)
 for(const image of quote.photos ?? []) {pdf.addPage();pdf.text('Foto allegate al preventivo',18,18); const props=pdf.getImageProperties(image); const ratio=Math.min(175/props.width,240/props.height);pdf.addImage(image,props.fileType,18,30,props.width*ratio,props.height*ratio)}
 return new File([pdf.output('blob')],`${quote.number.replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`,{type:'application/pdf'})
}

export async function readQuotePhotos(files: File[]): Promise<string[]> {
 if(files.length>6)throw new Error('Massimo 6 foto per preventivo.')
 const photos:string[]=[]
 for(const file of files){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024)throw new Error('Usa foto JPG, PNG o WEBP fino a 12 MB.')
  const bitmap=await createImageBitmap(file);const ratio=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio)
  const context=canvas.getContext('2d');if(!context){bitmap.close();throw new Error('Lettura foto non disponibile.')}
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const encoded=canvas.toDataURL('image/jpeg',.7)
  if(encoded.length>750000)throw new Error('La foto è troppo grande: riduci la risoluzione.')
  photos.push(encoded)
 }
 return photos
}
