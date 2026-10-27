import { describe,expect,it } from 'vitest'
import { buildEstimatePdf,estimatePdfFile,estimatePdfName } from './estimatePdf'
import { emptyData } from './erp'
import { createEstimate } from './workflow'
function fixture(){
 const data=structuredClone(emptyData)
 data.companyProfile={name:'ELIAS DI ELIA FILIPPO',address:'Via Olivera 30, San Vendemiano',vatId:'VAT-COMPANY',taxCode:'CF-COMPANY',phone:'0438402510',email:'office@example.test',logoText:'ELIAS'}
 data.customers=[{id:'c',name:'Cliente Test',type:'Azienda',phone:'3331234567',email:'client@example.test',taxId:'VAT-CLIENT',address:'Via Cliente 1',createdAt:''}]
 const next=createEstimate(data,{customerId:'c',plate:'GL587FB',companyName:'Cliente Test',contactName:'',date:'2026-10-27',notes:'Pagamento concordato',selectedPhases:[],lines:[
  {description:'Ripristino porta',category:'carrozzeria',quantity:2,unitPrice:150,discount:20,vatRate:22,estimatedMinutes:60},
  {description:'Ritocchi',category:'carrozzeria',quantity:1,unitPrice:50,discount:0,vatRate:10,estimatedMinutes:15}]})
 return {data:next,estimate:next.estimates![0]}
}
describe('customer estimate PDF',()=>{
 it('uses saved prices, discounts, mixed VAT and customer details without internal costs or mutation',()=>{
  const {data,estimate}=fixture()
  estimate.lines[0].budgetOperatorId='PRIVATE-OPERATOR'
  estimate.lines[0].appliedRuleSummary='PRIVATE-RULE'
  estimate.lines[0].internalCostAmount=98765
  const before=JSON.stringify(data)
  const output=buildEstimatePdf(data,estimate).output()
  expect(output).toContain('PREVENTIVO');expect(output).toContain('GL587FB')
  expect(output).toContain('VAT-COMPANY');expect(output).toContain('VAT-CLIENT')
  expect(output).toContain('Cliente Test');expect(output).toContain('20,00')
  expect(output).toContain('280,00');expect(output).toContain('61,60');expect(output).toContain('5,00')
  expect(output).toContain('396,60 EUR')
  expect(output).not.toContain('PRIVATE-OPERATOR');expect(output).not.toContain('PRIVATE-RULE');expect(output).not.toContain('98765')
  expect(JSON.stringify(data)).toBe(before)
  expect(estimatePdfFile(data,estimate)).toMatchObject({name:'GL587FB.pdf',type:'application/pdf'})
 })
 it('paginates long descriptions, many rows and long notes without losing the last row or totals',()=>{
  const {data,estimate}=fixture()
  estimate.lines=Array.from({length:70},(_,i)=>({...estimate.lines[0],id:String(i),description:`Riga ${i+1}: `+'lavorazione dettagliata '.repeat(i===20?100:4)}))
  estimate.notes='Nota finale cliente. '.repeat(100)+'FINE-NOTE'
  const pdf=buildEstimatePdf(data,estimate),output=pdf.output()
  expect(pdf.getNumberOfPages()).toBeGreaterThan(2)
  expect(output).toContain('Riga 70:')
  expect(output).toContain('FINE-NOTE')
  expect(output).toContain('Totale preventivo')
  expect(output).toContain(`Pagina ${pdf.getNumberOfPages()} di ${pdf.getNumberOfPages()}`)
 })
 it('keeps a safe plate filename and does not invent missing legal registration details',()=>{
  const {data,estimate}=fixture();data.companyProfile=undefined
  estimate.plate='../GL/587FB'
  expect(estimatePdfName(estimate)).toBe('GL587FB.pdf')
  expect(buildEstimatePdf(data,estimate).output()).not.toContain('VAT-COMPANY')
 })
})
