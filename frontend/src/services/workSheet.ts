import { cyclePhasesForLine } from './workCycle'
import type { ErpData, RepairJob } from '../types'

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character] ?? character))
const displayDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value

export function buildWorkSheetHtml(data: ErpData, job: RepairJob) {
  const vehicle = data.vehicles.find(item => item.id === job.vehicleId)
  const estimate = data.estimates?.find(item => item.id === job.estimateId)
  const vehicleDetails = [vehicle?.make, vehicle?.model, vehicle?.color].filter(Boolean).join(' · ')
  const hasPaintingPhase = job.phases.some(phase => phase.name === 'Verniciatura' && !phase.notRequired)
  const rows = job.lines.map(line => {
    const wholeVehicleLabel = /vettura intera\s*\/\s*interni/i
    const panel = line.panelId === 'vettura-intera' || wholeVehicleLabel.test(line.panelName ?? '')
      ? '' : line.panelName?.trim()
    const cleanDescription = (value: string) => value
      .replace(/\s*\((?:lieve|grave)\)/gi, '')
      .split('·').map(part => part.trim())
      .filter(part => part && !/^(?:materiali inclusi|vettura intera\s*\/\s*interni)$/i.test(part))
      .join(' · ')
    const description = cleanDescription(line.description) || cleanDescription(line.standardWorkName ?? '') || panel || 'Lavorazione'
    const work = panel && !line.manualFastLine && !description.toLowerCase().includes(panel.toLowerCase())
      ? `${panel} · ${description}` : description
    const painting = panel && !line.manualFastLine && hasPaintingPhase && cyclePhasesForLine(line).includes('Verniciatura')
    const detail = description.toLowerCase() === panel?.toLowerCase() || /^verniciatura$/i.test(description)
      ? '' : description
    const printedWork = painting
      ? `<strong>Verniciatura · ${escapeHtml(panel)}</strong>${detail ? `<br>${escapeHtml(detail)}` : ''}`
      : escapeHtml(work)
    return `<tr>
      <td class="check"><span aria-label="Da spuntare"></span></td>
      <td>${printedWork}${line.quantity > 1 ? ` <small>Quantità ${escapeHtml(line.quantity)}</small>` : ''}
        ${line.panelWorkNote?.trim() ? `<small>Nota operativa · ${escapeHtml(line.panelWorkNote)}</small>` : ''}</td>
    </tr>`
  }).join('')
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Scheda lavori · ${escapeHtml(job.plate)}</title>
<style>
  @page { size: A4 portrait; margin: 8mm }
  body { font: 14pt/1.35 Arial, sans-serif; color: #111; margin: 0 }
  h1 { margin: 0 0 4mm; font-size: 22pt }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm }
  header p { margin: 2mm 0 }
  .cone { flex: none; min-width: 36mm; padding: 2mm 4mm; border: 2px solid #111; text-align: center; line-height: 1 }
  .cone-label { display: block; font-size: 18pt; font-weight: bold }
  .cone-number { display: block; font-size: 60pt; font-weight: bold }
  table { width: 100%; border-collapse: collapse; margin: 6mm 0; table-layout: fixed }
  th, td { border: 1px solid #888; padding: 2.5mm; text-align: left; vertical-align: top; overflow-wrap: anywhere }
  th { background: #eee; font-size: 10pt }
  thead { display: table-header-group }
  tr { break-inside: avoid }
  small { display: block; margin-top: 1mm; white-space: pre-wrap }
  .check { width: 10mm; text-align: center }
  .check span { display: inline-block; width: 4mm; height: 4mm; border: 1px solid #111 }
  .notes { break-inside: avoid; margin-top: 7mm }
  .line { min-height: 8mm; border-bottom: 1px solid #999 }
  @media print {
    body { min-height: 278mm; display: flex; flex-direction: column }
    header, table, .notes { flex-shrink: 0 }
    .notes { flex-grow: 1; display: flex; flex-direction: column }
    .line { flex-grow: 1 }
  }
  @media screen { body { max-width: 185mm; margin: 14mm auto; padding: 0 4mm } }
</style></head><body>
<header>
 <div>
  <h1>Scheda lavori</h1>
  <p><strong>Targa ${escapeHtml(job.plate)}</strong>${vehicleDetails ? ` · ${escapeHtml(vehicleDetails)}` : ''}</p>
  <p>Commessa ${escapeHtml(job.number)}${estimate ? ` · Preventivo ${escapeHtml(estimate.number)}` : ''}</p>
  ${job.expectedDeliveryDate ? `<p>Consegna prevista ${escapeHtml(displayDate(job.expectedDeliveryDate))}</p>` : ''}
 </div>
 ${job.coneNumber ? `<div class="cone"><span class="cone-label">CONO</span><strong class="cone-number">${escapeHtml(job.coneNumber)}</strong></div>` : ''}
</header>
<table><thead><tr><th class="check">Fatto</th><th>Lavorazione</th></tr></thead>
<tbody>${rows || '<tr><td colspan="2">Nessuna lavorazione indicata nella commessa.</td></tr>'}</tbody></table>
<section class="notes"><strong>Note degli operatori</strong><div class="line"></div><div class="line"></div></section>
</body></html>`
}

export function printWorkSheet(data: ErpData, job: RepairJob) {
  const html = buildWorkSheetHtml(data, job)
  const preview = window.open('about:blank', '_blank')
  if (!preview) throw new Error('Consenti le finestre popup per stampare la scheda lavori.')
  preview.opener = null
  preview.document.open()
  preview.document.write(html)
  preview.document.close()
  preview.focus()
  preview.print()
}
