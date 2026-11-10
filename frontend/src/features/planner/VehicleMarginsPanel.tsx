import { useMemo } from 'react'
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
        id: job.id, jobNumber: job.number, plate: vehicle.plate, hours, revenue: metrics.plannedRevenue,
        hourlyRevenue: hours > 0 ? metrics.plannedRevenue / hours : null,
        margin: hours > 0 && metrics.rate > 0 && metrics.plannedRevenue > 0 ? metrics.totalMargin : null,
      }]
    }).sort((a, b) => a.plate.localeCompare(b.plate, 'it') || a.jobNumber.localeCompare(b.jobNumber))
  }, [data, jobs, vehicles, plannerSettings])
  const target = monthlyTargetRate(plannerSettings, monthKey, nightlyPlanning?.economics)
  const estimated = rows.filter(row => row.margin !== null)
  const total = estimated.reduce((sum, row) => sum + (row.margin ?? 0), 0)

  return <details className="panel">
    <summary><strong>Margini stimati per vettura</strong> · {rows.length} commesse aperte</summary>
    <p>Stima del Planner sui ricavi senza IVA, sulle ore previste e sui costi configurati. La tariffa obiettivo {target.hourlyRate === null ? 'è da configurare' : `è ${money(target.hourlyRate)}/h`} e serve per confrontare il ricavo orario.</p>
    {estimated.length > 0 && <p>Margine stimato complessivo su {estimated.length} commesse con dati disponibili · <strong>{money(total)}</strong></p>}
    {rows.length === 0 ? <p>Nessuna commessa aperta.</p> : <div style={{ overflowX: 'auto' }}>
      <table aria-label="Margini stimati delle commesse aperte">
        <thead><tr><th scope="col">Targa</th><th scope="col">Commessa</th><th scope="col">Ricavo senza IVA</th><th scope="col">Ore previste</th><th scope="col">Ricavo orario</th><th scope="col">Rispetto all’obiettivo</th><th scope="col">Margine stimato</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <th scope="row">{row.plate}</th><td>{row.jobNumber}</td><td>{money(row.revenue)}</td>
          <td>{row.hours > 0 ? number(row.hours) : '—'}</td>
          <td>{row.hourlyRevenue === null ? '—' : `${money(row.hourlyRevenue)}/h`}</td>
          <td>{row.hourlyRevenue === null || target.hourlyRate === null ? '—' : row.hourlyRevenue < target.hourlyRate ? 'Sotto obiettivo' : 'Obiettivo raggiunto'}</td>
          <td>{row.margin === null ? 'Dati da completare' : <strong>{money(row.margin)}</strong>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </details>
}
