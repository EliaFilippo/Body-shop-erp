import { calculateEconomicGoalSnapshot } from '../../services/economic'
import type { ErpData } from '../../types'
import { CapacityBar } from '../../components/CapacityBar'

const euro = (value: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)

export function EconomicGoalPanel({ data }: { data: ErpData }) {
  const snapshot = calculateEconomicGoalSnapshot(data)
  return <section className="panel economic-panel">
    <div className="panel-head"><div><span className="eyebrow">OBIETTIVO DEL MESE</span><h3>{euro(snapshot.appliedRevenueGoal)}</h3></div><b className={snapshot.status === 'ok' ? 'goal-ok' : snapshot.status === 'warning' ? 'goal-gap' : 'goal-critical'}>{snapshot.status === 'ok' ? 'In linea' : snapshot.status === 'warning' ? 'Attenzione' : 'In ritardo'}</b></div>
    <CapacityBar percent={snapshot.progressPercent} />
    <div className="economic-grid">
      <div><span>Obiettivo suggerito</span><strong>{euro(snapshot.suggestedRevenueGoal)}</strong></div>
      <div><span>Fatturato realizzato</span><strong>{euro(snapshot.revenueRealized)}</strong></div>
      <div><span>Fabbisogno residuo</span><strong>{euro(snapshot.residualNeed)}</strong></div>
      <div><span>Costi totali del periodo</span><strong>{euro(snapshot.totalCosts)}</strong></div>
      <div><span>Media giornaliera necessaria</span><strong>{euro(snapshot.dailyRevenueNeed)}</strong></div>
      <div><span>Media settimanale necessaria</span><strong>{euro(snapshot.weeklyRevenueNeed)}</strong></div>
    </div>
    <div className="goal-chart goal-chart-compact">
      {snapshot.chart.slice(-8).map((point) => {
        const actualHeight = snapshot.appliedRevenueGoal ? Math.max(6, Math.min(100, (point.actualRevenue / snapshot.appliedRevenueGoal) * 100)) : 0
        const targetHeight = snapshot.appliedRevenueGoal ? Math.max(6, Math.min(100, (point.targetRevenue / snapshot.appliedRevenueGoal) * 100)) : 0
        return <div className="goal-chart-bar" key={point.date}><div className="goal-chart-track"><i className="actual" style={{ height: `${actualHeight}%` }} /><i className="target" style={{ height: `${targetHeight}%` }} /></div><small>{point.label}</small></div>
      })}
    </div>
  </section>
}
