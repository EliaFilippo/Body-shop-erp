import { calculateEconomicSummary } from '../../services/economic'
import type { ErpData } from '../../types'
import { CapacityBar } from '../../components/CapacityBar'

const euro = (value: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)

export function EconomicGoalPanel({ data }: { data: ErpData }) {
  const summary = calculateEconomicSummary(data.vehicles, data.plannerSettings)
  return <section className="panel economic-panel">
    <div className="panel-head"><div><span className="eyebrow">OBIETTIVO DEL MESE</span><h3>{euro(summary.goal)}</h3></div><b className={summary.sufficient ? 'goal-ok' : 'goal-gap'}>{summary.sufficient ? 'Carico sufficiente' : 'Carico insufficiente'}</b></div>
    <CapacityBar percent={summary.reachedPercent} />
    <div className="economic-grid">
      <div><span>Fatturato programmato</span><strong>{euro(summary.plannedRevenue)}</strong></div>
      <div><span>Margine programmato</span><strong>{euro(summary.plannedMargin)}</strong></div>
      <div><span>Importo mancante</span><strong>{euro(summary.missingRevenue)}</strong></div>
      <div><span>Giorni lavorativi residui</span><strong>{summary.remainingWorkingDays}</strong></div>
      <div><span>Media giornaliera necessaria</span><strong>{euro(summary.dailyRevenueNeeded)}</strong></div>
      <div><span>Ore produttive necessarie</span><strong>{summary.productiveHoursNeeded === null ? 'Non calcolabile' : `${summary.productiveHoursNeeded} h`}</strong></div>
    </div>
  </section>
}
