import { useMemo, useState } from 'react'
import { DeliveryMarginSummary } from '../workflow/DeliveryMarginSummary'
import { closedJobMargin } from '../../services/closedJobMargin'
import { reportDuration } from '../../services/deliveredJobReport'
import { closedPlanningWork } from '../../services/closedPlanningWork'
import { isVehicleDeliveredStatus } from '../../services/vehicleStatuses'
import { normalizePlate } from '../../services/erp'
import { monthlyTargetRate } from '../../services/monthlyTargetRate'
import { marginMetrics } from '../../services/planner'
import { recordedJobVehicleCosts } from '../../services/jobMaterialCosts'
import type { ErpData } from '../../types'

const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const romeDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
const number = (value: number) => value.toLocaleString('it-IT', { maximumFractionDigits: 2 })

export function VehicleMarginsPanel({ data, monthKey, marginHourlyRate }: { data: ErpData; monthKey: string; marginHourlyRate?: number | null }) {
  const { jobs, vehicles, plannerSettings, nightlyPlanning } = data
  const rows = useMemo(() => {
    const { jobIds } = closedPlanningWork(data)
    const byId = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]))
    const byPlate = new Map(vehicles.map(vehicle => [normalizePlate(vehicle.plate), vehicle]))
    return (jobs ?? []).filter(job => !jobIds.has(job.id)).flatMap(job => {
      const vehicle = (job.vehicleId && byId.get(job.vehicleId)) || byPlate.get(normalizePlate(job.plate))
      if (!vehicle) return []
      const metrics = marginMetrics(job, vehicle, plannerSettings)
      const hours = metrics.productiveMinutes / 60
      return [{
        id: job.id, jobNumber: job.number, plate: vehicle.plate, cone: vehicle.coneNumber, hours, revenue: metrics.plannedRevenue,
        hourlyRevenue: hours > 0 ? metrics.plannedRevenue / hours : null,
        margin: hours > 0 && metrics.rate > 0 && metrics.plannedRevenue > 0 ? metrics.totalMargin : null,
      }]
    }).sort((a, b) => a.plate.localeCompare(b.plate, 'it') || a.jobNumber.localeCompare(b.jobNumber))
  }, [data, jobs, vehicles, plannerSettings])
  const target = marginHourlyRate === undefined ? monthlyTargetRate(plannerSettings, monthKey, nightlyPlanning?.economics).hourlyRate : marginHourlyRate
  const estimated = rows.filter(row => row.margin !== null)
  const total = estimated.reduce((sum, row) => sum + (row.margin ?? 0), 0)

  return <>
  <details className="panel">
    <summary><strong>Margini stimati per vettura</strong> · {rows.length} commesse aperte</summary>
    <p>Stima del Planner sui ricavi senza IVA, sulle ore previste e sui costi configurati. La tariffa obiettivo {target === null ? 'è da configurare' : `è ${money(target)}/h`} e serve per confrontare il ricavo orario.</p>
    {estimated.length > 0 && <p>Margine stimato complessivo su {estimated.length} commesse con dati disponibili · <strong>{money(total)}</strong></p>}
    {rows.length === 0 ? <p>Nessuna commessa aperta.</p> : <div style={{ overflowX: 'auto' }}>
      <table aria-label="Margini stimati delle commesse aperte">
        <thead><tr><th scope="col">Targa</th><th scope="col">Cono</th><th scope="col">Commessa</th><th scope="col">Ricavo senza IVA</th><th scope="col">Ore previste</th><th scope="col">Ricavo orario</th><th scope="col">Rispetto all’obiettivo</th><th scope="col">Margine stimato</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <th scope="row">{row.plate}</th><td>{row.cone ?? '—'}</td><td>{row.jobNumber}</td><td>{money(row.revenue)}</td>
          <td>{row.hours > 0 ? number(row.hours) : '—'}</td>
          <td>{row.hourlyRevenue === null ? '—' : `${money(row.hourlyRevenue)}/h`}</td>
          <td>{row.hourlyRevenue === null || target === null ? '—' : row.hourlyRevenue < target ? 'Sotto obiettivo' : 'Obiettivo raggiunto'}</td>
          <td>{row.margin === null ? 'Dati da completare' : <strong>{money(row.margin)}</strong>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </details>
  <ClosedJobMargins data={data} monthKey={monthKey} marginHourlyRate={marginHourlyRate} />
  </>
}

function ClosedJobMargins({ data, monthKey, marginHourlyRate }: { data: ErpData; monthKey: string; marginHourlyRate?: number | null }) {
  const [summaryJobId, setSummaryJobId] = useState<string | null>(null)
  const { jobs, vehicles, plannerSettings, nightlyPlanning, coneHistory } = data
  const rows = useMemo(() => {
    const vehiclesById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]))
    const jobsByVehicle = new Map<string, number>()
    for (const job of jobs ?? []) {
      if (job.vehicleId) jobsByVehicle.set(job.vehicleId, (jobsByVehicle.get(job.vehicleId) ?? 0) + 1)
    }
    return (jobs ?? []).flatMap(job => {
      const vehicle = job.vehicleId ? vehiclesById.get(job.vehicleId) : undefined
      const uniqueVehicleJob = vehicle && jobsByVehicle.get(vehicle.id) === 1
      const vehicleDelivery = vehicle && uniqueVehicleJob && isVehicleDeliveredStatus(plannerSettings, vehicle.status) ? vehicle.deliveredAt : undefined
      const matchingDelivery = vehicleDelivery && Number.isFinite(Date.parse(vehicleDelivery))
        && romeDate.format(new Date(vehicleDelivery)) >= job.entryDate ? vehicleDelivery : undefined
      if (job.status === 'Annullata' || (job.status !== 'Consegnata' && !matchingDelivery)) return []
      const deliveredAt = job.deliveredAt || matchingDelivery
      const deliveryDate = deliveredAt && Number.isFinite(Date.parse(deliveredAt)) ? romeDate.format(new Date(deliveredAt)) : undefined
      const costs = deliveryDate && vehicle ? recordedJobVehicleCosts(vehicle, job, jobs ?? [], deliveryDate) : undefined
      return [{ job, deliveredAt, deliveryDate, ...closedJobMargin(job, plannerSettings.operators, costs?.materials, costs?.parts) }]
    }).sort((a, b) => (b.deliveredAt ?? b.job.updatedAt).localeCompare(a.deliveredAt ?? a.job.updatedAt))
  }, [jobs, vehicles, plannerSettings])
  const calculated = rows.filter(row => row.marginCents !== null && !row.materialsToConfirm && !row.partsEstimated)
  const totalCents = calculated.reduce((sum, row) => sum + (row.marginCents ?? 0), 0)
  const targets = new Map<string, number | null>()
  const coneAssignments = useMemo(() => {
    const byVehicle = new Map<string, ErpData['coneHistory']>()
    for (const event of coneHistory) {
      if (event.action === 'Liberato') continue
      const history = byVehicle.get(event.vehicleId) ?? []
      history.push(event)
      byVehicle.set(event.vehicleId, history)
    }
    for (const history of byVehicle.values()) {
      history.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    }
    return byVehicle
  }, [coneHistory])

  return <>
  <details className="panel">
    <summary><strong>Margini a consuntivo per vettura</strong> · {rows.length} commesse consegnate</summary>
    <p>Importi IVA esclusa. Il margine usa l’importo concordato in commessa, i materiali registrati a consuntivo, il costo dei ricambi e le ore lavorate valorizzate alla tariffa di ogni operatore.</p>
    {calculated.length > 0 && <p>Margine complessivo su {calculated.length} commesse con dati completi · <strong>{money(totalCents / 100)}</strong></p>}
    {rows.length === 0 ? <p>Nessuna commessa consegnata.</p> : <div style={{ overflowX: 'auto' }}>
      <table aria-label="Margini a consuntivo delle commesse consegnate">
        <thead><tr><th scope="col">Targa</th><th scope="col">Cono</th><th scope="col">Commessa</th><th scope="col">Consegna</th><th scope="col">Ricavo senza IVA</th><th scope="col">Ore lavorate</th><th scope="col">Costi per operatore</th><th scope="col">Ricavo orario</th><th scope="col">Rispetto all’obiettivo</th><th scope="col">Margine a consuntivo</th></tr></thead>
        <tbody>{rows.map(row => {
          const deliveryMonth = row.deliveryDate?.slice(0, 7) ?? monthKey
          if (!targets.has(deliveryMonth)) {
            targets.set(deliveryMonth, deliveryMonth === monthKey && marginHourlyRate !== undefined ? marginHourlyRate
              : monthlyTargetRate(plannerSettings, deliveryMonth, nightlyPlanning?.economics).hourlyRate)
          }
          const target = targets.get(deliveryMonth) ?? null
          const { job } = row
          const { deliveredAt } = row
          const cone = deliveredAt && job.vehicleId
            ? coneAssignments.get(job.vehicleId)?.find(event => event.timestamp <= deliveredAt && event.timestamp >= job.entryDate)?.coneNumber
            : undefined
          return <tr key={job.id}>
            <th scope="row"><button type="button" className="planner-link-button plate"
              aria-label={`Guadagno alla consegna ${job.plate}`} onClick={() => setSummaryJobId(job.id)}>{job.plate}</button></th><td>{cone ?? '—'}</td><td>{job.number}</td><td>{row.deliveryDate?.split('-').reverse().join('/') ?? '—'}</td>
            <td>{row.revenueCents === null ? '—' : money(row.revenueCents / 100)}</td>
            <td>{row.complete ? reportDuration(row.workedSeconds) : row.workedSeconds > 0 ? `${reportDuration(row.workedSeconds)} (parziale)` : 'Da registrare'}</td>
            <td>{row.operatorLabor.length ? row.operatorLabor.map(worker => <div key={worker.id}>
              {worker.name} · {reportDuration(worker.seconds)} · {worker.costCents === null ? 'Tariffa da configurare' : money(worker.costCents / 100)}
            </div>) : '—'}{!row.laborComplete && <small>Controlla ore e tariffe</small>}</td>
            <td>{row.hourlyRevenue === null ? '—' : `${money(row.hourlyRevenue)}/h`}</td>
            <td>{row.hourlyRevenue === null || target === null ? '—' : row.hourlyRevenue < target ? 'Sotto obiettivo' : 'Obiettivo raggiunto'}</td>
            <td>{row.marginCents === null ? 'Dati da completare' : <strong>{money(row.marginCents / 100)}</strong>}{row.marginCents !== null && row.materialsToConfirm && <small> · Materiali da confermare</small>}{row.marginCents !== null && row.partsEstimated && <small> · Ricambi stimati</small>}</td>
          </tr>
        })}</tbody>
      </table>
    </div>}
  </details>
  {summaryJobId && <DeliveryMarginSummary data={data} jobId={summaryJobId} onClose={() => setSummaryJobId(null)} />}
  </>
}
