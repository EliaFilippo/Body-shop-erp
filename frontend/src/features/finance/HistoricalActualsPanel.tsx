import { useRef, useState, type FormEvent } from 'react'
import type { ErpData, HistoricalActual } from '../../types'
import { historicalActualIssue, historicalCosts, historicalRevenues } from '../../services/historicalActuals'
import { productionRpc } from '../../services/liveProduction'
import type { DailyProductionWork, ProductionPlanningState } from '../../services/productionPlanningState'
import { toRomePlanningClock } from '../../services/romePlanningClock'
import type { NoticesConnection } from '../production/PhaseNotices'

const money = (amount: number) => amount.toLocaleString('it-IT', {style: 'currency', currency: 'EUR'})
const day = () => toRomePlanningClock(new Date().toISOString()).slice(0, 10)
const categories = ['Ricambi', 'Materiali di consumo', 'Lavorazioni esterne', 'Altri costi straordinari']

export function HistoricalActualsPanel({data, connection, onChange}: {data: ErpData; connection?: NoticesConnection; onChange: (data: ErpData) => void}) {
  const [kind, setKind] = useState<HistoricalActual['kind']>('hours')
  const [date, setDate] = useState(day)
  const [editing, setEditing] = useState<HistoricalActual>()
  const [draft, setDraft] = useState<HistoricalActual[]>([])
  const [issues, setIssues] = useState<string[]>([])
  const [reviewed, setReviewed] = useState(false)
  const [extraCostsConfirmed, setExtraCostsConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const latest = useRef(data)
  latest.current = data

  const configuredCosts = (data.plannerSettings.internalCostSettings?.monthlyCostItems ?? []).filter(cost => cost.active && cost.monthlyAmount > 0)
  const resetReview = () => { setReviewed(false); setIssues([]); setMessage('') }
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const base = {id: editing?.id ?? crypto.randomUUID(), date}
    const row: HistoricalActual = kind === 'hours'
      ? {...base, kind, operatorId: String(form.get('operator')), paidSeconds: Math.round(Number(form.get('paid')) * 3600), productiveSeconds: Math.round(Number(form.get('productive')) * 3600)}
      : {...base, kind, reference: String(form.get('reference')).trim(), category: kind === 'cost' ? String(form.get('category')) : 'Fattura cliente', amount: Math.round(Number(form.get('amount')) * 100) / 100}
    const issue = historicalActualIssue(data, row, draft, [], day())
    resetReview()
    if (issue) { setMessage(issue); return }
    setDraft(current => [...current.filter(item => item.id !== row.id), row])
    setEditing(undefined)
    if (row.kind === 'cost') setExtraCostsConfirmed(false)
    event.currentTarget.reset()
  }

  const verify = async (save: boolean) => {
    setBusy(true)
    setMessage('')
    try {
      let tablet: DailyProductionWork[] = []
      if (connection && draft.some(row => row.kind === 'hours')) {
        const state = await productionRpc<ProductionPlanningState>('production_planning_state', {p_company_id: connection.companyId}, connection.session, connection.config)
        if (!Array.isArray(state.dailyWork)) throw new Error('Ore tablet non disponibili. Riprova prima di salvare.')
        tablet = state.dailyWork
      }
      const current = latest.current
      const found = draft.map(row => historicalActualIssue(current, row, draft, tablet, day()))
      setIssues(found)
      setReviewed(!found.some(Boolean))
      if (save && !found.some(Boolean)) {
        const ids = new Set(draft.map(row => row.id))
        onChange({...current, historicalActuals: [...draft, ...(current.historicalActuals ?? []).filter(row => !ids.has(row.id))]})
        setDraft([])
        setReviewed(false)
        setExtraCostsConfirmed(false)
        setMessage('Consuntivi registrati. Saranno inclusi nel prossimo ricalcolo notturno.')
      }
    } catch (error) {
      setReviewed(false)
      setMessage(error instanceof Error ? error.message : 'Verifica non riuscita.')
    } finally { setBusy(false) }
  }

  const describe = (row: HistoricalActual) => row.kind === 'hours'
    ? `${data.plannerSettings.operators.find(operator => operator.id === row.operatorId)?.name ?? row.operatorId} · ${(row.paidSeconds / 3600).toLocaleString('it-IT')} h pagate · ${(row.productiveSeconds / 3600).toLocaleString('it-IT')} h produttive`
    : `${row.kind === 'cost' ? 'Costo' : 'Ricavo'} · ${row.reference} · ${row.category} · ${money(row.amount)} IVA esclusa`
  const hasCosts = draft.some(row => row.kind === 'cost')
  const month = date.slice(0, 7)
  const costs = historicalCosts(data).filter(row => row.date.startsWith(month)).reduce((sum, row) => sum + row.amount, 0)
  const revenues = historicalRevenues(data).filter(row => row.date.startsWith(month)).reduce((sum, row) => sum + row.amount, 0)

  return <details className="panel">
    <summary><strong>Consuntivi · Ore, costi e ricavi storici</strong></summary>
    <p>Riporta ore già lavorate, costi aggiuntivi e imponibili già fatturati fuori dal gestionale. Usa le date originali.</p>
    <form key={editing?.id ?? 'new'} className="form-grid" onSubmit={add}>
      <label>Tipo<select value={kind} disabled={busy || Boolean(editing)} onChange={event => setKind(event.target.value as HistoricalActual['kind'])}><option value="hours">Ore di lavoro</option><option value="cost">Costo aggiuntivo</option><option value="revenue">Ricavo fatturato</option></select></label>
      <label>Data consuntivo<input type="date" required max={day()} value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></label>
      {kind === 'hours' ? <>
        <label>Operatore<select name="operator" required defaultValue={editing?.kind === 'hours' ? editing.operatorId : ''}><option value="">Scegli operatore</option>{data.plannerSettings.operators.map(operator => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label>
        <label>Ore pagate<input name="paid" defaultValue={editing?.kind === 'hours' ? editing.paidSeconds / 3600 : undefined} type="number" required min="0.01" max="24" step="0.01" /></label>
        <label>Ore produttive<input name="productive" defaultValue={editing?.kind === 'hours' ? editing.productiveSeconds / 3600 : undefined} type="number" required min="0" max="24" step="0.01" /></label>
      </> : <>
        <label>{kind === 'revenue' ? 'Numero fattura' : 'Riferimento univoco della spesa'}<input name="reference" defaultValue={editing && editing.kind !== 'hours' ? editing.reference : undefined} required /></label>
        {kind === 'cost' && <label>Categoria<select name="category" defaultValue={editing && editing.kind !== 'hours' ? editing.category : undefined}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>}
        <label>Importo IVA esclusa (€)<input name="amount" defaultValue={editing && editing.kind !== 'hours' ? editing.amount : undefined} type="number" required min="0.01" step="0.01" /></label>
      </>}
      <button type="submit" disabled={busy}>{editing ? 'Metti correzione nel riepilogo' : 'Aggiungi al riepilogo'}</button>
      {editing && <button type="button" disabled={busy} onClick={() => setEditing(undefined)}>Annulla correzione</button>}
    </form>
    {draft.length > 0 && <section aria-label="Riepilogo consuntivi da salvare">
      <h4>Riepilogo da salvare</h4>
      <ul>{draft.map((row, index) => <li key={row.id}>{row.date} · {describe(row)}{' '}
        <button type="button" disabled={busy} onClick={() => {setDraft(current => current.filter(item => item.id !== row.id)); resetReview()}}>Rimuovi</button>
        {issues[index] && <p role="alert">{issues[index]}</p>}
      </li>)}</ul>
      {hasCosts && <>
        <p>Voci mensili già configurate: {configuredCosts.map(cost => cost.description || cost.category).join(', ') || 'nessuna'}.</p>
        <label><input type="checkbox" disabled={busy} checked={extraCostsConfirmed} onChange={event => setExtraCostsConfirmed(event.target.checked)} /> Confermo che questi costi sono aggiuntivi rispetto ai costi mensili e alla manodopera già valorizzata.</label>
      </>}
      <div className="row-actions">
        <button type="button" disabled={busy} onClick={() => void verify(false)}>Verifica sovrapposizioni</button>
        <button type="button" className="primary" disabled={busy || !reviewed || (hasCosts && !extraCostsConfirmed)} onClick={() => void verify(true)}>Salva consuntivi</button>
      </div>
      {reviewed && <p role="status">Verifica completata. Puoi salvare il riepilogo.</p>}
    </section>}
    {message && <p role="status">{message}</p>}
    {month && <p>Storico {month} · Ricavi {money(revenues)} · Costi aggiuntivi {money(costs)} · Differenza {money(revenues - costs)}</p>}
    <ul>{(data.historicalActuals ?? []).filter(row => row.date.startsWith(month)).map(row => <li key={row.id}>{row.date} · {describe(row)}{' '}
      <button type="button" disabled={busy || draft.some(item => item.id === row.id)} onClick={() => {setEditing(row); setDate(row.date); setKind(row.kind); resetReview()}}>Correggi</button>
    </li>)}</ul>
  </details>
}
