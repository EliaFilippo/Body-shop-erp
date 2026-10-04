import type { PaymentMethod } from '../types'
export type SupplierCostCategory = 'Ricambi'|'Materiali di consumo'|'Lavorazioni esterne'|'Altri costi'
export interface ImportedInvoice {
 supplierName:string; invoiceNumber:string; invoiceDate:string; taxableAmount:number; vatAmount:number; totalAmount:number;
 installments:{amount:number;dueDate:string;method:PaymentMethod}[];
 costLines:{description:string;amount:number;category:SupplierCostCategory}[];
}
export function supplierCostCategory(text:string):SupplierCostCategory {
 const value=text.toLowerCase()
 if(/vernici|diluent|abrasiv|stucc|primer|nastro|mascher|carta vetr|material.*consum/.test(value)) return 'Materiali di consumo'
 if(/paraurt|parafang|ricamb|faro|portier|pneumatic|filtro|specchi|cofano|pastigl/.test(value)) return 'Ricambi'
 if(/lavorazion.*estern|subappalt|rettific|servizi.*estern/.test(value)) return 'Lavorazioni esterne'
 return 'Altri costi'
}
const nodes=(parent:Document|Element,name:string)=>Array.from(parent.getElementsByTagNameNS('*',name))
const value=(parent:Document|Element,name:string)=>nodes(parent,name)[0]?.textContent?.trim()??''
const number=(parent:Document|Element,name:string)=>{const n=Number(value(parent,name));return Number.isFinite(n)?n:0}
export function parseSupplierInvoiceXml(text:string):ImportedInvoice {
 if(text.length>2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML non supportato.')
 const doc=new DOMParser().parseFromString(text,'application/xml')
 if(nodes(doc,'parsererror').length) throw new Error('XML non valido.')
 const bodies=nodes(doc,'FatturaElettronicaBody');const supplier=nodes(doc,'CedentePrestatore')[0]
 if(bodies.length!==1||!supplier) throw new Error('Importa un XML FatturaPA con una sola fattura.')
 const body=bodies[0], general=nodes(body,'DatiGeneraliDocumento')[0]
 if(!general || !['TD01','TD24','TD25'].includes(value(general,'TipoDocumento'))) throw new Error('Tipo documento non supportato: registra manualmente note di credito e altri documenti.')
 if(value(general,'Divisa')!=='EUR') throw new Error('Sono supportate solo fatture in euro.')
 const summary=nodes(body,'DatiRiepilogo');const taxableAmount=summary.reduce((sum,item)=>sum+number(item,'ImponibileImporto'),0),vatAmount=summary.reduce((sum,item)=>sum+number(item,'Imposta'),0)
 const totalAmount=number(general,'ImportoTotaleDocumento')||Math.round((taxableAmount+vatAmount)*100)/100
 const installments=nodes(body,'DettaglioPagamento').map(payment=>({amount:number(payment,'ImportoPagamento'),dueDate:value(payment,'DataScadenzaPagamento'),method:(value(payment,'ModalitaPagamento')==='MP12'?'R.I.B.A.':value(payment,'ModalitaPagamento')==='MP01'?'Contanti':value(payment,'ModalitaPagamento')==='MP08'?'POS':value(payment,'ModalitaPagamento')==='MP05'?'Bonifico':'Personalizzato') as PaymentMethod}))
 if(installments.length&&Math.abs(installments.reduce((sum,item)=>sum+item.amount,0)-totalAmount)>.02) throw new Error('Importi di pagamento diversi dal totale: verifica ritenute, split payment o acconti prima di registrare.')
 return {supplierName:value(supplier,'Denominazione')||`${value(supplier,'Nome')} ${value(supplier,'Cognome')}`.trim(),invoiceNumber:value(general,'Numero'),invoiceDate:value(general,'Data'),taxableAmount,vatAmount,totalAmount,installments,costLines:nodes(body,'DettaglioLinee').map(line=>({description:value(line,'Descrizione'),amount:number(line,'PrezzoTotale'),category:supplierCostCategory(value(line,'Descrizione'))}))}
}
const moneyValue=(text:string)=>Number(text.replace(/\s/g,'').replace(/\./g,'').replace(',','.'))||0
const italianDate=(date:string)=>{const m=date.match(/(\d{2})[/.-](\d{2})[/.-](\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:''}
export function parseInvoicePhotoText(text:string):ImportedInvoice {
 const amount=(label:string)=>{const m=text.match(new RegExp(`(?:${label})[^\\n\\d]{0,35}([\\d.]+,\\d{2})`,'i'));return m?moneyValue(m[1]):0}
 const dateMatch=text.match(/(?:data fattura|data documento|data)\s*[: ]\s*(\d{2}[/.-]\d{2}[/.-]\d{4})/i)
 const due=text.match(/(?:scadenza|scad\.)\s*[: ]\s*(\d{2}[/.-]\d{2}[/.-]\d{4})/i)
 const invoice=text.match(/(?:fattura\s*(?:n[.°]?|numero)|numero documento)\s*[: ]\s*([\w/.-]+)/i)
 const totalAmount=amount('totale documento|totale fattura|importo da pagare')
 const lines=text.split('\n').filter(line=>line.trim()&&supplierCostCategory(line)!=='Altri costi').slice(0,100)
 return {supplierName:'',invoiceNumber:invoice?.[1]??'',invoiceDate:dateMatch?italianDate(dateMatch[1]):'',taxableAmount:amount('totale imponibile|imponibile'),vatAmount:amount('totale iva|totale imposta'),totalAmount,installments:[{amount:totalAmount,dueDate:due?italianDate(due[1]):'',method:'Bonifico'}],costLines:lines.map(line=>({description:line.trim(),amount:0,category:supplierCostCategory(line)}))}
}
