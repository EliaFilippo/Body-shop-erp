import { useState } from 'react'
import { productionRpc } from '../../services/liveProduction'
import type { JobPhase, RepairJob } from '../../types'
import type { NoticesConnection } from './PhaseNotices'

export function OfficePhaseCompleteButton({ connection, job, phase, label = 'Completa dall’ufficio' }: {
  connection: NoticesConnection
  job: RepairJob
  phase: JobPhase
  label?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  if (done) return <small role="status">Completamento registrato.</small>
  if (phase.notRequired || phase.name === 'Consegna' || ['Completata', 'Bloccata'].includes(phase.status)) return null

  async function complete() {
    setBusy(true)
    setError('')
    try {
      await productionRpc('production_office_complete_phase', {
        p_company_id: connection.companyId, p_job_id: job.id, p_phase_id: phase.id,
      }, connection.session, connection.config)
      setDone(true)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Completamento non riuscito.')
    } finally {
      setBusy(false)
    }
  }

  return <div onClick={event => event.stopPropagation()}>
    {confirming ? <>
      <p><strong>{job.plate} · {phase.name}</strong><br />Confermando il visto fermi anche i timer ancora aperti su questa fase.</p>
      <button type="button" className="primary" disabled={busy} onClick={() => void complete()}>{busy ? 'Registrazione…' : 'Conferma completamento'}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setConfirming(false); setError('') }}>Annulla</button>
    </> : <button type="button" className="secondary" onClick={() => setConfirming(true)}>{label}</button>}
    {error && <small role="alert">{error}</small>}
  </div>
}
