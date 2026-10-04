import { WORK_CYCLE } from '../services/workCycle'
export function WorkCycleFields({value,included,onChange,disabled=false}:{value:string[]|undefined;included:string[];onChange:(value:string[])=>void;disabled?:boolean}) {
 return <section className="full panel"><h3>Fasi necessarie · ciclo di lavorazione</h3><p>Seleziona gli interventi richiesti. Le fasi delle righe del preventivo e la consegna sono già incluse. Dopo la verniciatura è prevista un’ora di asciugatura senza conteggiarla come lavoro. Le durate senza tempario vanno configurate nelle commesse.</p>
 {value===undefined?<button type="button" disabled={disabled} onClick={()=>onChange([])}>Usa il ciclo completo su questo preventivo</button>:<div className="form-grid">{WORK_CYCLE.map(name=><label key={name}><input type="checkbox" checked={name==='Consegna'||included.includes(name)||value.includes(name)} disabled={disabled||name==='Consegna'||included.includes(name)} onChange={e=>onChange(e.target.checked?[...value,name]:value.filter(p=>p!==name))}/>Fase: {name}</label>)}</div>}
 </section>
}
