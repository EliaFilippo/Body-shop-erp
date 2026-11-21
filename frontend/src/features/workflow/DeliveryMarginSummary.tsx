import { vehicleOperatingProfit } from '../../services/vehicleOperatingProfit'
import { marginTargetRate } from '../../services/marginTargetRate'
import { HourlyRevenueComparison } from '../vehicles/HourlyRevenueComparison'
import { finalizedJobCosts } from '../../services/finalizedJobCosts'
import { Modal } from '../../components/Modal'
import { closedJobMargin, jobOtherDirectCost } from '../../services/closedJobMargin'
import { reportDuration } from '../../services/deliveredJobReport'
import { normalizePlate } from '../../services/erp'
import { phaseDisplayName } from '../../services/workCycle'
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
  const closure = job ? finalizedJobCosts(job, vehicle, data.jobs ?? [], data.plannerSettings) : undefined
  const accounting = job && vehicle ? vehicleOperatingProfit(vehicle, job, data.jobs ?? [], data.plannerSettings) : undefined
  const result = accounting ?? (job ? closedJobMargin(job, data.plannerSettings.operators, undefined, undefined, closure?.finalized) : undefined)
  const otherCost = accounting ? accounting.otherCents : job ? jobOtherDirectCost(job, undefined, closure?.finalized ?? false).cents : null
  const contribution = accounting ? accounting.contributionCents
    : result?.marginCents == null || otherCost === null ? null : result.marginCents - otherCost
  const provisional = result && (contribution === null || result.materialsToConfirm || result.partsEstimated)

  return <>
    {job && result ? <>
      <p>{job.number} · Importi IVA esclusa</p>
      <div className="summary-grid">
        <div className="summary-card"><span>{provisional ? 'Margine provvisorio' : 'Margine a consuntivo'}</span><strong>{money(contribution ?? null)}</strong></div>
        <div className="summary-card"><span>Importo concordato</span><strong>{money(result.revenueCents)}</strong></div>
        <div className="summary-card"><span>{result.laborComplete ? 'Costo operatori' : 'Costo operatori registrato'}</span><strong>{money(result.laborCents)}</strong></div>
        <div className="summary-card"><span>Materiali{result.materialsToConfirm ? ' da confermare' : ''}</span><strong>{money(result.materialCents)}</strong></div>
        <div className="summary-card"><span>{result.partsCents === null ? 'Ricambi · costo parziale' : result.partsEstimated ? 'Ricambi da preventivo' : 'Ricambi'}</span><strong>{money(result.partsCents)}</strong></div>
        <div className="summary-card"><span>Altri costi diretti</span><strong>{money(otherCost ?? null)}</strong></div>
        {result.operatorLabor.map(worker => <div className="summary-card" key={worker.id}>
          <span>{worker.name} · {reportDuration(worker.seconds)}</span><strong>{money(worker.costCents)}</strong>
        </div>)}
      </div>
      <HourlyRevenueComparison net revenue={contribution === null || contribution === undefined ? NaN : contribution / 100} seconds={result.workedSeconds} target={marginTargetRate(data,romeDate.format(new Date()).slice(0,7))?.marginHourlyRate??null}/>
      <p>Le spese generali sono comprese nell’obiettivo: il margine sottrae una sola volta i costi diretti e la manodopera registrata.</p>
      {result.phasesWithoutTime.length > 0 && <p>Ore mancanti o parziali per {result.phasesWithoutTime.map(phaseDisplayName).join(', ')}.</p>}
      {!result.laborComplete && <p>Il costo operatori include le ore attribuite a operatori con tariffa disponibile.</p>}
      {result.materialCents === null && <p>Registra il totale dei materiali nella scheda commessa, anche se è zero.</p>}
      {(result.partsCents === null || result.partsEstimated) && <p>Registra il costo d’acquisto dei ricambi nella scheda vettura.</p>}
    </> : <p>Il guadagno è da calcolare. Per questa consegna manca una commessa collegata.</p>}
  </>
}
