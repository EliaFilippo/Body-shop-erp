import { useId, useState } from 'react'
import type { AcceptanceQuote, EstimateLine, MinorDamagePreset, PlannerSettings } from '../../types'
import { MoneyInput } from '../../components/MoneyInput'
import { buildAcceptanceQuoteSummary, updateConsumptionLine } from '../../services/acceptance'
import { damageQuoteError, makeDamageLine, makeMinorDamagePreset, minorDamageLines, recalculateDamageLine } from '../../services/damageQuote'
import { PANEL_CATALOG, type VehicleViewId } from './vehiclePanels'

const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const duration = (minutes: number) => `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`
const views: Array<{ id: VehicleViewId; label: string }> = [{ id: 'left', label: 'Sinistra' }, { id: 'right', label: 'Destra' }, { id: 'top', label: 'Alto' }]

export function DamageQuoteEditor({ settings, quote, onChange, onSavePreset }: {
  settings: PlannerSettings
  quote: AcceptanceQuote
  onChange: (quote: AcceptanceQuote) => void
  onSavePreset?: (preset: MinorDamagePreset) => void
}) {
  const [view, setView] = useState<VehicleViewId>('left')
  const [activeId, setActiveId] = useState('')
  const [severity, setSeverity] = useState<'lieve' | 'grave'>('lieve')
  const [notice, setNotice] = useState('')
  const gradientId = useId().replace(/:/g, '')
  const lines = quote.damageLines ?? []
  const active = PANEL_CATALOG.find((panel) => panel.id === activeId)
  const selected = lines.filter((line) => line.panelId === activeId)
  const works = (settings.standardWorks ?? []).filter((work) => work.active).sort((a, b) => a.cycleOrder - b.cycleOrder)
  const summary = buildAcceptanceQuoteSummary(quote)
  const error = damageQuoteError(lines)

  const commit = (nextLines: EstimateLine[], rate = quote.hourlyRate) => {
    onChange(updateConsumptionLine({ ...quote, hourlyRate: rate, damageLines: nextLines }, quote.materialPercent / 100))
    setNotice('')
  }
  const selectPanel = (panelId: string) => {
    setActiveId(panelId)
    setNotice('')
    const existing = lines.filter((line) => line.panelId === panelId)
    setSeverity(existing[0]?.damageSeverity ?? 'lieve')
    if (existing.length) return
    const panel = PANEL_CATALOG.find((item) => item.id === panelId)!
    const automatic = minorDamageLines(settings, panel, quote.appliedVatRate)
    if (automatic.length) commit([...lines, ...automatic])
  }
  const changeSeverity = (next: 'lieve' | 'grave') => {
    if (!active || next === severity) return
    setSeverity(next)
    // Il passaggio di gravità conserva le lavorazioni e i tempi già inseriti.
    commit(lines.map((line) => line.panelId !== activeId ? line : recalculateDamageLine({ ...line,
      damageSeverity: next, unitPrice: next === 'grave' ? (line.estimatedMinutes ?? 0) / 60 * quote.hourlyRate : line.unitPrice,
    }, settings)))
  }
  const changeMinutes = (line: EstimateLine, hours: number) => {
    const minutes = Math.round(Math.max(0, hours) * 60)
    commit(lines.map((item) => item.id !== line.id ? item : recalculateDamageLine({ ...item, estimatedMinutes: minutes,
      unitPrice: item.damageSeverity === 'grave' ? minutes / 60 * quote.hourlyRate : item.unitPrice,
    }, settings)))
  }
  const changeRate = (rate: number) => commit(lines.map((line) => line.damageSeverity !== 'grave' ? line
    : recalculateDamageLine({ ...line, unitPrice: (line.estimatedMinutes ?? 0) / 60 * rate }, settings)), rate)

  return <section className="damage-quote" aria-label="Preventivo grafico">
    <div className="panel-head"><div><span className="eyebrow">PREVENTIVO RAPIDO</span><h3>Tocca la parte danneggiata</h3><p>Danno lieve: tempi e prezzi memorizzati. Danno grave: ore manuali e prezzo dalla tariffa di vendita.</p></div></div>
    <div className="damage-quote-layout">
      <div className="damage-car-column">
        <div className="damage-views" role="group" aria-label="Vista vettura">{views.map((item) => <button type="button" key={item.id} aria-pressed={view === item.id} className={view === item.id ? 'primary' : 'secondary'} onClick={() => setView(item.id)}>{item.label}</button>)}</div>
        <svg className={`damage-car view-${view}`} viewBox={view === 'top' ? '22 0 56 80' : '5 20 90 51'} aria-label={`Vettura vista ${views.find((item) => item.id === view)?.label.toLowerCase()}`}>
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#929da9" /><stop offset=".45" stopColor="#394452" /><stop offset="1" stopColor="#18222c" /></linearGradient></defs>
          {view === 'top' ? <>
            <path fill={`url(#${gradientId})`} stroke="#9aa6b4" strokeWidth=".65" d="M30 6 Q50 1 70 6 L75 15 L72 67 L62 76 Q50 79 38 76 L28 67 L25 15 Z" />
            <path className="damage-glass" d="M36 24 Q50 20 64 24 L62 48 Q50 53 38 48 Z" />
            <text x="50" y="79" textAnchor="middle" className="damage-front">ANTERIORE</text>
          </> : <>
            <path fill={`url(#${gradientId})`} stroke="#9aa6b4" strokeWidth=".65" d="M7 54 L10 47 Q13 38 20 33 L30 26 L42 24 L60 24 L71 26 L82 33 Q88 37 91 45 L93 52 L90 58 Q88 62 82 63 L16 63 Q10 62 8 58 Z" />
            <path className="damage-glass" d="M33 29 L44 27 L60 27 L70 29 L76 34 L63 34 L42 34 L34 33 Z" />
            <circle className="damage-wheel" cx="28" cy="61" r="6" /><circle className="damage-wheel" cx="72" cy="61" r="6" />
            <text x={view === 'left' ? '12' : '88'} y="69" textAnchor="middle" className="damage-front">ANTERIORE</text>
          </>}
          {PANEL_CATALOG.filter((panel) => panel.view === view).map((panel) => {
            const configured = lines.some((line) => line.panelId === panel.id)
            const grave = lines.some((line) => line.panelId === panel.id && line.damageSeverity === 'grave')
            return <path key={panel.id} d={panel.path} role="button" tabIndex={0} aria-label={panel.name} aria-pressed={activeId === panel.id}
              className={`damage-panel ${configured ? 'configured' : ''} ${grave ? 'grave' : ''} ${activeId === panel.id ? 'active' : ''}`}
              onClick={() => selectPanel(panel.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPanel(panel.id) } }}><title>{panel.name}</title></path>
          })}
        </svg>
        <p className="damage-legend">Verde: danno lieve · Rosso: danno grave · Bordo oro: pannello aperto</p>
        <div className="damage-selected">{PANEL_CATALOG.filter((panel) => lines.some((line) => line.panelId === panel.id)).map((panel) => <button type="button" className={activeId === panel.id ? 'primary' : 'secondary'} key={panel.id} onClick={() => { setView(panel.view); selectPanel(panel.id) }}>{panel.name} · {duration(lines.filter((line) => line.panelId === panel.id).reduce((sum, line) => sum + (line.estimatedMinutes ?? 0), 0))}</button>)}</div>
      </div>
      <div className="damage-controls">
        {!active ? <div className="empty"><p>Seleziona un pannello sulla vettura per iniziare.</p></div> : <>
          <h4>{active.name}</h4>
          <div className="damage-severity" role="group" aria-label="Gravità del danno"><button type="button" aria-pressed={severity === 'lieve'} className={severity === 'lieve' ? 'primary' : 'secondary'} onClick={() => changeSeverity('lieve')}>Danno lieve</button><button type="button" aria-pressed={severity === 'grave'} className={severity === 'grave' ? 'primary' : 'secondary'} onClick={() => changeSeverity('grave')}>Danno grave</button></div>
          {severity === 'lieve' ? <p>Usa il listino del pannello oppure imposta le lavorazioni qui sotto e memorizzale per le prossime vetture. Prezzi IVA esclusa.</p>
            : <label>Tariffa vendita per danni gravi €/h<MoneyInput value={quote.hourlyRate} onValueChange={(value) => changeRate(value ?? 0)} /><small>Inserisci le ore di ogni lavorazione: il prezzo si aggiorna automaticamente.</small></label>}
          {!selected.length && <p className="damage-hint">Nessuna lavorazione inserita. Seleziona quelle necessarie e completa tempi e prezzi.</p>}
          <div className="damage-work-list">{works.map((work) => {
            const line = selected.find((item) => item.standardWorkId === work.id)
            return <div className="damage-work" key={work.id}>
              <label className="damage-work-toggle"><input type="checkbox" checked={Boolean(line)} onChange={(event) => {
                if (event.target.checked) commit([...lines, makeDamageLine(settings, active, work, severity, quote.appliedVatRate, quote.hourlyRate)])
                else commit(lines.filter((item) => item.id !== line?.id))
              }} />{work.name}</label>
              {line && <div className="damage-work-values">
                <label>Ore {work.name}<input type="number" inputMode="decimal" min="0" step="0.25" value={Number(((line.estimatedMinutes ?? 0) / 60).toFixed(4))} onChange={(event) => changeMinutes(line, Number(event.target.value))} /></label>
                {severity === 'lieve' ? <label>Prezzo {work.name} €<MoneyInput value={line.unitPrice} onValueChange={(value) => commit(lines.map((item) => item.id !== line.id ? item : recalculateDamageLine({ ...item, unitPrice: value ?? 0 }, settings)))} /></label>
                  : <div><span>Prezzo IVA esclusa</span><strong>{money(line.unitPrice)}</strong></div>}
                {(!line.unitPrice || !line.estimatedMinutes) && <small className="damage-incomplete">Tempo o prezzo da completare</small>}
              </div>}
            </div>
          })}</div>
          {!works.length && <p role="alert">Configura almeno una lavorazione attiva in Impostazioni → Planner e tempi.</p>}
          <div className="damage-panel-total"><span>Totale pannello</span><strong>{duration(selected.reduce((sum, line) => sum + (line.estimatedMinutes ?? 0), 0))} · {money(selected.reduce((sum, line) => sum + line.unitPrice, 0))}</strong></div>
          <div className="damage-actions">
            {severity === 'lieve' && onSavePreset && <button type="button" className="primary" disabled={!selected.length || Boolean(damageQuoteError(selected))} onClick={() => { onSavePreset(makeMinorDamagePreset(active, lines)); setNotice('Tempi e prezzi del danno lieve memorizzati per questo pannello.') }}>Memorizza danno lieve</button>}
            <button type="button" className="secondary" onClick={() => { const preset = minorDamageLines(settings, active, quote.appliedVatRate); if (selected.length && !window.confirm('Sostituire tempi e prezzi di questo pannello con il listino del danno lieve?')) return; setSeverity('lieve'); commit([...lines.filter((line) => line.panelId !== activeId), ...preset]) }}>Ricarica danno lieve</button>
            <button type="button" className="danger" disabled={!selected.length} onClick={() => commit(lines.filter((line) => line.panelId !== activeId))}>Rimuovi pannello</button>
          </div>
          {notice && <p role="status">{notice}</p>}
        </>}
      </div>
    </div>
    <div className="damage-total" aria-live="polite"><div><span>Tempo totale pannelli</span><strong>{duration(lines.reduce((sum, line) => sum + (line.estimatedMinutes ?? 0), 0))}</strong></div><div><span>Imponibile complessivo</span><strong>{money(summary.taxableAmount)}</strong></div><div><span>Totale IVA inclusa</span><strong>{money(summary.total)}</strong></div></div>
    <p>Materiali aggiuntivi: {quote.materialPercent}% · {money(summary.materials.total)}. Imposta 0% in «Altri importi, materiali e IVA» se sono già inclusi nei prezzi dei pannelli.</p>
    {quote.lines.some((line) => line.kind === 'labor' && line.quantity > 0) && <p className="damage-incomplete">La pratica contiene anche ore di manodopera aggiuntive: controllale in «Altri importi, materiali e IVA» per evitare di conteggiarle due volte.</p>}
    {error && <p className="damage-incomplete" role="alert">{error}</p>}
  </section>
}
