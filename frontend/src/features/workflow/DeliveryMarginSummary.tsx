import { Modal } from '../../components/Modal'
import { closedJobMargin } from '../../services/closedJobMargin'
import { reportDuration } from '../../services/deliveredJobReport'
import { normalizePlate } from '../../services/erp'
import { recordedJobVehicleCosts } from '../../services/jobMaterialCosts'
import { resolveInternalHourlyRate } from '../../services/workflow'
import type { ErpData } from '../../types'

const currency = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const romeDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
const money = (cents: number | null) => cents === null ? 'Da completare' : currency.format(cents / 100)

export function DeliveryMarginSummary({ data, jobId, vehicleId, onClose }: {
  data: ErpData
  jobId?: string
  vehicleId?: string
  onClose: () => void
}) {
  const job = data.jobs?.find(item => item.id === jobId)
  const vehicle = data.vehicles.find(item => item.id === (vehicleId ?? job?.vehicleId))
    ?? (job && !job.vehicleId ? data.vehicles.find(item => normalizePlate(item.plate) === normalizePlate(job.plate)) : undefined)
  const plate = job?.plate ?? vehicle?.plate
  const deliveredAt = job?.deliveredAt ? Date.parse(job.deliveredAt) : NaN
  const costs = job && vehicle && Number.isFinite(deliveredAt)
    ? recordedJobVehicleCosts(vehicle, job, data.jobs ?? [], romeDate.format(new Date(deliveredAt))) : undefined
  const result = job ? closedJobMargin(job, resolveInternalHourlyRate(data.plannerSettings).effectiveHourlyRate,
    data.plannerSettings.operators, costs?.materials, costs?.parts) : undefined
  const provisional = result?.materialsToConfirm || result?.partsEstimated

  return <Modal title={plate ? `Guadagno alla consegna · ${plate}` : 'Guadagno alla consegna'} onClose={onClose}>
    {job && result ? <>
      <p>{job.number} · Importi IVA esclusa</p>
      <div className="summary-grid">
        <div className="summary-card"><span>{provisional ? 'Margine provvisorio' : 'Margine a consuntivo'}</span><strong>{money(result.marginCents)}</strong></div>
        <div className="summary-card"><span>Ricavo commessa</span><strong>{money(result.revenueCents)}</strong></div>
        <div className="summary-card"><span>Manodopera e struttura</span><strong>{money(result.laborCents)}</strong></div>
        <div className="summary-card"><span>Materiali{result.materialsToConfirm ? ' da confermare' : ''}</span><strong>{money(result.materialCents)}</strong></div>
        <div className="summary-card"><span>Ricambi{result.partsEstimated ? ' da preventivo' : ''}</span><strong>{money(result.partsCents)}</strong></div>
        {result.otherDirectCents !== 0 && <div className="summary-card"><span>Altri costi diretti</span><strong>{money(result.otherDirectCents)}</strong></div>}
        {result.externalLabor.map(worker => <div className="summary-card" key={worker.name}>
          <span>{worker.name} · {reportDuration(worker.seconds)}</span><strong>{money(worker.costCents)}</strong>
        </div>)}
      </div>
      {result.laborCents === null && <p>Completa le ore lavorate e il costo orario interno per calcolare la manodopera.</p>}
      {!result.externalHoursComplete && <p>Completa le ore per operatore o la tariffa dei collaboratori esterni.</p>}
      {result.materialCents === null && <p>Registra il totale dei materiali nella scheda commessa, anche se è zero.</p>}
      {result.partsCents === null && <p>Registra il costo d’acquisto dei ricambi nella scheda vettura.</p>}
    </> : <p>Il guadagno è da calcolare. Per questa consegna manca una commessa collegata.</p>}
    <div className="form-actions"><button type="button" className="primary" onClick={onClose}>Chiudi</button></div>
  </Modal>
}
