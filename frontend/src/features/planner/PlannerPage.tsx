import { useMemo, useState } from 'react'
import { CapacityBar } from '../../components/CapacityBar'
import { TrafficLight } from '../../components/TrafficLight'
import { addDays, calculatePlanner, capacityWithAssignments, parseDate, todayKey } from '../../services/planner'
import type { Customer, ErpData } from '../../types'

const mondayOf = (value: string) => {
  const date = parseDate(value)
  const day = date.getUTCDay() || 7
  return addDays(value, 1 - day)
}
const shortDate = (value: string) => new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(parseDate(value))

export function PlannerPage({ data, customerById, onMove, onOpenSettings }: { data: ErpData; customerById: (id: string) => Customer | undefined; onMove: (vehicleId: string, date: string) => void; onOpenSettings: () => void }) {
  const [week, setWeek] = useState(mondayOf(todayKey()))
  const [draggedVehicleId, setDraggedVehicleId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const result = useMemo(() => calculatePlanner(data.vehicles, data.plannerSettings), [data.vehicles, data.plannerSettings])
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index))
  const vehicleResult = (id: string) => result.vehicles.find((item) => item.vehicleId === id)
  const handleDrop = (date: string) => {
    if (!draggedVehicleId) return
    onMove(draggedVehicleId, date)
    setDraggedVehicleId(null)
    setDropTarget(null)
  }
  return <>
    <section className="welcome"><div><span className="eyebrow">PIANIFICAZIONE REALE</span><h2>Planner intelligente</h2><p>Capacità protetta, saturazione e consegne vengono ricalcolate dopo ogni modifica.</p></div><div className="planner-actions"><button className="secondary" onClick={() => setWeek(addDays(week, -7))}>← Settimana</button><button className="secondary" onClick={() => setWeek(mondayOf(todayKey()))}>Oggi</button><button className="secondary" onClick={() => setWeek(addDays(week, 7))}>Settimana →</button><button className="primary" onClick={onOpenSettings}>Impostazioni</button></div></section>
    {!data.plannerSettings.operators.length && <div className="toast warning">Configura almeno un operatore: senza ore lavorabili non è possibile calcolare una consegna.</div>}
    <section className="week-grid">{days.map((date) => {
      const capacity = capacityWithAssignments(date, data.plannerSettings, result.assignments)
      const dailyAssignments = result.assignments.filter((item) => item.date === date)
      return <article className={`day-card ${capacity.protected === 0 ? 'closed' : ''} ${dropTarget === date ? 'drop-target' : ''}`} key={date} onDragOver={(event) => { event.preventDefault(); setDropTarget(date) }} onDrop={() => handleDrop(date)}><div className="day-head"><strong>{shortDate(date)}</strong><span>{capacity.protected === 0 ? 'Chiuso' : `${capacity.committed}/${capacity.protected} h`}</span></div><CapacityBar percent={capacity.saturation} overload={capacity.overload} /><small>{capacity.remaining} h disponibili · capacità normale {capacity.normal} h</small><div className="day-jobs">{dailyAssignments.map((assignment) => { const vehicle = data.vehicles.find((item) => item.id === assignment.vehicleId); if (!vehicle) return null; const plan = vehicleResult(vehicle.id); return <div className="day-job" draggable onDragStart={() => setDraggedVehicleId(vehicle.id)} onDragEnd={() => { setDraggedVehicleId(null); setDropTarget(null) }} key={`${assignment.vehicleId}-${date}`}><strong className="plate">{vehicle.plate}</strong><span>{assignment.protectedHours} h · {vehicle.priority ?? 'Normale'}</span><small>{customerById(vehicle.customerId)?.name}</small><TrafficLight status={plan?.status ?? 'neutral'} /></div> })}</div></article>
    })}</section>
    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">CONSEGNE E BLOCCHI</span><h3>Vetture pianificate</h3></div></div><div className="table-wrap"><table><thead><tr><th>Vettura</th><th>Ore</th><th>Consegna richiesta</th><th>Consegna calcolata</th><th>Responso</th><th>Sposta lavorazione</th></tr></thead><tbody>{data.vehicles.filter((vehicle) => vehicle.status !== 'Consegnata' && vehicle.estimatedHours > vehicle.workedHours).map((vehicle) => { const plan = vehicleResult(vehicle.id); return <tr className={plan?.blocked ? 'blocked-row' : ''} key={vehicle.id}><td><strong className="plate">{vehicle.plate}</strong><small>{plan?.blocked ? `Bloccata: ${vehicle.blockReason || 'ricambi mancanti'}` : `${vehicle.make} ${vehicle.model}`}</small></td><td>{Math.max(0, vehicle.estimatedHours - vehicle.workedHours)} h</td><td>{vehicle.requestedDeliveryDate || 'Non indicata'}</td><td>{plan?.calculatedDeliveryDate || 'Non calcolabile'}</td><td><TrafficLight status={plan?.status ?? 'neutral'} />{plan?.status === 'red' && <small>Mancano {plan.missingHours} h · ritardo {plan.delayWorkingDays} giorni · consigliata {plan.suggestedDate}</small>}</td><td><input aria-label={`Sposta ${vehicle.plate}`} type="date" value={vehicle.manualPlanningDate} onChange={(event) => onMove(vehicle.id, event.target.value)} disabled={plan?.blocked} /></td></tr> })}</tbody></table></div></section>
  </>
}
