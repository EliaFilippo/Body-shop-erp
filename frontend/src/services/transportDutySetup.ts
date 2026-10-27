import type {ErpData} from '../types'
/** One-time requested enablement, only for the unique Filippo profile in Elias' company. */
export function enableFilippoTransport(data:ErpData,companyId:string):ErpData {
 if(companyId!=='aa49d334-492f-4daa-aa7e-5d5c022308b7')return data
 const normalize=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ')
 const matches=data.plannerSettings.operators.filter(o=>o.active&&['filippo','filippo elia','elia filippo'].includes(normalize(o.name)))
 if(matches.length!==1||matches[0].transportDutySetupVersion===1)return data
 const target=matches[0]
 // Empty, unrestricted legacy profiles already allow the new duty; never restrict their existing access.
 const unrestricted=!target.skillsConfigured&&!target.skills?.length
 const skills=unrestricted?target.skills:[...new Set([...(target.skills??[]),'trasporto'])]
 return {...data,plannerSettings:{...data.plannerSettings,operators:data.plannerSettings.operators.map(o=>o.id!==target.id?o:{...o,skills,transportDutySetupVersion:1})}}
}
