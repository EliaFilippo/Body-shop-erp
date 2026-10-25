import type { ErpData, OperatorDayExtension } from '../types'
import { recalculateOperatorPrograms } from './planner'
export function applyDayExtensions(data:ErpData,entries:OperatorDayExtension[],date:string,nowIso?:string):ErpData {
 const sorted=[...entries].sort((a,b)=>a.id.localeCompare(b.id))
 const previous=[...(data.plannerSettings.operatorDayExtensions??[])].sort((a,b)=>a.id.localeCompare(b.id))
 if(JSON.stringify(sorted)===JSON.stringify(previous))return data
 return recalculateOperatorPrograms({...data,plannerSettings:{...data.plannerSettings,operatorDayExtensions:sorted}},date,'Prosecuzione giornata confermata',nowIso)
}
