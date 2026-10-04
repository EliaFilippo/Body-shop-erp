import type { EstimateLine, JobPhase } from '../types'
export const WORK_CYCLE = ['Lavaggio esterno','Smontaggio','Riparazione grandine','Lattoneria','Stuccatura','Incartatura','Verniciatura','Scartatura','Rimontaggio','Meccanica / gommista','Lucidatura','Lavaggio interni','Ritocchi','Consegna'] as const
const normal=(s:string)=>s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
export function cyclePhaseForLine(line:Partial<EstimateLine>) {
 const name=normal(line.standardWorkName || line.categoryOrPhase || '')
 const exact=WORK_CYCLE.find(phase=>normal(phase)===name); if(exact)return exact
 if(name==='incartare')return 'Incartatura';if(name==='scartare')return 'Scartatura'
 if(name==='preparazione')return 'Stuccatura';if(name==='lavaggio')return 'Lavaggio esterno';if(name==='controllo qualita')return 'Ritocchi'
 if(name.includes('vernici')||line.category==='verniciatura')return 'Verniciatura'
 if(name.includes('grandine'))return 'Riparazione grandine'
 if(name.includes('meccanica')||name.includes('gommista')||line.category==='meccanica')return 'Meccanica / gommista'
 if(line.category==='carrozzeria')return 'Lattoneria'
 return ''
}
export function buildSelectedWorkCycle(lines:EstimateLine[], selected:string[]): JobPhase[] {
 if(selected.some(name=>!WORK_CYCLE.includes(name as typeof WORK_CYCLE[number])))throw new Error('Fase di lavorazione non valida.')
 const requested=new Set([...selected,...lines.map(cyclePhaseForLine).filter(Boolean),'Consegna'])
 return WORK_CYCLE.map((name,index)=>{
  const source=lines.filter(line=>cyclePhaseForLine(line)===name)
  const minutes=source.reduce((sum,line)=>sum+Math.max(0,Number(line.lineTotalMinutes ?? ((line.estimatedMinutes ?? line.standardMinutes ?? 0)*(line.calculationType==='per-panel'?line.quantity:1)))),0)
  return {id:crypto.randomUUID(),name,status:requested.has(name)?'Da fare':'Completata',notRequired:!requested.has(name),cycleOrder:index+1,requiredSkill:name,operatorName:'',estimatedMinutes:Math.round(minutes),actualMinutes:0,notes:name==='Consegna'?'Consegna gestita dall’ufficio.':minutes===0&&requested.has(name)?'Tempario da configurare: imposta la durata della fase prima della pianificazione.':'',blockedReason:'',technicalWaitMinutes:name==='Verniciatura'?60:0,technicalWaitBlocksPhaseNames:name==='Verniciatura'?WORK_CYCLE.slice(index+1).filter(p=>p!=='Consegna'):[],operatorAssignments:[],timeAdjustments:[]}
 })
}
