import {it,expect} from 'vitest'
import {emptyData} from './erp'
import {enableFilippoTransport} from './transportDutySetup'
import {supportsOperatorDuty,OPERATOR_DUTIES} from './operatorSkills'
const company='aa49d334-492f-4daa-aa7e-5d5c022308b7'
function fixture(){
 const data=structuredClone(emptyData)
 data.plannerSettings.operators=[{id:'f',name:'Filippo',active:true,dailyHours:8,skillsConfigured:true,skills:['lattoneria'],preferredDuties:['lattoneria']},{id:'d',name:'Davide',active:true,dailyHours:8,skillsConfigured:true,skills:['smontaggio']}]
 return data
}
it('enables only the unique Filippo, preserves duties/preferences, and does not re-enable after manual removal',()=>{
 const data=fixture(),before=JSON.stringify(data),next=enableFilippoTransport(data,company)
 expect(OPERATOR_DUTIES).toContain('Trasporto')
 expect(next.plannerSettings.operators[0].skills).toEqual(['lattoneria','trasporto'])
 expect(next.plannerSettings.operators[0].preferredDuties).toEqual(['lattoneria'])
 expect(supportsOperatorDuty(next.plannerSettings.operators[0],'Trasporto')).toBe(true)
 expect(supportsOperatorDuty(next.plannerSettings.operators[1],'Trasporto')).toBe(false)
 expect(next.plannerSettings.operators[1]).toBe(data.plannerSettings.operators[1])
 expect(JSON.stringify(data)).toBe(before)
 next.plannerSettings.operators[0].skills=['lattoneria']
 expect(enableFilippoTransport(next,company)).toBe(next)
})
it('does not guess between duplicate Filippo profiles or update another company',()=>{
 const data=fixture()
 expect(enableFilippoTransport(data,'other')).toBe(data)
 data.plannerSettings.operators.push({...data.plannerSettings.operators[0],id:'f2'})
 expect(enableFilippoTransport(data,company)).toBe(data)
})
it('keeps unrestricted legacy workers unrestricted',()=>{
 const data=fixture();data.plannerSettings.operators[0].skillsConfigured=false;data.plannerSettings.operators[0].skills=[]
 const next=enableFilippoTransport(data,company)
 expect(next.plannerSettings.operators[0].skills).toEqual([])
 expect(supportsOperatorDuty(next.plannerSettings.operators[0],'Trasporto')).toBe(true)
 expect(supportsOperatorDuty(next.plannerSettings.operators[0],'Smontaggio')).toBe(true)
})
