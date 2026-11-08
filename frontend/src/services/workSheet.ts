import type { ErpData, RepairJob } from '../types'

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character] ?? character))
const displayDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value

export function buildWorkSheetHtml(data: ErpData, job: RepairJob) {
  const vehicle = data.vehicles.find(item => item.id === job.vehicleId)
  const estimate = data.estimates?.find(item => item.id === job.estimateId)
  const vehicleDetails = [vehicle?.make, vehicle?.model, vehicle?.color].filter(Boolean).join(' · ')
  const rows = job.lines.map(line => {
    const panel = line.panelName?.trim()
    const description = line.description.trim() || line.standardWorkName?.trim() || 'Lavorazione'
    return `<tr>
      <td class="check"><span aria-label="Da spuntare"></span></td>
      <td><strong>${escapeHtml(panel || 'Altra lavorazione')}</strong>${line.damageSeverity ? `<small>Danno ${escapeHtml(line.damageSeverity)}</small>` : ''}</td>
      <td>${escapeHtml(description)}${line.quantity > 1 ? ` <small>Quantità ${escapeHtml(line.quantity)}</small>` : ''}
        ${line.panelWorkNote?.trim() ? `<small>Nota operativa · ${escapeHtml(line.panelWorkNote)}</small>` : ''}</td>
    </tr>`
  }).join('')
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Scheda lavori · ${escapeHtml(job.plate)}</title>
<style>
  @page { size: A4; margin: 14mm }
  body { font: 12pt/1.35 Arial, sans-serif; color: #111; margin: 0 }
  h1 { margin: 0 0 4mm; font-size: 22pt }
  header p { margin: 2mm 0 }
  table { width: 100%; border-collapse: collapse; margin: 6mm 0; table-layout: fixed }
  th, td { border: 1px solid #888; padding: 2.5mm; text-align: left; vertical-align: top; overflow-wrap: anywhere }
  th { background: #eee; font-size: 10pt }
  thead { display: table-header-group }
  tr { break-inside: avoid }
  small { display: block; margin-top: 1mm; white-space: pre-wrap }
  .check { width: 10mm; text-align: center }
  .check span { display: inline-block; width: 4mm; height: 4mm; border: 1px solid #111 }
  .panel-name { width: 48mm }
  .notes { break-inside: avoid; margin-top: 7mm }
  .line { min-height: 8mm; border-bottom: 1px solid #999 }
  @media screen { body { max-width: 185mm; margin: 14mm auto; padding: 0 4mm } }
</style></head><body>
<header>
  <h1>Scheda lavori</h1>
  <p><strong>Targa ${escapeHtml(job.plate)}</strong>${vehicleDetails ? ` · ${escapeHtml(vehicleDetails)}` : ''}</p>
  <p>Commessa ${escapeHtml(job.number)}${estimate ? ` · Preventivo ${escapeHtml(estimate.number)}` : ''}${job.coneNumber ? ` · Cono ${escapeHtml(job.coneNumber)}` : ''}</p>
  ${job.expectedDeliveryDate ? `<p>Consegna prevista ${escapeHtml(displayDate(job.expectedDeliveryDate))}</p>` : ''}
</header>
<table><thead><tr><th class="check">Fatto</th><th class="panel-name">Pannello</th><th>Lavorazione</th></tr></thead>
<tbody>${rows || '<tr><td colspan="3">Nessuna lavorazione indicata nella commessa.</td></tr>'}</tbody></table>
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
