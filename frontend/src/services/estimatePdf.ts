import { jsPDF } from 'jspdf'
import { paymentTermsText } from './paymentTerms'
import type { ErpData, EstimateDocument } from '../types'
const clean=(text:unknown)=>String(text??'').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/\u00a0/g,' ')
const amount=(value:number)=>value.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})
const date=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value.split('-').reverse().join('/'):value
export const estimatePdfName=(estimate:EstimateDocument)=>`${estimate.plate.replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase()||'PREVENTIVO'}.pdf`

/** Client document only. Never serialize internal rates, margins, budgets or operator assignments. */
export function buildEstimatePdf(data:ErpData,estimate:EstimateDocument){
 const pdf=new jsPDF({unit:'mm',format:'a4'})
 const customer=data.customers.find(c=>c.id===estimate.customerId)
 const vehicle=data.vehicles.find(v=>v.id===estimate.vehicleId)||data.vehicles.find(v=>v.plate.replace(/\s/g,'').toUpperCase()===estimate.plate.replace(/\s/g,'').toUpperCase())
 const company=data.companyProfile
 const left=8,right=202,width=194
 const xs=[8,16,101,109,117,125,133,143,163,178,202]
 let y=0,tableTop=116
 const text=(value:unknown,x:number,at:number,size=8,bold=false,align:'left'|'right'='left')=>{
  pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(0);pdf.text(clean(value),x,at,{align})
 }
 const paragraph=(value:string,x:number,top:number,w:number,size=8,bold=false)=>{
  pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size)
  const lines=pdf.splitTextToSize(clean(value),w) as string[]
  lines.forEach((line,i)=>text(line,x,top+i*3.6,size,bold))
  return top+lines.length*3.6
 }
 const tableHead=()=>{
  pdf.setDrawColor(155);pdf.setLineWidth(.15)
  pdf.setFillColor(245);pdf.rect(left,tableTop,width,6,'FD')
  const titles=['N.','Descrizione','SR','LA','VE','ME','Q.ta','Prezzo EUR','Sconto EUR','Totale EUR']
  titles.forEach((t,i)=>text(t,xs[i]+1,tableTop+4,6.3,true))
  y=tableTop+6
 }
 function header(){
  text('PREVENTIVO',right,16,16,true,'right')
  text(`Data: ${date(estimate.date)}`,right,23,8,false,'right')
  text(`N. ${estimate.number}`,right,28,8,true,'right')
  let a=paragraph(company?.name||'ELIAS BODY SHOP',left,23,98,11,true)+3
  for(const value of [company?.address,company?.vatId?`P.IVA: ${company.vatId}`:'',company?.taxCode?`C.F.: ${company.taxCode}`:'',company?.phone?`Tel.: ${company.phone}`:'',company?.email?`Email: ${company.email}`:'']){
   if(value)a=paragraph(value,left,a,98)+.8
  }
  text('Cliente:',116,39,8)
  let b=paragraph(customer?.name||estimate.companyName||estimate.contactName,116,44,85,9,true)
  for(const value of [customer?.address,customer?.taxId?`P.IVA / C.F.: ${customer.taxId}`:'',customer?.phone?`Telefono: ${customer.phone}`:'',customer?.email?`Email: ${customer.email}`:'']){
   if(value)b=paragraph(value,116,b,85)+.8
  }
  a=Math.max(74,a+5);text('Sinistro: __________________________',left,a);text('Perito: ___________________________',left,a+9);text('Compagnia: ______________________',left,a+18)
  b=Math.max(81,b+6);text('Veicolo:',116,b)
  b=paragraph([vehicle?.make,vehicle?.model].filter(Boolean).join(' ')||'Modello non indicato',116,b+5,85,9,true)
  text(`Targa: ${estimate.plate}`,116,b+1,9,true)
  b=paragraph(`Colore: ${vehicle?.color||'-'}   KM: ${vehicle?.mileage||'-'}`,116,b+6,85)
  if(vehicle?.vin||vehicle?.chassisNumber)b=paragraph(`Telaio: ${vehicle.vin||vehicle.chassisNumber}`,116,b+1,85)
  tableTop=Math.max(113,a+25,b+6)
  // Unusually long contact details continue on their own page rather than crossing the table.
  if(tableTop>190)throw Error('I dati di intestazione sono troppo lunghi. Riduci indirizzi e contatti prima di creare il PDF.')
  tableHead()
 }
 function finishTable(bottom:number){
  pdf.setDrawColor(170);pdf.setLineWidth(.15)
  for(const x of xs)pdf.line(x,tableTop,x,bottom)
  pdf.line(left,bottom,right,bottom)
 }
 function nextPage(){finishTable(y);pdf.addPage();header()}
 header()
 for(const [index,line] of estimate.lines.entries()){
  pdf.setFont('helvetica','normal');pdf.setFontSize(8)
  const description=pdf.splitTextToSize(clean(line.description),82) as string[]
  let offset=0
  do{
   const capacity=Math.floor((222-y-3)/3.6)
   if(capacity<1){nextPage();continue}
   const chunk=description.slice(offset,offset+capacity)
   const h=Math.max(6,chunk.length*3.6+3)
   const first=offset===0
   if(first){
    text(String(index+1),xs[0]+1,y+4,7)
    text(amount(line.quantity),xs[7]-1,y+4,7,false,'right')
    text(amount(line.unitPrice),xs[8]-1,y+4,7,false,'right')
    text(amount(line.discount),xs[9]-1,y+4,7,false,'right')
    text(amount(line.taxableAmount),xs[10]-1,y+4,7,true,'right')
   }
   chunk.forEach((v,i)=>text(v,xs[1]+1,y+4+i*3.6,8))
   y+=h;pdf.setDrawColor(180);pdf.line(left,y,right,y)
   offset+=chunk.length
   if(offset<description.length)nextPage()
  }while(offset<description.length)
 }
 finishTable(Math.max(y,222))
 y=Math.max(y,222)+8
 // Amounts are the saved customer-facing document totals, never recomputed from internal costs.
 text('RIEPILOGO IVA',left,y,8,true)
 text('Imponibile EUR',130,y,7,true,'right');text('IVA EUR',165,y,7,true,'right');text('Totale EUR',right,y,7,true,'right');y+=5
 const footerPage=()=>{pdf.addPage();text(`PREVENTIVO ${estimate.number} - ${estimate.plate}`,left,15,10,true);y=24}
 const rates=new Map<number,{taxable:number;vat:number;total:number}>()
 for(const l of estimate.lines){const r=rates.get(l.vatRate)||{taxable:0,vat:0,total:0};r.taxable+=l.taxableAmount;r.vat+=l.vatAmount;r.total+=l.total;rates.set(l.vatRate,r)}
 for(const [rate,r] of rates){
  if(y>257)footerPage()
  text(`IVA ${amount(rate)}%`,left,y,8);text(amount(r.taxable),130,y,8,false,'right');text(amount(r.vat),165,y,8,false,'right');text(amount(r.total),right,y,8,false,'right');y+=5
 }
 pdf.setDrawColor(80);pdf.line(left,y,right,y);y+=7
 text('Totale preventivo',left,y,11,true);text(amount(estimate.taxableAmount),130,y,9,true,'right');text(amount(estimate.vatAmount),165,y,9,true,'right');text(amount(estimate.total)+' EUR',right,y,10,true,'right');y+=9
 function footerParagraph(value:string){
  pdf.setFontSize(8)
  const lines=pdf.splitTextToSize(clean(value),width) as string[]
  for(const line of lines){if(y>280)footerPage()text(line,left,y,8);y+=4}
 }
 if(estimate.paymentTerms)footerParagraph('Pagamento: '+paymentTermsText(estimate.paymentTerms,estimate.requestedDeliveryDate))
 if(estimate.requestedDeliveryDate)footerParagraph('Consegna concordata: '+date(estimate.requestedDeliveryDate))
 if(estimate.notes)footerParagraph('Note: '+estimate.notes)
 if(y>274){footerPage();y+=5}else y=Math.max(y+5,276)
 text('Firma per accettazione: __________________________________',110,y,8)
 for(let page=1;page<=pdf.getNumberOfPages();page++){pdf.setPage(page);text(`${estimate.number} - ${estimate.plate}`,left,290,7);text(`Pagina ${page} di ${pdf.getNumberOfPages()}`,right,290,7,false,'right')}
 pdf.setProperties({title:`Preventivo ${estimate.number} - ${estimate.plate}`,subject:'Preventivo carrozzeria',author:company?.name||'Carrozzeria Elias'})
 return pdf
}
export function estimatePdfFile(data:ErpData,estimate:EstimateDocument):File{
 return new File([buildEstimatePdf(data,estimate).output('blob')],estimatePdfName(estimate),{type:'application/pdf'})
}
export function downloadEstimatePdf(file:File){
 const url=URL.createObjectURL(file),link=document.createElement('a')
 link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove()
 setTimeout(()=>URL.revokeObjectURL(url),60000)
}
