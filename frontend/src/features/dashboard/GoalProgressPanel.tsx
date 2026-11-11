import { useEffect, useMemo, useState } from 'react'
import { CapacityBar } from '../../components/CapacityBar'
import { marginTargetRate } from '../../services/marginTargetRate'
import { MarginTargetRatePanel } from './MarginTargetRatePanel'
import { calculateGoalProgress } from '../../services/goalProgress'
import type { VehicleWork } from '../../services/productionPlanningState'
import type { ErpData } from '../../types'

const money = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const hours = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 })
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })

export function GoalProgressPanel({ data, vehicleWork }: { data: ErpData; vehicleWork?: VehicleWork[] }) {
  const [today, setToday] = useState(() => date.format(new Date()))
  useEffect(() => {
    const timer = setInterval(() => setToday(date.format(new Date())), 30_000)
    return () => clearInterval(timer)
  }, [])
  const periods = useMemo(() => calculateGoalProgress(data, today, vehicleWork), [data, today, vehicleWork])

  const target = useMemo(() => marginTargetRate(data, today.slice(0, 7), today, periods[2]), [data, today, periods])

  return <>
  <section className="panel" aria-label="Avanzamento obiettivi di margine">
    <div className="panel-head"><div><span className="eyebrow">MARGINE · IVA ESCLUSA</span><h3>Avanzamento obiettivi</h3></div></div>
    <div className="owner-kpi-grid">
      {periods.map(period => <article className="owner-kpi-card" key={period.label}>
        <span>{period.label}</span>
        <strong>{period.hasMargin ? money.format(period.done) : '—'}</strong>
        {period.incomplete ? <small>Margine parziale · Dati da completare</small> : period.provisional && <small>Margine provvisorio</small>}
        <small>{period.goal > 0 ? `Obiettivo di margine · ${money.format(period.goal)}` : 'Obiettivo di margine da impostare'}</small>
        {period.percent !== null && <><CapacityBar kind="goal" percent={period.percent} /><small>Mancano {money.format(period.gap)}</small></>}
        <small>Costo Federica fuori vettura · {period.offVehicleTimeIncomplete ? 'Ore sulle vetture da sincronizzare'
          : period.offVehicleCostIncomplete ? 'Tariffa da configurare'
            : `${hours.format(period.offVehicleHours)} h · ${money.format(period.offVehicleCost)}`}</small>
        <small>Fatturato registrato · {money.format(period.billed)}</small>
      </article>)}
    </div>
    <p>Il margine delle fasi completate sottrae il costo delle ore di ciascun operatore, i materiali di consumo e i ricambi. Si attribuisce alla data di completamento della fase e si conguaglia alla consegna. Il totale include le commesse in perdita e il costo delle ore di Federica fuori vettura, calcolate sommando le 4 ore di ufficio e le ore di produzione rimaste fuori vettura. I materiali restano stimati fino alla conferma del costo effettivo.</p>
  </section>
  {target && <MarginTargetRatePanel target={target} />}
  </>
}
