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
describe('confronto sul margine dopo i costi diretti',()=>{
 function prepared(price=200){
  const value=fixture(price)
  value.settings.monthlyMarginGoal=12000
  value.settings.operators=[{id:'op',name:'Operatore',active:true,dailyHours:8,hourlyCost:20}]
  return value
 }
 it('deducts materials and operator costs once and never deducts general expenses',()=>{
  const {settings,quote}=prepared()
  const before=JSON.stringify(quote)
  const result=quoteEconomics(quote,settings)
  expect(result).toMatchObject({revenue:200,minutes:120,hourlyRevenue:100,materialsCost:40,personnelAndStructureCost:40,totalCost:80,margin:120,marginHourly:60,target:{hourlyRate:60},objectiveMinutes:120,objectiveHourlyDelta:0,status:'on-target'})
  settings.internalCostSettings!.monthlyCostItems![1].monthlyAmount=90000
  expect(quoteEconomics(quote,settings).margin).toBe(120)
  expect(JSON.stringify(quote)).toBe(before)
 })
 it('uses each selected operator rate instead of a company overhead rate',()=>{
  const {settings,quote}=prepared()
  settings.operators.push({id:'expensive',name:'Altro',active:true,dailyHours:8,hourlyCost:40})
  quote.damageLines[0].budgetOperatorId='expensive'
  expect(quoteEconomics(quote,settings)).toMatchObject({personnelAndStructureCost:80,margin:80,marginHourly:40,status:'below-target'})
 })
 it('compares against residual margin rate rather than gross revenue rate',()=>{
  const {settings,quote}=prepared(802)
  quote.damageLines[0].manualPhaseTimes=[{phase:'Verniciatura',minutes:620}]
  const target={marginHourlyRate:30,hourlyRate:107.89,remainingMargin:8000} as NonNullable<Parameters<typeof quoteEconomics>[3]>
  const result=quoteEconomics(quote,settings,undefined,target)
  expect(result.target.hourlyRate).toBe(30)
  expect(result.marginHourly).toBe(42.09)
  expect(result.objectiveMinutes).toBe(769)
  expect(result.status).toBe('on-target')
 })
 it('subtracts parts and other direct costs in the numerator',()=>{
  const {settings,quote}=prepared()
  quote.lines.push({id:'parts',source:'manual',kind:'parts',description:'Ricambio',quantity:1,unitPrice:100,unitCost:70,vatRate:22} as typeof quote.lines[number])
  const result=quoteEconomics(quote,settings)
  expect(result.directCosts).toBe(70)
  expect(result.margin).toBe(result.revenue-result.materialsCost-70-40)
 })
 it('does not replace missing operator costs with overhead or zero',()=>{
  const {settings,quote}=prepared()
  settings.operators[0].hourlyCost=undefined
  expect(quoteEconomics(quote,settings)).toMatchObject({margin:null,marginHourly:null,status:'unknown',objectiveMinutes:null})
 })
 it('has no verdict for missing technical durations or margin target',()=>{
  const {settings,quote}=prepared()
  expect(quoteEconomics({...quote,damageLines:[]},settings).status).toBe('unknown')
  settings.monthlyMarginGoal=0
  expect(quoteEconomics(quote,settings)).toMatchObject({status:'no-target',objectiveMinutes:null})
 })
 it('includes washing in labor cost without increasing prices or changing phases',()=>{
  const {settings,quote}=prepared()
  const result=quoteEconomics({...quote,selectedPhases:['Lavaggio esterno']},settings)
  expect(result.minutes).toBe(145)
  expect(result.revenue).toBe(200)
  expect(result.personnelAndStructureCost).toBe(48.33)
 })
 it('keeps negative contribution negative',()=>{
  const {settings,quote}=prepared(10)
  expect(quoteEconomics(quote,settings)).toMatchObject({margin:-32,marginHourly:-16,status:'loss'})
 })
})
