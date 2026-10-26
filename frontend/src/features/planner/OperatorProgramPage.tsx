import { RunningTaskCard, useOperatorStatus } from './operatorLiveStatus'
import type { NoticesConnection } from '../production/PhaseNotices'
import { workingMinutesForDate } from '../../services/workCalendar'
import { phaseDisplayName } from '../../services/workCycle'
import { useMemo, useState } from 'react'
import { isVehicleWaitingForCone } from '../../services/erp'
import { recalculateOperatorPrograms, selectSchedulablePhase, todayKey } from '../../services/planner'
import { supportsOperatorDuty } from '../../services/operatorSkills'
import type { ErpData } from '../../types'

const timeLabel = (iso: string) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso))

export function OperatorProgramPage({ data, onChange, connection }: { data: ErpData; onChange: (next: ErpData) => void; connection?:NoticesConnection }) {
  const {running,message}=useOperatorStatus(connection)
  const [date, setDate] = useState(todayKey)
  const moveDay = (days: number) => { const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate()+days); setDate(next.toISOString().slice(0,10)) }
  const programs = useMemo(() => data.plannerSettings.operators.filter(operator => operator.active).map(operator => (data.operatorPrograms ?? []).find(item => item.date === date && item.operatorId === operator.id) ?? { operatorId: operator.id, operatorName: operator.name, date, revision: 0, tasks: [] }).sort((a,b) => a.operatorName.localeCompare(b.operatorName,'it-IT')), [data.operatorPrograms, data.plannerSettings.operators, date])
  const history = useMemo(() => (data.operatorProgramHistory ?? []).filter((item) => item.date === date).slice(0, 6), [data.operatorProgramHistory, date])
  const attendanceMinutes=(id:string)=>workingMinutesForDate(date,data.plannerSettings,data.plannerSettings.operators.find(o=>o.id===id))
  const idleReason=(id:string)=>{
    const op=data.plannerSettings.operators.find(o=>o.id===id)!
    if(attendanceMinutes(id)<=0)return 'Nessuna presenza lavorativa configurata per questa data.'
    const open=(data.jobs??[]).filter(j=>!['Consegnata','Annullata'].includes(j.status))
    if(!open.length)return 'Non ci sono commesse aperte da assegnare.'
    const compatible=open.filter(j=>j.phases.some(p=>!p.notRequired&&p.status!=='Completata'&&p.name!=='Consegna'&&supportsOperatorDuty(op,p.requiredSkill||p.name)))
    if(!compatible.length)return 'Nessuna fase da svolgere compatibile con le mansioni abilitate.'
    if(compatible.every(j=>j.blocks.length>0||!!data.vehicles.find(v=>v.id===j.vehicleId)?.blockReason))return 'Le commesse compatibili sono bloccate: verifica ricambi e blocchi operativi.'
    return 'Nessuna assegnazione nella data scelta. Verifica disponibilità delle vetture, fasi precedenti e assegnazioni manuali delle commesse compatibili.'
  }
  const coneLabelByTask = (jobId: string, vehicleId: string) => {
    const job = (data.jobs ?? []).find((item) => item.id === jobId)
    if (job?.coneNumber != null) return `Cono ${job.coneNumber}`
    const vehicle = data.vehicles.find((item) => item.id === vehicleId)
    if (vehicle?.coneNumber != null) return `Cono ${vehicle.coneNumber}`
    return vehicle && isVehicleWaitingForCone(vehicle) ? 'In attesa cono (Nessun cono disponibile)' : '—'
  }

  return <>
    <section className="welcome">
      <div>
        <span className="eyebrow">PROGRAMMA OPERATORI</span>
        <h2>Piano giornaliero autonomo</h2>
        <p>Sequenza attivita per operatore calcolata da priorita, consegne, stato fase, compatibilita e disponibilita.</p>
      </div>
      <div className="planner-actions">
        <button className="primary" onClick={() => onChange(recalculateOperatorPrograms(data, todayKey(), 'Ricalcolo piano manuale'))}>Ricalcola piano</button>
      </div>
    </section>

    <section className="panel table-panel">
      <h3>Assegna il prossimo lavoro</h3>
      <p>Scegli un operatore per la fase, oppure lascia Automatico. Il prezzo del preventivo resta invariato.</p>
      {(data.jobs ?? []).filter(job => !['Consegnata', 'Annullata'].includes(job.status)).map(job => {
        const phase = selectSchedulablePhase(job)?.phase
        if (!phase) return null
        const operators = data.plannerSettings.operators.filter(o => o.active && supportsOperatorDuty(o, phase.requiredSkill || phase.name))
        return <div key={job.id}>{job.plate} · {phaseDisplayName(phase.name)}
          <select aria-label={`Assegnazione ${job.plate}`} value={phase.preferredOperatorId ?? ''} onChange={event => {
            const operatorId = event.target.value
            const operator = operators.find(o => o.id === operatorId)
            const next = { ...data, jobs: (data.jobs ?? []).map(j => j.id !== job.id ? j : { ...j,
              phases: j.phases.map(p => p.id === phase.id ? { ...p, preferredOperatorId: operatorId || undefined, supportOperatorId: p.supportOperatorId === operatorId ? undefined : p.supportOperatorId } : p),
              updatedAt: new Date().toISOString(), history: [{ id: crypto.randomUUID(), at: new Date().toISOString(), actor: 'Ufficio', message: `${phase.name}: ${operator ? `operatore scelto ${operator.name}` : 'assegnazione automatica per margine'}` }, ...j.history],
            }) }
            onChange(recalculateOperatorPrograms(next, todayKey(), 'Scelta operatore aggiornata'))
          }}>
            <option value="">Automatico · in base al margine</option>
            {phase.preferredOperatorId && !operators.some(o => o.id === phase.preferredOperatorId) && <option value={phase.preferredOperatorId}>Operatore non disponibile: modifica la scelta</option>}
            {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <label>Secondo operatore sulla stessa fase
            <select aria-label={`Secondo operatore ${job.plate}`} value={phase.supportOperatorId ?? ''} onChange={event => {
              const supportOperatorId = event.target.value || undefined
              const operator = operators.find(o => o.id === supportOperatorId)
              const stamp = new Date().toISOString()
              const next = { ...data, jobs: (data.jobs ?? []).map(j => j.id !== job.id ? j : { ...j,
                phases: j.phases.map(p => p.id === phase.id ? { ...p, supportOperatorId } : p), updatedAt: stamp,
                history: [{ id: crypto.randomUUID(), at: stamp, actor: 'Ufficio', message: `${phase.name}: ${operator ? `affiancamento di ${operator.name}` : 'affiancamento rimosso'}` }, ...j.history],
              }) }
              onChange(recalculateOperatorPrograms(next, todayKey(), 'Affiancamento aggiornato'))
            }}>
              <option value="">Nessun affiancamento manuale</option>
              {phase.supportOperatorId && !operators.some(o => o.id === phase.supportOperatorId) && <option value={phase.supportOperatorId}>Operatore non disponibile</option>}
              {operators.filter(o => o.id !== phase.preferredOperatorId).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <small>Entrambi premono Start dal proprio tablet. Pausa e Fine agiscono soltanto sul singolo operatore; il tempo della fase è condiviso.</small>
          <small>{'Automatico è la scelta iniziale. Puoi cambiare operatore anche a fase iniziata. Per il passaggio effettivo, il precedente operatore preme Pausa e il nuovo preme Start: le ore restano ai rispettivi profili.'}</small>
        </div>
      })}
      {!(data.jobs ?? []).some(job => !['Consegnata', 'Annullata'].includes(job.status)) && <p>Conferma un preventivo per assegnare la prima commessa.</p>}
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">TIMELINE</span><h3>{date}</h3></div><div className="planner-actions"><button onClick={()=>moveDay(-1)}>← Giorno precedente</button><label>Data programma operatori<input type="date" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value)}} /></label><button onClick={()=>setDate(todayKey())}>Oggi</button><button onClick={()=>moveDay(1)}>Giorno successivo →</button></div></div><p>Consulta le mansioni già pianificate per ciascun operatore, anche nei prossimi giorni. Cambiare la data non modifica le assegnazioni. Le fasi successive sono previsioni: sui tablet diventano avviabili solo dopo il completamento reale delle precedenti. Le quote dei tempi condivisi servono a organizzare il piano; il totale del timer resta unico.</p>
      <p>Timer attivi: verde = nei tempi; rosso = fuori tempo. Aggiornamento ogni 5 secondi. Le schede programmate restano neutre.</p>
      {message&&<p role="status">{message}</p>}
      <div className="week-grid">
        {programs.map((program) => <article className="day-card" key={program.operatorId}>
          <div className="day-head"><strong>{program.operatorName}</strong><span>{program.revision ? `rev. ${program.revision}` : 'Senza assegnazioni'}</span></div>
          <p>{Math.round(program.tasks.reduce((sum,task)=>sum+task.plannedMinutes,0))} min programmati / {Math.round(attendanceMinutes(program.operatorId))} min di presenza</p><div className="day-jobs">
            {date===todayKey()&&running.filter(t=>t.operatorId===program.operatorId).map(task=>{
              const job=data.jobs?.find(j=>j.id===task.jobId)
              const phase=job?.phases.find(p=>p.id===task.phaseId)
              return <RunningTaskCard key={task.jobId+task.phaseId} task={task} plate={job?.plate??'Vettura'} phase={phaseDisplayName(phase?.name??'Lavorazione')} cone={job?.coneNumber}/>
            })}
            {program.tasks.map((task) => <div className="day-job" key={task.id}>
              <strong className="plate">{timeLabel(task.startAt)}-{timeLabel(task.endAt)}</strong>
              <span>{task.jobNumber} - {phaseDisplayName(task.phaseName)} - {task.plate}</span>
              <small>{task.plannedMinutes} min · {task.priority}</small>
              <small>{coneLabelByTask(task.jobId, task.vehicleId)}</small>
              {!!task.panelNames?.length && <small>Pannelli: {task.panelNames.join(', ')}</small>}
              {!!task.panelNotes?.length && <small>Note pannello: {task.panelNotes.join(' | ')}</small>}
              <small>{task.reason}</small>
            </div>)}
            {!program.tasks.length && <small>{idleReason(program.operatorId)}</small>}
          </div>
        </article>)}
        {!programs.length && <article className="day-card"><div className="day-head"><strong>Nessun programma disponibile</strong></div><small>Esegui Ricalcola piano per generare il piano giornaliero.</small></article>}
      </div>
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">STORICO</span><h3>Revisioni automatiche</h3></div></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Revisione</th><th>Generato</th><th>Motivo</th><th>Operatori</th><th>Attivita</th></tr></thead>
          <tbody>
            {history.map((entry) => <tr key={entry.id}>
              <td>{entry.revision}</td>
              <td>{new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.generatedAt))}</td>
              <td>{entry.reason}</td>
              <td>{entry.programs.length}</td>
              <td>{entry.programs.reduce((sum, program) => sum + program.tasks.length, 0)}</td>
            </tr>)}
            {!history.length && <tr><td colSpan={5}><div className="empty">Nessuna revisione disponibile.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </>
}
