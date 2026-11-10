import { useMemo } from 'react'
import { closedJobMargin } from '../../services/closedJobMargin'
import { reportDuration } from '../../services/deliveredJobReport'
import { resolveInternalHourlyRate } from '../../services/workflow'
import { closedPlanningWork } from '../../services/closedPlanningWork'
import { normalizePlate } from '../../services/erp'
import { monthlyTargetRate } from '../../services/monthlyTargetRate'
import { marginMetrics } from '../../services/planner'
import type { ErpData } from '../../types'

const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const number = (value: number) => value.toLocaleString('it-IT', { maximumFractionDigits: 2 })

export function VehicleMarginsPanel({ data, monthKey }: { data: ErpData; monthKey: string }) {
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
  const target = monthlyTargetRate(plannerSettings, monthKey, nightlyPlanning?.economics)
  const estimated = rows.filter(row => row.margin !== null)
  const total = estimated.reduce((sum, row) => sum + (row.margin ?? 0), 0)

  return <>
  <details className="panel">
    <summary><strong>Margini stimati per vettura</strong> · {rows.length} commesse aperte</summary>
    <p>Stima del Planner sui ricavi senza IVA, sulle ore previste e sui costi configurati. La tariffa obiettivo {target.hourlyRate === null ? 'è da configurare' : `è ${money(target.hourlyRate)}/h`} e serve per confrontare il ricavo orario.</p>
    {estimated.length > 0 && <p>Margine stimato complessivo su {estimated.length} commesse con dati disponibili · <strong>{money(total)}</strong></p>}
    {rows.length === 0 ? <p>Nessuna commessa aperta.</p> : <div style={{ overflowX: 'auto' }}>
      <table aria-label="Margini stimati delle commesse aperte">
        <thead><tr><th scope="col">Targa</th><th scope="col">Cono</th><th scope="col">Commessa</th><th scope="col">Ricavo senza IVA</th><th scope="col">Ore previste</th><th scope="col">Ricavo orario</th><th scope="col">Rispetto all’obiettivo</th><th scope="col">Margine stimato</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <th scope="row">{row.plate}</th><td>{row.cone ?? '—'}</td><td>{row.jobNumber}</td><td>{money(row.revenue)}</td>
          <td>{row.hours > 0 ? number(row.hours) : '—'}</td>
          <td>{row.hourlyRevenue === null ? '—' : `${money(row.hourlyRevenue)}/h`}</td>
          <td>{row.hourlyRevenue === null || target.hourlyRate === null ? '—' : row.hourlyRevenue < target.hourlyRate ? 'Sotto obiettivo' : 'Obiettivo raggiunto'}</td>
          <td>{row.margin === null ? 'Dati da completare' : <strong>{money(row.margin)}</strong>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </details>
  <ClosedJobMargins data={data} monthKey={monthKey} />
  </>
}

function ClosedJobMargins({ data, monthKey }: { data: ErpData; monthKey: string }) {
  const { jobs, plannerSettings, nightlyPlanning, coneHistory } = data
  const hourlyCost = resolveInternalHourlyRate(plannerSettings).effectiveHourlyRate
  const rows = useMemo(() => (jobs ?? [])
    .filter(job => job.status === 'Consegnata')
    .map(job => ({ job, ...closedJobMargin(job, hourlyCost) }))
    .sort((a, b) => (b.job.deliveredAt ?? b.job.updatedAt).localeCompare(a.job.deliveredAt ?? a.job.updatedAt)),
  [jobs, hourlyCost])
  const calculated = rows.filter(row => row.marginCents !== null)
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

  return <details className="panel">
    <summary><strong>Margini a consuntivo per vettura</strong> · {rows.length} commesse consegnate</summary>
    <p>Importi IVA esclusa. Il margine usa l’importo concordato in commessa, i materiali registrati a consuntivo, i costi diretti da commessa e le ore lavorate valorizzate al costo orario interno del gestionale.</p>
    {calculated.length > 0 && <p>Margine complessivo su {calculated.length} commesse con dati completi · <strong>{money(totalCents / 100)}</strong></p>}
    {rows.length === 0 ? <p>Nessuna commessa consegnata.</p> : <div style={{ overflowX: 'auto' }}>
      <table aria-label="Margini a consuntivo delle commesse consegnate">
        <thead><tr><th scope="col">Targa</th><th scope="col">Cono</th><th scope="col">Commessa</th><th scope="col">Ricavo senza IVA</th><th scope="col">Ore lavorate</th><th scope="col">Ricavo orario</th><th scope="col">Rispetto all’obiettivo</th><th scope="col">Margine a consuntivo</th></tr></thead>
        <tbody>{rows.map(row => {
          const deliveryMonth = row.job.deliveredAt?.slice(0, 7) ?? monthKey
          if (!targets.has(deliveryMonth)) {
            targets.set(deliveryMonth, monthlyTargetRate(plannerSettings, deliveryMonth, nightlyPlanning?.economics).hourlyRate)
          }
          const target = targets.get(deliveryMonth) ?? null
          const { job } = row
          const deliveredAt = job.deliveredAt
          const cone = deliveredAt && job.vehicleId
            ? coneAssignments.get(job.vehicleId)?.find(event => event.timestamp <= deliveredAt && event.timestamp >= job.entryDate)?.coneNumber
            : undefined
          return <tr key={job.id}>
            <th scope="row">{job.plate}</th><td>{cone ?? '—'}</td><td>{job.number}</td>
            <td>{row.revenueCents === null ? '—' : money(row.revenueCents / 100)}</td>
            <td>{row.complete ? reportDuration(row.workedSeconds) : row.workedSeconds > 0 ? `${reportDuration(row.workedSeconds)} (parziale)` : 'Da registrare'}</td>
            <td>{row.hourlyRevenue === null ? '—' : `${money(row.hourlyRevenue)}/h`}</td>
            <td>{row.hourlyRevenue === null || target === null ? '—' : row.hourlyRevenue < target ? 'Sotto obiettivo' : 'Obiettivo raggiunto'}</td>
            <td>{row.marginCents === null ? 'Dati da completare' : <strong>{money(row.marginCents / 100)}</strong>}</td>
          </tr>
        })}</tbody>
      </table>
    </div>}
  </details>
}
