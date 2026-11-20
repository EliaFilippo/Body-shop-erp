import { reportDuration } from '../../services/deliveredJobReport'
const money=(n:number)=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
export function hourlyRevenueComparison(revenue:number,seconds:number,target:number|null) {
 const actual=Number.isFinite(revenue)&&Number.isFinite(seconds)&&seconds>0 ? Math.round(revenue*3600/seconds*100)/100:null
 const goal=target!==null&&Number.isFinite(target)&&target>=0 ? Math.round(target*100)/100:null
 const delta=actual!==null&&goal!==null?Math.round((actual-goal)*100)/100:null
 return {actual,goal,delta,percent:delta!==null&&goal!==null&&goal>0?delta/goal*100:null}
}
export function HourlyRevenueComparison({revenue,seconds,target,net=false}:{revenue:number;seconds:number;target:number|null;net?:boolean}) {
 const value=hourlyRevenueComparison(revenue,seconds,target)
 const state=value.delta===null?'Confronto non disponibile':value.delta>0?'Sopra obiettivo':value.delta<0?'Sotto obiettivo':'In linea con l’obiettivo'
 const color=value.delta===null||value.delta===0?undefined:value.delta>0?'#67d9a3':'#ff6b6b'
 return <section aria-label="Ricavo orario rispetto all’obiettivo"><h4>{net?'Margine orario rispetto all’obiettivo':'Ricavo orario sulle ore effettive'}</h4>
  <div className="summary-grid"><div className="summary-card"><span>{net?'Margine dopo i costi diretti · IVA esclusa':'Ricavo effettivo · IVA esclusa'}</span><strong>{value.actual===null?'Non calcolabile: ore o importi non disponibili':money(value.actual)+'/h'}</strong><small>{net?'Ricavo meno materiali, ricambi, manodopera e altri costi diretti, diviso per le ore registrate. Le spese generali non vengono sottratte qui: questo margine serve a coprirle.':'Ricavo della commessa diviso per le ore registrate.'} Ore totali: {reportDuration(Math.max(0,seconds))}.</small></div>
  <div className="summary-card"><span>Tariffa obiettivo attuale</span><strong>{value.goal===null?'Obiettivo da configurare':money(value.goal)+'/h'}</strong><small>{net?'Obiettivo mensile residuo configurato diviso per le ore produttive residue: stessa base del margine registrato, senza aggiungere nuovamente personale e materiali.':'Tariffa di ricavo necessaria per l’obiettivo attuale.'}</small></div>
  <div className="summary-card" style={{color}}><span>Confronto con l’obiettivo</span><strong>{state}</strong>{value.delta!==null&&value.percent!==null&&<small>{value.delta>0?'+':''}{money(value.delta)}/h · {value.percent>0?'+':''}{value.percent.toLocaleString('it-IT',{maximumFractionDigits:2})}%</small>}</div></div>
 </section>
}
