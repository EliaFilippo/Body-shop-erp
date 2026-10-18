import type { EstimateLine, JobPhase, MinorDamageTimes } from '../types'
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
export const SHARED_TIME_PHASES: Record<keyof MinorDamageTimes, string[]> = {
 sr: ['Smontaggio', 'Rimontaggio'], is: ['Incartatura', 'Scartatura'],
 v: ['Stuccatura', 'Verniciatura'], lc: ['Lucidatura'], la: ['Lavaggio interni'],
}
export function cyclePhasesForLine(line: Partial<EstimateLine>): string[] {
 if (line.minorDamageTimes) return Object.entries(line.minorDamageTimes)
  .filter(([, minutes]) => Number(minutes) > 0).flatMap(([key]) => SHARED_TIME_PHASES[key as keyof MinorDamageTimes])
 const phase = cyclePhaseForLine(line)
 return phase ? [phase] : []
}
export function buildSelectedWorkCycle(lines:EstimateLine[], selected:string[]): JobPhase[] {
 if(selected.some(name=>!WORK_CYCLE.includes(name as typeof WORK_CYCLE[number])))throw new Error('Fase di lavorazione non valida.')
 const requested=new Set([...selected,...lines.flatMap(cyclePhasesForLine),'Consegna'])
 const grouped = new Map<string, {key: string; minutes: number; names: string[]}>()
 for (const [key, names] of Object.entries(SHARED_TIME_PHASES)) {
  const total = lines.reduce((sum, line) => sum + Math.max(0, line.minorDamageTimes?.[key as keyof MinorDamageTimes] ?? 0) * (line.calculationType === 'per-panel' ? line.quantity : 1), 0)
  if (total > 0) for (const name of names) grouped.set(name, {key, minutes: total, names})
 }
 // Explicit manual work on a grouped stage adds to the same allowance, without duplication.
 const manual = (name: string) => lines.filter(line => !line.minorDamageTimes && cyclePhaseForLine(line) === name)
  .reduce((sum,line)=>sum+Math.max(0,Number(line.lineTotalMinutes ?? ((line.estimatedMinutes ?? line.standardMinutes ?? 0)*(line.calculationType==='per-panel'?line.quantity:1)))),0)
 return WORK_CYCLE.map((name,index)=>{
  const group = grouped.get(name)
  const allowance = group ? group.minutes + group.names.reduce((sum, stage) => sum + manual(stage), 0)
   : manual(name) || (name === 'Lavaggio esterno' && requested.has(name) ? 25 : 0)
  const countedHere = !group || name === group.names[0]
  return {id:crypto.randomUUID(),name,status:requested.has(name)?'Da fare':'Completata',notRequired:!requested.has(name),cycleOrder:index+1,requiredSkill:name,operatorName:'',
   estimatedMinutes: countedHere ? Math.round(allowance) : 0,
   sharedTimeKey: group?.key, sharedTimeMinutes: group ? Math.round(allowance) : undefined,
   actualMinutes:0,notes:name==='Consegna'?'Consegna gestita dall’ufficio.':group ? `Tempo condiviso ${group.names.join(' / ')}: ${Math.round(allowance)} min complessivi.` : allowance===0&&requested.has(name)?'Tempario da configurare: imposta la durata della fase prima della pianificazione.':'',blockedReason:'',technicalWaitMinutes:name==='Verniciatura'?60:0,technicalWaitBlocksPhaseNames:name==='Verniciatura'?WORK_CYCLE.slice(index+1).filter(p=>p!=='Consegna'):[],operatorAssignments:[],timeAdjustments:[]}
 })
}
