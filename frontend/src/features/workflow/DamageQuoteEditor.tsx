import { quoteCustomerLines } from '../../services/quotePricing'
import { useId, useState } from 'react'
import type { AcceptanceQuote, EstimateLine, MinorDamagePreset, PlannerSettings } from '../../types'
import { MoneyInput } from '../../components/MoneyInput'
import { buildAcceptanceQuoteSummary } from '../../services/acceptance'
import { chooseEliasPrice, damageQuoteError, makeDamageLine, makeMinorDamagePreset, minorDamageLines, recalculateDamageLine } from '../../services/damageQuote'
import { ELIAS_PRICE_LIST, eliasEntryForWork, eliasPricesForPanel } from '../../services/eliasPriceList'
import { PANEL_CATALOG, QUOTE_PANELS, type VehicleViewId } from './vehiclePanels'
import { calculateQuoteHourBudget } from '../../services/quoteHourBudget'
import { QuoteHourBudget } from './QuoteHourBudget'

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
  const [rainSensor, setRainSensor] = useState(false)
  const gradientId = useId().replace(/:/g, '')
  const lines = quote.damageLines ?? []
  const active = QUOTE_PANELS.find((panel) => panel.id === activeId)
  const selected = lines.filter((line) => line.panelId === activeId)
  const catalogLines = selected.filter((line) => eliasEntryForWork(line.standardWorkId))
  const works = (settings.standardWorks ?? []).filter((work) => work.active).sort((a, b) => a.cycleOrder - b.cycleOrder)
  const hourBudget = calculateQuoteHourBudget(quote, settings)
  const summary = buildAcceptanceQuoteSummary(quote)
  const error = damageQuoteError(lines)

  const commit = (nextLines: EstimateLine[], rate = quote.hourlyRate) => {
    onChange({ ...quote, manualOnlyPricing: true, hourlyRate: rate, damageLines: nextLines })
    setNotice('')
  }
  const selectPanel = (panelId: string) => {
    setActiveId(panelId)
    setNotice('')
    const existing = lines.filter((line) => line.panelId === panelId)
    setRainSensor(existing.some((line) => line.priceVariant?.includes('sensore pioggia')))
    setSeverity(existing[0]?.damageSeverity ?? 'lieve')
    if (existing.length) return
    const panel = QUOTE_PANELS.find((item) => item.id === panelId)!
    const automatic = minorDamageLines(settings, panel, quote.appliedVatRate)
    if (automatic.length) commit([...lines, ...automatic])
  }
  const changeSeverity = (next: 'lieve' | 'grave') => {
    if (!active || next === severity) return
    setSeverity(next)
    // Il passaggio di gravità conserva le lavorazioni e i tempi già inseriti.
    commit(lines.map((line) => line.panelId !== activeId ? line : recalculateDamageLine({ ...line,
      damageSeverity: next,
    }, settings)))
  }
  const changeMinutes = (line: EstimateLine, hours: number) => {
    const minutes = Math.round(Math.max(0, hours) * 60)
    commit(lines.map((item) => item.id !== line.id ? item : recalculateDamageLine({ ...item, estimatedMinutes: minutes,
      unitPrice: item.unitPrice,
    }, settings)))
  }
  const changeRate = (rate: number) => commit(lines, rate)

  return <section className="damage-quote" aria-label="Preventivo grafico">
    <div className="panel-head"><div><span className="eyebrow">PREVENTIVO RAPIDO · LISTINO ELIAS</span><h3>Tocca la parte danneggiata</h3><p>Scegli il pannello e la voce del tuo listino. Prezzi IVA esclusa, materiali già compresi. Per il danno lieve puoi memorizzare le ore; per il grave inseriscile manualmente.</p></div></div>
    <QuoteHourBudget quote={quote} settings={settings} activePanelId={activeId} onChange={onChange} />
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
        <label className="damage-panel-picker">Scegli un pannello o un accessorio<select value={activeId} onChange={(event) => { const panel = QUOTE_PANELS.find((item) => item.id === event.target.value); if (panel) { setView(panel.view); selectPanel(panel.id) } }}><option value="">Tocca la vettura oppure scegli qui</option>{QUOTE_PANELS.map((panel) => <option key={panel.id} value={panel.id}>{panel.name}</option>)}</select></label>
        <button type="button" className="secondary damage-whole" onClick={() => selectPanel('vettura-intera')}>Vettura intera / interni</button>
        <div className="damage-selected">{QUOTE_PANELS.filter((panel) => lines.some((line) => line.panelId === panel.id)).map((panel) => <button type="button" className={activeId === panel.id ? 'primary' : 'secondary'} key={panel.id} onClick={() => { setView(panel.view); selectPanel(panel.id) }}>{panel.name} · {duration(lines.filter((line) => line.panelId === panel.id).reduce((sum, line) => sum + (line.estimatedMinutes ?? 0), 0))}</button>)}</div>
      </div>
      <div className="damage-controls">
        {!active ? <div className="empty"><p>Seleziona un pannello sulla vettura per iniziare.</p></div> : <>
          <h4>{active.name}</h4>
          <div className="damage-severity" role="group" aria-label="Gravità del danno"><button type="button" aria-pressed={severity === 'lieve'} className={severity === 'lieve' ? 'primary' : 'secondary'} onClick={() => changeSeverity('lieve')}>Danno lieve</button><button type="button" aria-pressed={severity === 'grave'} className={severity === 'grave' ? 'primary' : 'secondary'} onClick={() => changeSeverity('grave')}>Danno grave</button></div>
          <div className="elias-price-choices" aria-label="Voci del listino Elias">
            <strong>Il tuo listino · materiali inclusi</strong>
            <small>{severity === 'lieve' ? 'Tocca il prezzo da applicare. Dove ci sono due importi, scegli quello corretto per questo lavoro.' : 'Seleziona la lavorazione. Gli importi sotto sono il riferimento per il danno lieve; per il grave imposti tu tempi e prezzo.'}</small>
            {activeId === 'parabrezza' && severity === 'lieve' && <label className="damage-work-toggle"><input type="checkbox" checked={rainSensor} onChange={(event) => {
              const checked = event.target.checked
              setRainSensor(checked)
              const line = catalogLines.find((item) => eliasEntryForWork(item.standardWorkId)?.id === 'parabrezza')
              if (line) { const wasIncluded = Boolean(line.priceVariant?.includes('sensore pioggia')); commit(lines.map((item) => item.id !== line.id ? item : recalculateDamageLine({ ...item, unitPrice: item.unitPrice + (checked ? 15 : 0) - (wasIncluded ? 15 : 0), priceVariant: checked ? 'sensore pioggia (+15 €)' : undefined }, settings))) }
            }} />Sensore pioggia: +15 € sul danno lieve</label>}
            {eliasPricesForPanel(activeId).map((entry) => <div className="elias-price-choice" key={entry.id}><span>{entry.name}</span><div>{entry.prices.map((price) => <button type="button" key={price} className="secondary" aria-label={`${entry.name}: ${price} euro`} onClick={() => commit(chooseEliasPrice(settings, lines, active, entry, price, quote.appliedVatRate, severity, quote.hourlyRate, rainSensor))}>{money(price)}</button>)}</div></div>)}
          </div>
          {severity === 'lieve' ? <p>Usa il listino del pannello oppure imposta le lavorazioni qui sotto e memorizzale per le prossime vetture. Prezzi IVA esclusa.</p>
            : <label>Tariffa vendita per danni gravi €/h<MoneyInput value={quote.hourlyRate} onValueChange={(value) => changeRate(value ?? 0)} /><small>Tariffa di riferimento: tempi e costi interni non modificano il prezzo.</small></label>}
          {!selected.length && <p className="damage-hint">Nessuna lavorazione inserita. Seleziona quelle necessarie e completa tempi e prezzi.</p>}
          <div className="damage-work-list">{catalogLines.map((line) => <div className="damage-work" key={line.id}>
            <strong>{line.standardWorkName}</strong><small className="elias-materials">Materiali inclusi{line.priceVariant?.includes('sensore pioggia') ? ' · sensore pioggia incluso' : ''}</small>
            <div className="damage-work-values"><label>Ore {line.standardWorkName}<input type="number" inputMode="decimal" min="0" step="0.25" value={Number(((line.estimatedMinutes ?? 0) / 60).toFixed(4))} onChange={(event) => changeMinutes(line, Number(event.target.value))} /></label>
              <label>Prezzo {line.standardWorkName} €<MoneyInput value={line.unitPrice} onValueChange={(value) => commit(lines.map((item) => item.id !== line.id ? item : recalculateDamageLine({ ...item, unitPrice: value ?? 0 }, settings)))} /></label>
            </div>
            {!line.estimatedMinutes && <p className="damage-incomplete">Le ore economiche disponibili sono calcolate sotto dal prezzo. Inserisci qui il tempo tecnico necessario per pianificare le fasi e la consegna.</p>}
            <button type="button" className="secondary" onClick={() => commit(lines.filter((item) => item.id !== line.id))}>Rimuovi {line.standardWorkName}</button>
          </div>)}</div>
          {catalogLines.length > 0 && selected.some((line) => !eliasEntryForWork(line.standardWorkId)) && <p className="damage-incomplete">Questo pannello contiene anche altre lavorazioni oltre al prezzo del listino. Controlla le voci qui sotto per evitare doppi addebiti.</p>}
          <details className="damage-extra-details" open={selected.some((line) => !eliasEntryForWork(line.standardWorkId)) || undefined}><summary>Altre lavorazioni e tempi separati</summary><p>Aggiungi queste voci solo per interventi extra rispetto al prezzo del listino, per evitare doppi addebiti.</p>
          <div className="damage-work-list">{works.map((work) => {
            const line = selected.find((item) => item.standardWorkId === work.id)
            return <div className="damage-work" key={work.id}>
              <label className="damage-work-toggle"><input type="checkbox" checked={Boolean(line)} onChange={(event) => {
                if (event.target.checked) commit([...lines, makeDamageLine(settings, active, work, severity, quote.appliedVatRate, quote.hourlyRate)])
                else commit(lines.filter((item) => item.id !== line?.id))
              }} />{work.name}</label>
              {line && <div className="damage-work-values">
                <label>Ore {work.name}<input type="number" inputMode="decimal" min="0" step="0.25" value={Number(((line.estimatedMinutes ?? 0) / 60).toFixed(4))} onChange={(event) => changeMinutes(line, Number(event.target.value))} /></label>
                <label>Prezzo {work.name} €<MoneyInput value={line.unitPrice} onValueChange={(value) => commit(lines.map((item) => item.id !== line.id ? item : recalculateDamageLine({ ...item, unitPrice: value ?? 0 }, settings)))} /></label>
                {(!line.unitPrice || !line.estimatedMinutes) && <small className="damage-incomplete">Tempo o prezzo da completare</small>}
              </div>}
            </div>
          })}</div></details>
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
    <div className="damage-total" aria-live="polite"><div><span>Ore a disposizione</span><strong>{hourBudget.baseMaxMinutes === null ? 'Da configurare' : duration(hourBudget.baseMaxMinutes)}</strong></div><div><span>Tempo tecnico previsto</span><strong>{duration(lines.reduce((sum, line) => sum + (line.estimatedMinutes ?? 0), 0))}</strong></div><div><span>Imponibile complessivo</span><strong>{money(summary.taxableAmount)}</strong></div><div><span>Totale IVA inclusa</span><strong>{money(summary.total)}</strong></div></div>
    <p>Prezzi fissi scelti da te. Materiali interni esclusi dai ricarichi automatici; eventuali materiali aggiunti manualmente: {money(summary.materials.total)}.</p>
    <details className="damage-extra-details"><summary>Vedi tutto il listino della foto</summary><p>IVA esclusa · materiali inclusi. I prezzi doppi restano a scelta, senza assegnarli a categorie non indicate nel foglio. Parabrezza: +15 € con sensore pioggia.</p><div className="elias-price-table"><table><thead><tr><th>Lavorazione</th><th>Prezzo</th></tr></thead><tbody>{ELIAS_PRICE_LIST.map((entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.prices.map(money).join(' / ')}</td></tr>)}</tbody></table></div></details>
    {quoteCustomerLines(quote).some((line) => line.kind === 'labor' && line.quantity > 0) && <p className="damage-incomplete">La pratica contiene anche ore di manodopera aggiuntive: controllale in «Altri importi, materiali e IVA» per evitare di conteggiarle due volte.</p>}
    {error && <p className="damage-incomplete" role="alert">{error}</p>}
  </section>
}
