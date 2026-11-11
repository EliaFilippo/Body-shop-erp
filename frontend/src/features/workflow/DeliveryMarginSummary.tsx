import { Modal } from '../../components/Modal'
import { closedJobMargin } from '../../services/closedJobMargin'
import { reportDuration } from '../../services/deliveredJobReport'
import { normalizePlate } from '../../services/erp'
import { recordedJobVehicleCosts } from '../../services/jobMaterialCosts'
import { isVehicleDeliveredStatus } from '../../services/vehicleStatuses'
import type { ErpData, RepairJob, Vehicle } from '../../types'

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
  return <Modal title={plate ? `Guadagno alla consegna · ${plate}` : 'Guadagno alla consegna'} onClose={onClose}>
    <DeliveryMarginDetails data={data} job={job} vehicle={vehicle} />
    <div className="form-actions"><button type="button" className="primary" onClick={onClose}>Chiudi</button></div>
  </Modal>
}

export function DeliveryMarginDetails({ data, job, vehicle }: { data: ErpData; job?: RepairJob; vehicle?: Vehicle }) {
  const vehicleDelivery = vehicle && isVehicleDeliveredStatus(data.plannerSettings, vehicle.status) ? vehicle.deliveredAt : undefined
  const deliveredAt = Date.parse(job?.deliveredAt ?? vehicleDelivery ?? '')
  const costs = job && vehicle && Number.isFinite(deliveredAt)
    ? recordedJobVehicleCosts(vehicle, job, data.jobs ?? [], romeDate.format(new Date(deliveredAt))) : undefined
  const result = job ? closedJobMargin(job, data.plannerSettings.operators, costs?.materials, costs?.parts) : undefined
  const provisional = result?.materialsToConfirm || result?.partsEstimated

  return <>
    {job && result ? <>
      <p>{job.number} · Importi IVA esclusa</p>
      <div className="summary-grid">
        <div className="summary-card"><span>{provisional ? 'Margine provvisorio' : 'Margine a consuntivo'}</span><strong>{money(result.marginCents)}</strong></div>
        <div className="summary-card"><span>Importo concordato</span><strong>{money(result.revenueCents)}</strong></div>
        <div className="summary-card"><span>Costo operatori</span><strong>{money(result.laborCents)}</strong></div>
        <div className="summary-card"><span>Materiali{result.materialsToConfirm ? ' da confermare' : ''}</span><strong>{money(result.materialCents)}</strong></div>
        <div className="summary-card"><span>Ricambi{result.partsEstimated ? ' da preventivo' : ''}</span><strong>{money(result.partsCents)}</strong></div>
        {result.operatorLabor.map(worker => <div className="summary-card" key={worker.id}>
          <span>{worker.name} · {reportDuration(worker.seconds)}</span><strong>{money(worker.costCents)}</strong>
        </div>)}
      </div>
      {result.laborCents === null && <p>Completa le ore registrate e le tariffe dei singoli operatori.</p>}
      {result.materialCents === null && <p>Registra il totale dei materiali nella scheda commessa, anche se è zero.</p>}
      {result.partsCents === null && <p>Registra il costo d’acquisto dei ricambi nella scheda vettura.</p>}
    </> : <p>Il guadagno è da calcolare. Per questa consegna manca una commessa collegata.</p>}
  </>
}
