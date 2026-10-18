import { describe, it, expect } from 'vitest'
import { rankPhaseOperators } from './phaseAssignment'
import { emptyData } from './erp'
import type { ErpData, JobPhase, RepairJob } from '../types'
import { supportsOperatorDuty, preferredOperatorDuties } from './operatorSkills'
const phase = {id:'wash',name:'Lavaggio esterno',requiredSkill:'Lavaggio esterno',estimatedMinutes:25,operatorAssignments:[]} as unknown as JobPhase
const job = {phases:[phase],lines:[],taxableAmount:150} as unknown as RepairJob
function fixture() {
 const data = structuredClone(emptyData) as ErpData
 data.plannerSettings.workingDays=[1,2,3,4,5]
 data.plannerSettings.weeklyWorkSchedule=[{dayOfWeek:1,active:true,intervals:[{startTime:'08:00',endTime:'17:00'}]}]
 const stefania={id:'s',name:'STEFANIA',active:true,dailyHours:8,skillsConfigured:true,skills:['lavaggio esterno'],hourlyCost:20}
 const martin={id:'m',name:'Martin',active:true,dailyHours:8,skillsConfigured:true,skills:['lavaggio esterno'],hourlyCost:40}
 data.plannerSettings.operators=[stefania,martin]
 return {data,candidates:[{operator:martin,nextAt:'2026-10-19T08:00:00'},{operator:stefania,nextAt:'2026-10-19T09:00:00'}]}
}
describe('precedenza mansioni e sostituzione',()=>{
 it('assegna a Stefania anche se il collega costa di più e lei è occupata per un’ora',()=>{
  const {data,candidates}=fixture()
  expect(rankPhaseOperators(data,job,phase,candidates,25,'2026-10-19T08:00:00','2026-10-19T08:00:00').operators.map(c=>c.operator.id)).toEqual(['s'])
 })
 it('passa agli altri abilitati in assenza completa senza assegnare a Stefania il giorno dopo',()=>{
  const {data,candidates}=fixture();data.plannerSettings.absences=[{id:'a',operatorId:'s',startDate:'2026-10-19',endDate:'2026-10-19',hoursPerDay:8,reason:'Assente'}]
  const result=rankPhaseOperators(data,job,phase,candidates,25,'2026-10-19T08:00:00','2026-10-19T08:00:00')
  // Calendar ranking favours a substitute that can perform this job today.
  expect(result.operators[0].operator.id).toBe('m')
 })
 it('rispetta la scelta manuale e permette di togliere la precedenza',()=>{
  const {data,candidates}=fixture()
  expect(rankPhaseOperators(data,job,{...phase,preferredOperatorId:'m'},candidates,25,'2026-10-19T08:00:00','2026-10-19T08:00:00').operators[0].operator.id).toBe('m')
  expect(preferredOperatorDuties({...candidates[1].operator,preferredDuties:[]})).toEqual([])
  expect(supportsOperatorDuty(candidates[1].operator,'Smontaggio')).toBe(false)
  expect(supportsOperatorDuty({...candidates[1].operator,skills:['preparazione']},'Scartatura')).toBe(true)
 })
})
