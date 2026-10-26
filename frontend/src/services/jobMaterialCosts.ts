import type { ErpData, RepairJob } from '../types'
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100
import { isProductionLabourLine } from './liveProduction'
export function calculateJobMaterialMargin(job:RepairJob) {
 let estimatedMaterials=0;let otherCosts=0;let missingCosts=false
 for(const line of job.lines){
  const quantity=Math.max(0,line.quantity)
  if(isProductionLabourLine(line)){
   const amount=Math.max(0,line.taxableAmount ?? quantity*line.unitPrice-line.discount)
   const materials=Number.isFinite(line.budgetMaterialsCost)?Math.max(0,line.budgetMaterialsCost!):amount*Math.max(0,Math.min(100,line.budgetMaterialsPercent??20))/100
   estimatedMaterials+=materials
   if(Number.isFinite(line.internalCostAmount)&&Number(line.internalHourlyRateUsed)>0){
    otherCosts+=Math.max(0,line.internalCostAmount!-(Number.isFinite(line.budgetMaterialsCost)?materials:0))
   } else if(Number(line.internalHourlyRateUsed)>0){
    otherCosts+=Math.max(0,line.lineTotalMinutes??line.estimatedMinutes??0)/60*line.internalHourlyRateUsed!
   } else if(amount>0)missingCosts=true
  }else{
   const cost=line.budgetDirectUnitCost
   if(cost===undefined&&line.unitPrice>0&&quantity>0)missingCosts=true
   if(line.category==='materiali')estimatedMaterials+=Math.max(0,cost??0)*quantity
   else otherCosts+=Math.max(0,cost??0)*quantity
  }
 }
 estimatedMaterials=round(estimatedMaterials);otherCosts=round(otherCosts)
 const actual=job.materialActualCost?.amount
 const appliedMaterials=actual===undefined?estimatedMaterials:actual
 const marginBefore=missingCosts?null:round(job.taxableAmount-estimatedMaterials-otherCosts)
 const margin=missingCosts?null:round(job.taxableAmount-appliedMaterials-otherCosts)
 return {estimatedMaterials,actualMaterials:actual??null,appliedMaterials,otherCosts,marginBefore,margin,
  marginPercent:margin===null?null:job.taxableAmount>0?round(margin/job.taxableAmount*100):0,
  materialsSaving:actual===undefined?null:round(estimatedMaterials-actual),missingCosts}
}
export function setJobMaterialActualCost(data:ErpData,jobId:string,amount:number,note='',at=new Date().toISOString()):ErpData{
 if(!Number.isFinite(amount)||amount<0)throw new Error('Inserisci un costo materiali valido maggiore o uguale a zero, IVA esclusa.')
 const job=data.jobs?.find(j=>j.id===jobId)
 if(!job)throw new Error('Commessa non trovata.')
 if(job.status==='Annullata')throw new Error('La commessa è annullata.')
 const value=round(amount);const text=note.trim()
 if(job.materialActualCost?.amount===value&&job.materialActualCost.note===text)return data
 return {...data,jobs:data.jobs!.map(j=>j.id!==jobId?j:{...j,materialActualCost:{amount:value,at,note:text},
  materialCostHistory:[{at,before:j.materialActualCost?.amount??null,amount:value,note:text},...(j.materialCostHistory??[])],
  updatedAt:at,history:[{id:crypto.randomUUID(),at,actor:'Ufficio',message:`Materiali a consuntivo: ${value.toFixed(2)} € IVA esclusa. Il costo reale sostituisce la stima.`},...j.history]})}
}
