import { useState } from 'react'
import type { Customer, RepairJob } from '../../types'
import { deliveredJobReport, reportDuration } from '../../services/deliveredJobReport'
import { JobMaterialCosts } from './JobMaterialCosts'
import './deliveredJobReports.css'
const euro=(n:number)=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
export function DeliveredJobReports({jobs,customerById,onBack,onSaveMaterials,initialQuery=''}:{
 jobs:RepairJob[];customerById:(id:string)=>Customer|undefined;onBack:()=>void;
 onSaveMaterials:(id:string,amount:number,note:string)=>void;initialQuery?:string
}){
 const [query,setQuery]=useState(initialQuery)
 const delivered=jobs.filter(j=>j.status==='Consegnata')
 const found=delivered.filter(j=>`${j.plate} ${j.number} ${customerById(j.customerId)?.name??''}`.toLocaleLowerCase('it-IT').includes(query.trim().toLocaleLowerCase('it-IT')))
  .sort((a,b)=>(b.deliveredAt??b.updatedAt).localeCompare(a.deliveredAt??a.updatedAt))
 return <div className="delivered-reports">
  <section className="welcome"><div><span className="eyebrow">REPORT VETTURE CONSEGNATE</span><h2>Ore e materiali, tutto insieme</h2><p>Ore produttive degli operatori. Due persone al lavoro per un’ora valgono due ore; pause e attese tecniche dei tablet sono escluse.</p></div><button onClick={onBack}>← Torna a Preventivi / Commesse</button></section>
  <section className="panel"><label>Cerca vettura consegnata<input type="search" placeholder="Targa, cliente o commessa" value={query} onChange={e=>setQuery(e.target.value)}/></label><p>{found.length} vetture trovate</p></section>
  {!found.length&&<section className="panel"><p>{delivered.length?'Nessuna vettura corrisponde alla ricerca.':'Nessuna vettura consegnata. I report compariranno quando la commessa sarà segnata Consegnata.'}</p></section>}
  {found.map(job=>{
   const report=deliveredJobReport(job)
   const materials=report.materials
   const timeTone=report.differenceSeconds===null?'pending':report.differenceSeconds<0?'over':'within'
   return <article key={job.id} className="panel delivered-report" aria-label={`Report ${job.plate} ${job.number}`}>
    <div className="panel-head"><div><span className="eyebrow">{job.number} · CONSEGNATA</span><h2>{job.plate}</h2><p>{customerById(job.customerId)?.name??'Cliente'}{job.deliveredAt?` · Consegna ${new Date(job.deliveredAt).toLocaleDateString('it-IT')}`:''}</p></div><div><span>Importo preventivo · IVA esclusa</span><strong>{euro(job.taxableAmount)}</strong></div></div>
    <div className="delivered-report-grid">
     <div className="report-metric"><span>Ore previste</span><strong>{reportDuration(report.plannedSeconds)}</strong><small>Tempi condivisi conteggiati una sola volta</small></div>
     <div className={`report-metric ${timeTone}`}><span>Ore lavorate registrate</span><strong>{report.complete||report.workedSeconds>0?reportDuration(report.workedSeconds):'Da registrare'}</strong><small>{report.complete?'Totale completo':`Totale parziale · ${report.missing} fasi senza registrazione completa`}</small></div>
     <div className="report-metric"><span>Materiali stimati</span><strong>{euro(materials.estimatedMaterials)}</strong><small>Dal preventivo · IVA esclusa</small></div>
     <div className={`report-metric ${materials.actualMaterials===null?'pending':materials.materialsSaving!<0?'over':'within'}`}><span>Materiali reali</span><strong>{materials.actualMaterials===null?'Da inserire':euro(materials.actualMaterials)}</strong><small>Totale consumabili · IVA esclusa</small></div>
    </div>
    <div className="report-results">
     <p className={timeTone}>{report.differenceSeconds===null?'Confronto ore disponibile con tutte le registrazioni e i tempi previsti.':report.differenceSeconds<0?`Tempo superato di ${reportDuration(-report.differenceSeconds)}`:`Tempo risparmiato: ${reportDuration(report.differenceSeconds)}`}</p>
     <p>{materials.materialsSaving===null?'Inserisci i materiali reali per confrontarli con la stima.':materials.materialsSaving<0?`Materiali oltre la stima: ${euro(-materials.materialsSaving)}`:`Risparmio materiali: ${euro(materials.materialsSaving)}`}</p>
    </div>
    {report.manual&&<p>Include ore registrate manualmente dall’ufficio. Le registrazioni dei tablet, quando presenti, hanno precedenza.</p>}
    <details><summary>Vedi dettaglio lavorazioni</summary><div className="table-wrap"><table><thead><tr><th>Lavorazione</th><th>Ore previste</th><th>Ore registrate</th><th>Registrazioni</th></tr></thead><tbody>
     {report.rows.map(row=><tr key={row.label}><th>{row.label}</th><td>{reportDuration(row.plannedMinutes*60)}</td><td>{row.missing&&row.workedSeconds===0?'Da registrare':reportDuration(row.workedSeconds)}</td><td>{row.missing?'Parziali o mancanti':row.manual?'Ufficio':'Tablet'}</td></tr>)}
    </tbody></table></div></details>
    <details><summary>{materials.actualMaterials===null?'Inserisci materiali reali':'Vedi o aggiorna materiali reali'}</summary><JobMaterialCosts job={job} onSave={(amount,note)=>onSaveMaterials(job.id,amount,note)}/></details>
   </article>
  })}
 </div>
}
