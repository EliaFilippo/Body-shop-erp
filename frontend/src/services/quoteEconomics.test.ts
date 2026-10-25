import { describe,it,expect } from 'vitest'
import { emptyData } from './erp'
import { createDefaultQuote } from './acceptance'
import { recalculateDamageLine } from './damageQuote'
import { quoteEconomics } from './quoteEconomics'

function fixture(price=200) {
 const settings=structuredClone(emptyData.plannerSettings)
 settings.monthlyRevenueGoal=25000
 settings.internalCostSettings={...settings.internalCostSettings!,usePlannerCapacity:false,minimumMarginPercent:0,budgetMaterialsPercent:20,
  monthlyCostItems:[{id:'payroll',category:'personale',description:'Personale',monthlyAmount:4000,active:true},{id:'rent',category:'affitto',description:'Struttura',monthlyAmount:6000,active:true}],
  productiveCapacity:{productiveOperators:2,hoursPerOperatorPerDay:8,workingDaysPerMonth:20,efficiencyPercent:62.5}}
 const line=recalculateDamageLine({id:'manual',manualFastLine:true,customerDescription:'Ripristino paraurti',description:'Ripristino paraurti',standardWorkId:'manual-fast:test',standardWorkName:'Verniciatura',categoryOrPhase:'Verniciatura',panelName:'Paraurti',category:'altre',calculationType:'per-vehicle',quantity:1,discount:0,vatRate:22,unitPrice:price,estimatedMinutes:120,manualPhaseTimes:[{phase:'Verniciatura',minutes:90},{phase:'Incartatura',minutes:20},{phase:'Scartatura',minutes:10}],taxableAmount:0,vatAmount:0,total:0,materialsIncluded:true},settings)
 const quote={...createDefaultQuote(settings,'2026-10'),damageLines:[line],selectedPhases:[]}
 return {settings,quote}
}
describe('convenienza prima di confermare il preventivo Fast',()=>{
 it('separa ricavo, obiettivo e margine: sotto obiettivo può restare redditizio',()=>{
  const {settings,quote}=fixture()
  const before=JSON.stringify(quote)
  expect(quoteEconomics(quote,settings)).toMatchObject({revenue:200,minutes:120,hourlyRevenue:100,target:{hourlyRate:125},materialsCost:40,hourlyCost:50,personnelAndStructureCost:100,totalCost:140,margin:60,breakEvenRevenue:125,status:'below-target'})
  expect(JSON.stringify(quote)).toBe(before)
 })
 it.each([[50,'loss',-60],[125,'break-even',0],[400,'on-target',220]] as const)('classifica prezzo %s al netto IVA', (price,status,margin)=>{
  const {settings,quote}=fixture(price)
  expect(quoteEconomics(quote,settings)).toMatchObject({status,margin})
 })
 it('il lavaggio aumenta tempo e costo, senza aumentare il prezzo o spalmare ore economiche',()=>{
  const {settings,quote}=fixture()
  settings.eliasExteriorWashMinutes=25
  expect(quoteEconomics({...quote,selectedPhases:['Lavaggio esterno']},settings)).toMatchObject({revenue:200,minutes:145,hourlyRevenue:82.76,personnelAndStructureCost:120.83,margin:39.17})
 })
 it('non duplica i tempi condivisi di incartare/scartare e smontaggio/rimontaggio',()=>{
  const {settings,quote}=fixture()
  const line={...quote.damageLines[0],manualPhaseTimes:undefined,minorDamageTimes:{sr:30,is:20,v:60}}
  expect(quoteEconomics({...quote,damageLines:[line]},settings).minutes).toBe(110)
 })
 it('non dichiara guadagno con tempi, costi o capacità mancanti',()=>{
  const {settings,quote}=fixture()
  expect(quoteEconomics({...quote,damageLines:[{...quote.damageLines[0],manualPhaseTimes:[{phase:'',minutes:0}]}]},settings)).toMatchObject({status:'unknown',margin:null,hourlyRevenue:null})
  settings.internalCostSettings!.monthlyCostItems=[]
  expect(quoteEconomics(quote,settings)).toMatchObject({status:'unknown',margin:null,hourlyRevenue:100})
  settings.internalCostSettings!.productiveCapacity!.productiveOperators=0
  expect(quoteEconomics(quote,settings)).toMatchObject({status:'unknown',margin:null,target:{hourlyRate:null}})
 })
 it('non trasforma l’obiettivo mancante in un giudizio positivo sul suo raggiungimento',()=>{
  const {settings,quote}=fixture()
  settings.monthlyRevenueGoal=0
  expect(quoteEconomics(quote,settings)).toMatchObject({status:'no-target',margin:60,target:{hourlyRate:null}})
 })
})
