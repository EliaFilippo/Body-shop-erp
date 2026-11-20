import { render,screen } from '@testing-library/react'
import { expect,it } from 'vitest'
import type { RepairJob,PlannerOperator } from '../../types'
import { ArchivedLabor } from './ArchivedVehicleDetails'
const operators:PlannerOperator[]=[{id:'a',name:'Anna',hourlyCost:20,dailyHours:8,active:true},{id:'b',name:'Bruno',costMode:'external-extra',externalHourlyCost:40,dailyHours:8,active:true}]
const phase=(id:string,operatorName:string,workedMinutes:number)=>({id,name:'Lucidatura',estimatedMinutes:60,tabletWorkedSeconds:workedMinutes*60,operatorAssignments:[{id:'tablet:'+id,operatorName,workedMinutes,endedAt:'2026-11-20T09:00:00Z'}]})
const job={taxableAmount:500,lines:[],phases:[phase('a','Anna',60),phase('a','Anna',30),phase('b','Bruno',60)]} as unknown as RepairJob
it('aggregates repeated phases by operator and includes external actual labor cost',()=>{
 render(<ArchivedLabor job={job} operators={operators}/> )
 expect(screen.getByText(/70,00/)).toBeInTheDocument()
 expect(screen.getByText(/30,00/)).toBeInTheDocument()
 expect(screen.getByText(/40,00/)).toBeInTheDocument()
 expect(screen.getAllByText('Anna')).toHaveLength(1)
 expect(screen.getByText('1 h 30 min')).toBeInTheDocument()
})
it('does not present an incomplete cost as a complete total',()=>{
 render(<ArchivedLabor job={job} operators={operators.slice(0,1)}/> )
 expect(screen.getByText('Da completare')).toBeInTheDocument()
 expect(screen.getByText('Costo orario da impostare')).toBeInTheDocument()
 expect(screen.getByText(/Subtotale calcolabile/)).toBeInTheDocument()
})
