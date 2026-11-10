import { useEffect, useMemo, useState } from 'react'
import { CapacityBar } from '../../components/CapacityBar'
import { calculateGoalProgress } from '../../services/goalProgress'
import type { ErpData } from '../../types'

const money = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })

export function GoalProgressPanel({ data }: { data: ErpData }) {
  const [today, setToday] = useState(() => date.format(new Date()))
  useEffect(() => {
    const timer = setInterval(() => setToday(date.format(new Date())), 30_000)
    return () => clearInterval(timer)
  }, [])
  const periods = useMemo(() => calculateGoalProgress(data, today), [data, today])

  return <section className="panel" aria-label="Avanzamento obiettivi di produzione">
    <div className="panel-head"><div><span className="eyebrow">PRODUZIONE · IVA ESCLUSA</span><h3>Avanzamento obiettivi</h3></div></div>
    <div className="owner-kpi-grid">
      {periods.map(period => <article className="owner-kpi-card" key={period.label}>
        <span>{period.label}</span>
        <strong>{money.format(period.done)} prodotti</strong>
        <small>Obiettivo · {period.goal > 0 ? money.format(period.goal) : 'Nessun importo previsto'}</small>
        {period.percent !== null && <><CapacityBar kind="goal" percent={period.percent} /><small>Mancano {money.format(period.gap)}</small></>}
        <small>Fatturato registrato · {money.format(period.billed)}</small>
      </article>)}
    </div>
    <p>Il valore prodotto è una stima per fasi completate, ripartita secondo i tempi previsti. Alla consegna si aggiunge solo il valore ancora da conteggiare. Il fatturato è mostrato a parte.</p>
  </section>
}
