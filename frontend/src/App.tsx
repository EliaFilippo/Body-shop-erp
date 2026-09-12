import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { Icon } from './components/Icon'
import { MoneyInput } from './components/MoneyInput'
import { Modal } from './components/Modal'
import { DocumentCapturePanel, queueDocumentCaptureFile } from './components/DocumentCapturePanel'
import { parseMoneyDraft } from './components/money'
import { addVehicleCostEntry, createCustomer, deleteCustomer, deleteVehicle, moveVehicleCone, changeVehicleStatus, isVehicleWaitingForCone, TOTAL_CONES, emptyData, normalizePlate, updateCustomer } from './services/erp'
import { loadDatabase, REVISION_PING_KEY, saveDatabase } from './services/database'
import { analyzeDatabaseIntegrity, prepareDuplicateResolution, resolveDuplicatePlate, type DatabaseIntegrityReport, type DuplicateResolutionResult } from './services/database'
import { removePriceListItem, setPriceListItemActive, upsertPriceListItem } from './services/priceList'
import { PlannerPage } from './features/planner/PlannerPage.tsx'
import { OperatorProgramPage } from './features/planner/OperatorProgramPage'
import { PlannerSettingsPage } from './features/planner/PlannerSettingsPage'
import { MonthlyGoalsSettingsPage } from './features/planner/MonthlyGoalsSettingsPage'
import { VehicleStatusesSettingsPage } from './features/planner/VehicleStatusesSettingsPage'
import { calculateDayCapacity, calculatePlanner, recalculateOperatorPrograms, remainingHours } from './services/planner'
import { calculateInternalCostMonthlyTotals, calculateInternalProductiveCapacity, resolveInternalHourlyRate } from './services/workflow'
import { calculateExecutiveDashboardSnapshot, calculateVehicleEconomicSnapshot } from './services/economic'
import { calculateBusinessOverviewSnapshot, type BusinessOverviewPeriod } from './services/businessOverview'
import { appendAcceptancePhotoEntry, createAcceptanceDraft, createEmptyDocumentDraft, createPhotoArchiveEntry, mergeCustomerDocumentDraftWithOcr, mergeVehicleBookletDraftWithOcr } from './services/acceptance'
import { FinancePage } from './features/finance/FinancePage'
import { TodayShopPage } from './features/production/TodayShopPage'
import { buildTodayInShopSnapshot, openProductionReports, runProductionDelayControl, syncProductionJobsFromVehicles, syncVehicleWorkedHoursFromProduction } from './features/production/production'
import { WorkflowPage } from './features/workflow/WorkflowPage'
import { syncOperationalStateFromJobs } from './services/workflow'
import { DOCUMENT_IDENTITY_OCR_GENERIC_ERROR, readIdentityDocument } from './services/documentIdentityOcr'
import { VEHICLE_BOOKLET_OCR_GENERIC_ERROR, readVehicleBooklet } from './services/vehicleBookletOcr'
import { saveVehicleWithPersistenceCheck } from './services/vehiclePersistence.ts'
import { listSelectableVehicleStatuses, resolveVehicleStatusId, resolveVehicleStatusLabel } from './services/vehicleStatuses'
import { DEFAULT_WEEKLY_WORK_SCHEDULE, intervalsToText, normalizeWeeklyWorkSchedule } from './services/workCalendar'
import { ORIGIN_BLOCK_MESSAGE, isFileOrigin, tryRedirectFromFileOrigin } from './services/originGuard'
import type { AcceptanceCase, AcceptanceIntakeData, CompanyClosureEntry, Customer, CustomerType, ErpData, StandardWorkPriceListItem, Vehicle, VehicleCostCategory, VehicleStatus, View, WeeklyWorkDaySchedule } from './types'

const nav: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' }, { id: 'today-shop', label: 'Oggi in carrozzeria' }, { id: 'customers', label: 'Clienti' },
  { id: 'vehicles', label: 'Veicoli' }, { id: 'cones', label: 'Gestione coni' },
  { id: 'planner', label: 'Planner intelligente' },
  { id: 'work-hours', label: 'Orari di lavoro' },
  { id: 'price-list', label: 'Listino prezzi' }, { id: 'operator-program', label: 'Programma operatori' },
  { id: 'acceptance', label: 'Accettazione' },
  { id: 'pending-cases', label: 'Pratiche da confermare' },
  { id: 'confirmed-cases', label: 'Pratiche confermate' },
  { id: 'estimates-jobs', label: 'Preventivi / Commesse' },
  { id: 'finance', label: 'Finance' },
]
const settingsNav: { id: View; label: string }[] = [
  { id: 'planner-settings', label: 'Planner e tempi' },
  { id: 'vehicle-statuses', label: 'Stati vettura' },
  { id: 'work-hours', label: 'Orari di lavoro' },
  { id: 'price-list', label: 'Listino prezzi' },
  { id: 'internal-costs', label: 'Costi e tariffe interne' },
  { id: 'monthly-goals', label: 'Obiettivi' },
  { id: 'database-diagnostics', label: 'Diagnostica database' },
]
const titleOverrides: Partial<Record<View, string>> = {
  settings: 'Impostazioni',
  'planner-settings': 'Planner e tempi',
  'vehicle-statuses': 'Stati vettura',
  'internal-costs': 'Costi e tariffe interne',
  'monthly-goals': 'Obiettivi',
  'database-diagnostics': 'Diagnostica database',
}
const settingsCards: Array<{ id: View; title: string; description: string }> = [
  { id: 'planner-settings', title: 'Planner e tempi', description: 'Lavorazioni, tempi standard, tempi tecnici e regole produttive' },
  { id: 'vehicle-statuses', title: 'Stati vettura', description: 'Catalogo stati, colori, icone, ordine, default e attivazione' },
  { id: 'work-hours', title: 'Orari di lavoro', description: 'Calendario aziendale, pause, chiusure e disponibilità' },
  { id: 'price-list', title: 'Listino prezzi', description: 'Prezzi per pannello, lavorazione, estensione e variante' },
  { id: 'internal-costs', title: 'Costi e tariffe interne', description: 'Spese mensili, capacità produttiva, tariffa oraria interna e marginalità' },
  { id: 'monthly-goals', title: 'Obiettivi', description: 'Obiettivi produttivi ed economici' },
  { id: 'database-diagnostics', title: 'Diagnostica database', description: 'Analisi integrità snapshot corrente e risoluzione duplicati guidata' },
]

const coneLabel = (vehicle: Pick<Vehicle, 'status' | 'coneNumber'>) => {
  if (vehicle.coneNumber !== null) return `Cono ${vehicle.coneNumber}`
  return isVehicleWaitingForCone(vehicle) ? 'In attesa cono (Nessun cono disponibile)' : '—'
}
const formatDate = (value: string) => new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
const parseMoney = (value: string | FormDataEntryValue | null) => parseMoneyDraft(String(value ?? '')) ?? 0
const ACCEPTANCE_IMAGE_FILE_TYPES = '.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff,.heic,.heif,.avif,image/jpeg,image/png,image/webp,image/bmp,image/gif,image/tiff,image/heic,image/heif,image/avif'
const ACCEPTANCE_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif', 'image/tiff', 'image/heic', 'image/heif', 'image/avif'])
const ACCEPTANCE_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.heic', '.heif', '.avif']
const ACCEPTANCE_CHECKLIST_DAMAGE_LABEL = 'Danni registrati'
const ACCEPTANCE_CHECKLIST_ACCESSORIES_LABEL = 'Accessori verificati'
const ACCEPTANCE_CHECKLIST_PHOTOS_LABEL = 'Foto caricate'
const ACCEPTANCE_CHECKLIST_SIGNATURE_LABEL = 'Firma cliente acquisita'
const CUSTOMER_DOCUMENT_INPUT_ID = 'acceptance-customer-document-input'

function isAcceptedImageFile(file: File) {
  const fileType = String(file.type ?? '').toLowerCase()
  if (ACCEPTANCE_IMAGE_MIME_TYPES.has(fileType)) return true
  const fileName = file.name.toLowerCase()
  return ACCEPTANCE_IMAGE_EXTENSIONS.some((extension) => fileName.endsWith(extension))
}

const createEmptyAccessoriesDraft = (): NonNullable<AcceptanceIntakeData['accessoriesDraft']> => ({
  keyCount: '',
  hasRegistrationCard: false,
  hasSpareWheelKit: false,
  hasTriangle: false,
  hasSafetyVest: false,
  hasFloorMats: false,
  hasPersonalItems: false,
  otherNotes: '',
  confirmed: false,
})

function parseAccessoriesDraftFromLegacy(accessories: string[] = []): NonNullable<AcceptanceIntakeData['accessoriesDraft']> {
  const draft = createEmptyAccessoriesDraft()
  for (const entry of accessories) {
    const normalized = entry.trim().toLowerCase()
    if (!normalized) continue
    if (normalized.startsWith('numero chiavi:')) {
      draft.keyCount = entry.split(':').slice(1).join(':').trim()
      continue
    }
    if (normalized === 'carta/libretto presente') draft.hasRegistrationCard = true
    if (normalized === 'ruota di scorta / kit gonfiaggio') draft.hasSpareWheelKit = true
    if (normalized === 'triangolo') draft.hasTriangle = true
    if (normalized === 'giubbotto alta visibilita') draft.hasSafetyVest = true
    if (normalized === 'tappetini') draft.hasFloorMats = true
    if (normalized === 'oggetti personali') draft.hasPersonalItems = true
    if (normalized.startsWith('altro:')) draft.otherNotes = entry.split(':').slice(1).join(':').trim()
  }
  return draft
}

function buildAccessoriesList(draft: NonNullable<AcceptanceIntakeData['accessoriesDraft']>): string[] {
  const accessories: string[] = []
  const keyCount = draft.keyCount.trim()
  if (keyCount) accessories.push(`Numero chiavi: ${keyCount}`)
  if (draft.hasRegistrationCard) accessories.push('Carta/libretto presente')
  if (draft.hasSpareWheelKit) accessories.push('Ruota di scorta / kit gonfiaggio')
  if (draft.hasTriangle) accessories.push('Triangolo')
  if (draft.hasSafetyVest) accessories.push('Giubbotto alta visibilita')
  if (draft.hasFloorMats) accessories.push('Tappetini')
  if (draft.hasPersonalItems) accessories.push('Oggetti personali')
  const otherNotes = draft.otherNotes.trim()
  if (otherNotes) accessories.push(`Altro: ${otherNotes}`)
  return accessories
}

const normalizeInternalCostSettings = (input: ErpData['plannerSettings']['internalCostSettings'], efficiencyPercent: number) => ({
  internalHourlyRate: Number(input?.internalHourlyRate ?? 0),
  minimumMarginPercent: Number(input?.minimumMarginPercent ?? 20),
  monthlyCostItems: structuredClone(input?.monthlyCostItems ?? []),
  productiveCapacity: {
    productiveOperators: Number(input?.productiveCapacity?.productiveOperators ?? 0),
    hoursPerOperatorPerDay: Number(input?.productiveCapacity?.hoursPerOperatorPerDay ?? 0),
    workingDaysPerMonth: Number(input?.productiveCapacity?.workingDaysPerMonth ?? 0),
    efficiencyPercent: Number(input?.productiveCapacity?.efficiencyPercent ?? efficiencyPercent ?? 0),
  },
  useManualHourlyRate: Boolean(input?.useManualHourlyRate),
  manualHourlyRate: input?.manualHourlyRate ?? null,
  futureHourlyRateBySkill: structuredClone(input?.futureHourlyRateBySkill ?? {}),
})

function InternalCostsSettingsPage({ settings, onSave }: { settings: ErpData['plannerSettings']; onSave: (settings: NonNullable<ErpData['plannerSettings']['internalCostSettings']>) => Promise<void> }) {
  const [draft, setDraft] = useState(() => normalizeInternalCostSettings(settings.internalCostSettings, settings.efficiencyPercent))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(normalizeInternalCostSettings(settings.internalCostSettings, settings.efficiencyPercent))
  }, [settings.internalCostSettings, settings.efficiencyPercent])

  const snapshot = { ...settings, internalCostSettings: draft }
  const monthly = calculateInternalCostMonthlyTotals(snapshot)
  const productiveCapacity = calculateInternalProductiveCapacity(snapshot)
  const hourlyRate = resolveInternalHourlyRate(snapshot)

  const updateCapacity = (field: keyof typeof draft.productiveCapacity, value: number) => {
    setDraft((current) => ({
      ...current,
      productiveCapacity: { ...current.productiveCapacity, [field]: value },
    }))
  }

  const updateItem = (itemId: string, patch: Partial<NonNullable<NonNullable<ErpData['plannerSettings']['internalCostSettings']>['monthlyCostItems']>[number]>) => {
    setDraft((current) => ({
      ...current,
      monthlyCostItems: (current.monthlyCostItems ?? []).map((item) => item.id === itemId ? { ...item, ...patch } : item),
    }))
  }

  const addItem = () => {
    setDraft((current) => ({
      ...current,
      monthlyCostItems: [
        ...(current.monthlyCostItems ?? []),
        { id: crypto.randomUUID(), category: 'personale', description: 'Nuovo costo', monthlyAmount: 0, active: true },
      ],
    }))
  }

  const removeItem = (itemId: string) => {
    setDraft((current) => ({
      ...current,
      monthlyCostItems: (current.monthlyCostItems ?? []).filter((item) => item.id !== itemId),
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return <section className="settings-stack">
    <div className="welcome">
      <div>
        <span className="eyebrow">COSTI E TARIFFE INTERNE</span>
        <h2>Tariffa oraria e marginalità interna</h2>
        <p>Usato da Workflow, preventivi e calcolo marginalità senza duplicare i motori di calcolo esistenti.</p>
      </div>
      <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Salvataggio...' : 'Salva costi interni'}</button>
    </div>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">RIEPILOGO</span><h3>Calcoli correnti</h3></div></div>
      <div className="settings-card-grid internal-cost-summary-grid">
        <div className="settings-card"><span>Tariffa interna effettiva</span><strong>{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(hourlyRate.effectiveHourlyRate)}</strong></div>
        <div className="settings-card"><span>Costi mensili considerati</span><strong>{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(monthly.consideredMonthlyCosts)}</strong></div>
        <div className="settings-card"><span>Ore produttive</span><strong>{productiveCapacity.productiveHours.toLocaleString('it-IT')}</strong></div>
        <div className="settings-card"><span>Tariffa automatica</span><strong>{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(hourlyRate.automaticHourlyRate)}</strong></div>
      </div>
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">CAPACITÀ PRODUTTIVA</span><h3>Parametri di base</h3></div></div>
      <div className="form-grid internal-cost-form">
        <label>Tariffa oraria manuale<input type="number" min="0" step="0.01" value={draft.manualHourlyRate ?? ''} onChange={(event) => setDraft((current) => ({ ...current, manualHourlyRate: event.target.value === '' ? null : Number(event.target.value) }))} /></label>
        <label className="check"><input type="checkbox" checked={draft.useManualHourlyRate ?? false} onChange={(event) => setDraft((current) => ({ ...current, useManualHourlyRate: event.target.checked }))} /> Usa tariffa manuale</label>
        <label>Soglia margine minimo (%)<input type="number" min="0" max="100" step="0.1" value={draft.minimumMarginPercent ?? 20} onChange={(event) => setDraft((current) => ({ ...current, minimumMarginPercent: Number(event.target.value) }))} /></label>
        <label>Operatori produttivi<input type="number" min="0" step="1" value={draft.productiveCapacity.productiveOperators} onChange={(event) => updateCapacity('productiveOperators', Number(event.target.value))} /></label>
        <label>Ore per operatore/giorno<input type="number" min="0" step="0.1" value={draft.productiveCapacity.hoursPerOperatorPerDay} onChange={(event) => updateCapacity('hoursPerOperatorPerDay', Number(event.target.value))} /></label>
        <label>Giorni produttivi/mese<input type="number" min="0" step="1" value={draft.productiveCapacity.workingDaysPerMonth} onChange={(event) => updateCapacity('workingDaysPerMonth', Number(event.target.value))} /></label>
        <label>Efficienza produttiva (%)<input type="number" min="0" max="100" step="0.1" value={draft.productiveCapacity.efficiencyPercent} onChange={(event) => updateCapacity('efficiencyPercent', Number(event.target.value))} /></label>
      </div>
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">COSTI MENSILI</span><h3>Spese considerate nel calcolo</h3></div><button className="secondary" onClick={addItem}>+ Aggiungi voce</button></div>
      <div className="settings-list internal-cost-list">
        {(draft.monthlyCostItems ?? []).map((item) => <div className="settings-row internal-cost-row" key={item.id}>
          <input value={item.description} onChange={(event) => updateItem(item.id, { description: event.target.value })} placeholder="Descrizione" />
          <select value={item.category} onChange={(event) => updateItem(item.id, { category: event.target.value as typeof item.category })}>
            <option value="personale">Personale</option>
            <option value="affitto">Affitto</option>
            <option value="noleggi-leasing">Noleggi / Leasing</option>
            <option value="energia">Energia</option>
            <option value="assicurazioni">Assicurazioni</option>
            <option value="software">Software</option>
            <option value="consulenze-amministrazione">Consulenze / amministrazione</option>
            <option value="utenze">Utenze</option>
            <option value="altri-costi-fissi">Altri costi fissi</option>
            <option value="altri-costi-generali">Altri costi generali</option>
          </select>
          <input type="number" min="0" step="0.01" value={item.monthlyAmount} onChange={(event) => updateItem(item.id, { monthlyAmount: Number(event.target.value) })} />
          <label className="check"><input type="checkbox" checked={item.active} onChange={(event) => updateItem(item.id, { active: event.target.checked })} /> Attiva</label>
          <button className="danger" onClick={() => removeItem(item.id)}>Rimuovi</button>
        </div>)}
        {!(draft.monthlyCostItems ?? []).length && <small>Nessun costo mensile configurato.</small>}
      </div>
    </section>
  </section>
}

function DatabaseDiagnosticsSettingsPage({ onRefreshSnapshot, setNotice, setError }: { onRefreshSnapshot: () => Promise<void>; setNotice: (message: string) => void; setError: (message: string) => void }) {
  const [report, setReport] = useState<DatabaseIntegrityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [resolvingPlate, setResolvingPlate] = useState<string | null>(null)
  const [lastResolution, setLastResolution] = useState<DuplicateResolutionResult | null>(null)

  const analyze = async () => {
    setLoading(true)
    try {
      const snapshot = await analyzeDatabaseIntegrity()
      setReport(snapshot)
      setLastResolution(null)
      setError('')
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Analisi integrità non riuscita.')
    } finally {
      setLoading(false)
    }
  }

  const resolveGroup = async (normalizedPlate: string) => {
    setResolvingPlate(normalizedPlate)
    try {
      const plan = await prepareDuplicateResolution(normalizedPlate)
      const confirmation = [
        `Mantieni: vehicleId ${plan.canonicalVehicleId}`,
        `Consolida: ${plan.consolidatedVehicleIds.join(', ')}`,
        `Relazioni da trasferire: ${plan.relationsToTransfer}`,
        '',
        'Confermi la bonifica nel database corrente?',
      ].join('\n')

      if (!window.confirm(confirmation)) return

      const result = await resolveDuplicatePlate(normalizedPlate)
      setLastResolution(result)
      await onRefreshSnapshot()
      const refreshed = await analyzeDatabaseIntegrity()
      setReport(refreshed)
      setNotice(`Bonifica completata per ${normalizedPlate}. Backup: ${result.backupKey}`)
      setError('')
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Bonifica duplicato non riuscita.')
    } finally {
      setResolvingPlate(null)
    }
  }

  return <section className="settings-stack">
    <div className="welcome">
      <div>
        <span className="eyebrow">DIAGNOSTICA DATABASE</span>
        <h2>Integrità snapshot corrente</h2>
        <p>Analizza il database del browser corrente senza modificare nulla. La risoluzione duplicati richiede conferma esplicita e crea sempre un backup.</p>
      </div>
      <button className="primary" disabled={loading} onClick={() => void analyze()}>{loading ? 'Analisi in corso...' : 'Analizza integrità'}</button>
    </div>

    {report && <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">SNAPSHOT AUTOREVOLE</span><h3>Riepilogo database corrente</h3></div></div>
      <div className="settings-card-grid internal-cost-summary-grid">
        <div className="settings-card"><span>DB ID</span><strong>{report.dbId}</strong></div>
        <div className="settings-card"><span>REV</span><strong>{report.revision}</strong></div>
        <div className="settings-card"><span>Origin</span><strong>{report.origin}</strong></div>
        <div className="settings-card"><span>Clienti</span><strong>{report.customers}</strong></div>
        <div className="settings-card"><span>Veicoli</span><strong>{report.vehicles}</strong></div>
        <div className="settings-card"><span>Preventivi</span><strong>{report.estimates}</strong></div>
        <div className="settings-card"><span>Commesse</span><strong>{report.jobs}</strong></div>
        <div className="settings-card"><span>Duplicati targa</span><strong>{report.duplicatePlates.length}</strong></div>
        <div className="settings-card"><span>Riferimenti orfani</span><strong>{report.orphanReferences.length}</strong></div>
      </div>
    </section>}

    {report && <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">DUPLICATI</span><h3>Gruppi per targa normalizzata</h3></div></div>
      {!report.duplicatePlates.length && <div className="empty">Nessun duplicato targa rilevato.</div>}
      {!!report.duplicatePlates.length && <div className="settings-list">
        {report.duplicatePlates.map((group) => <article className="settings-row" key={group.normalizedPlate}>
          <div>
            <strong>{group.normalizedPlate}</strong>
            <div>{group.vehicles.map((vehicle) => `${vehicle.vehicleId} (${vehicle.plate})`).join(' | ')}</div>
          </div>
          <button className="primary" disabled={Boolean(resolvingPlate)} onClick={() => void resolveGroup(group.normalizedPlate)}>
            {resolvingPlate === group.normalizedPlate ? 'Bonifica in corso...' : 'Risolvi duplicato'}
          </button>
        </article>)}
      </div>}
    </section>}

    {report && !!report.orphanReferences.length && <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">RIFERIMENTI ORFANI</span><h3>Dettaglio collegamenti non risolti</h3></div></div>
      <div className="settings-list">
        {report.orphanReferences.map((orphan, index) => <div className="settings-row" key={`${orphan.source}-${orphan.vehicleId}-${index}`}>
          <span>{orphan.source}</span>
          <strong>{orphan.vehicleId}</strong>
        </div>)}
      </div>
    </section>}

    {lastResolution && <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">ULTIMA BONIFICA</span><h3>Esito consolidamento duplicati</h3></div></div>
      <div className="settings-list">
        <div className="settings-row"><span>Targa normalizzata</span><strong>{lastResolution.plan.normalizedPlate}</strong></div>
        <div className="settings-row"><span>Mantieni</span><strong>{lastResolution.plan.canonicalVehicleId}</strong></div>
        <div className="settings-row"><span>Consolidati</span><strong>{lastResolution.plan.consolidatedVehicleIds.join(', ') || 'Nessuno'}</strong></div>
        <div className="settings-row"><span>Relazioni trasferite (stimate)</span><strong>{lastResolution.plan.relationsToTransfer}</strong></div>
        <div className="settings-row"><span>Backup key</span><strong>{lastResolution.backupKey}</strong></div>
        <div className="settings-row"><span>REV prima/dopo</span><strong>{lastResolution.revisionBefore} → {lastResolution.revisionAfter}</strong></div>
        <div className="settings-row"><span>Duplicati dopo</span><strong>{lastResolution.duplicateCountAfter}</strong></div>
        <div className="settings-row"><span>Orfani dopo</span><strong>{lastResolution.orphanCountAfter}</strong></div>
      </div>
    </section>}
  </section>
}

function App() {
  const blockedByOrigin = isFileOrigin()
  const [data, setData] = useState<ErpData>(emptyData)
  const [databaseReady, setDatabaseReady] = useState(false)
  const [databaseLoaded, setDatabaseLoaded] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<
    | { type: 'customer'; item?: Customer; returnToAcceptance?: boolean; onSavedToAcceptance?: (customerId: string) => void }
    | { type: 'vehicle'; item?: Vehicle; initialCustomerId?: string; returnToAcceptance?: boolean; onSavedToAcceptance?: (vehicleId: string) => void }
    | null
  >(null)
  const [costModal, setCostModal] = useState<{ vehicleId: string } | null>(null)
  const [duplicateVehicleId, setDuplicateVehicleId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const [notice, setNotice] = useState('')
  const [acceptanceAutosaveState, setAcceptanceAutosaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const allowCountReductionRef = useRef(false)
  const skipNextAutosaveRef = useRef(false)
  const skipNextHeavySyncRef = useRef(false)
  const acceptanceAutosaveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (blockedByOrigin) {
      tryRedirectFromFileOrigin()
    }
  }, [blockedByOrigin])

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      if (target.type !== 'number') return
      if (document.activeElement !== target) return
      target.blur()
    }

    window.addEventListener('wheel', onWheel, { passive: true })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    let cancelled = false
    loadDatabase()
      .then((stored) => {
        if (cancelled) return
        setData(stored)
        setDatabaseLoaded(true)
      })
      .catch((problem) => {
        if (cancelled) return
        setError(problem instanceof Error ? problem.message : 'Impossibile caricare il database.')
        setDatabaseLoaded(false)
      })
      .finally(() => {
        if (!cancelled) setDatabaseReady(true)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!databaseReady) return

    let syncing = false
    const onStorage = (event: StorageEvent) => {
      if (event.key !== REVISION_PING_KEY || !event.newValue) return
      if (syncing) return
      syncing = true
      void loadDatabase()
        .then((reloaded) => {
          skipNextAutosaveRef.current = true
          skipNextHeavySyncRef.current = true
          setData(reloaded)
        })
        .catch((problem) => {
          setError(problem instanceof Error ? problem.message : 'Impossibile sincronizzare i dati da un altro tab.')
        })
        .finally(() => {
          syncing = false
        })
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [databaseReady])

  useEffect(() => {
    if (!databaseLoaded || !databaseReady) return
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false
      return
    }
    const allowCountReduction = allowCountReductionRef.current
    allowCountReductionRef.current = false
    setAcceptanceAutosaveState('saving')
    if (acceptanceAutosaveTimerRef.current !== null) {
      window.clearTimeout(acceptanceAutosaveTimerRef.current)
      acceptanceAutosaveTimerRef.current = null
    }
    void saveDatabase(data, { allowCountReduction }).catch((problem) => {
      allowCountReductionRef.current = false
      setError(problem instanceof Error ? problem.message : 'Impossibile salvare i dati.')
      setAcceptanceAutosaveState('idle')
    }).then(() => {
      setAcceptanceAutosaveState('saved')
      acceptanceAutosaveTimerRef.current = window.setTimeout(() => {
        setAcceptanceAutosaveState('idle')
        acceptanceAutosaveTimerRef.current = null
      }, 1400)
    })
  }, [data, databaseLoaded, databaseReady])

  useEffect(() => () => {
    if (acceptanceAutosaveTimerRef.current !== null) {
      window.clearTimeout(acceptanceAutosaveTimerRef.current)
    }
  }, [])
  useEffect(() => {
    if (!databaseReady) return
    if (skipNextHeavySyncRef.current) {
      skipNextHeavySyncRef.current = false
      return
    }
    const syncedFromJobs = syncOperationalStateFromJobs(data)
    const syncedForProduction = syncVehicleWorkedHoursFromProduction(syncProductionJobsFromVehicles(syncedFromJobs))
    const delayControlAtIso = data.dbUpdatedAt || undefined
    const withDelayControl = runProductionDelayControl(syncedForProduction, 'Controllo tempi vista responsabile', delayControlAtIso)
    const result = calculatePlanner(withDelayControl.vehicles, withDelayControl.plannerSettings)
    const calculated = new Map(result.vehicles.map((item) => [item.vehicleId, item.calculatedDeliveryDate]))
    const vehicles = withDelayControl.vehicles.map((vehicle) => ({
      ...vehicle,
      calculatedDeliveryDate: calculated.get(vehicle.id) ?? '',
    }))
    const unchangedVehicles = vehicles.every((vehicle, index) => {
      const current = data.vehicles[index]
      return vehicle.calculatedDeliveryDate === current.calculatedDeliveryDate
        && vehicle.workedHours === current.workedHours
    }
    )
    const unchangedProduction = JSON.stringify(withDelayControl.production) === JSON.stringify(data.production)
    const unchangedJobs = JSON.stringify(withDelayControl.jobs) === JSON.stringify(data.jobs)
    const withOperatorProgram = recalculateOperatorPrograms({
      ...withDelayControl,
      vehicles,
      plannerAssignments: result.assignments,
    }, undefined, 'Ricalcolo automatico per variazione dati')
    const unchangedAssignments = JSON.stringify(result.assignments) === JSON.stringify(data.plannerAssignments)
    const unchangedPrograms = JSON.stringify(withOperatorProgram.operatorPrograms) === JSON.stringify(data.operatorPrograms)
    const unchangedProgramHistory = JSON.stringify(withOperatorProgram.operatorProgramHistory) === JSON.stringify(data.operatorProgramHistory)

    if (!unchangedVehicles || !unchangedAssignments || !unchangedProduction || !unchangedJobs || !unchangedPrograms || !unchangedProgramHistory) setData((current) => ({
      ...current,
      vehicles,
      jobs: withDelayControl.jobs,
      plannerAssignments: result.assignments,
      production: withDelayControl.production,
      operatorPrograms: withOperatorProgram.operatorPrograms,
      operatorProgramHistory: withOperatorProgram.operatorProgramHistory,
      operatorProgramRevision: withOperatorProgram.operatorProgramRevision,
    }))
  }, [data, data.vehicles, data.plannerSettings, data.plannerAssignments, databaseReady])

  const customerById = (customerId: string) => data.customers.find((customer) => customer.id === customerId)
  const occupied = data.vehicles.filter((vehicle) => vehicle.coneNumber !== null)
  const filteredCustomers = data.customers.filter((customer) => `${customer.name} ${customer.phone} ${customer.email}`.toLowerCase().includes(query.toLowerCase()))
  const normalizedQueryPlate = normalizePlate(query)
  const filteredVehicles = data.vehicles.filter((vehicle) => {
    if (!query.trim()) return true
    const plateMatches = normalizedQueryPlate ? normalizePlate(vehicle.plate).includes(normalizedQueryPlate) : false
    const textMatches = `${vehicle.make} ${vehicle.model} ${customerById(vehicle.customerId)?.name}`.toLowerCase().includes(query.toLowerCase())
    return plateMatches || textMatches
  })
  const vehicleStatusOptions = listSelectableVehicleStatuses(data.plannerSettings)
  const statusLabel = (status: VehicleStatus) => resolveVehicleStatusLabel(data.plannerSettings, status)

  const updateStatus = (vehicleId: string, status: VehicleStatus) => {
    try { setData(changeVehicleStatus(data, vehicleId, resolveVehicleStatusId(data.plannerSettings, status), { source: 'manual', note: 'Aggiornamento manuale stato vettura.' })); setError('') }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') }
  }

  const title = titleOverrides[view] ?? nav.find((item) => item.id === view)?.label
  const selectedCostVehicle = costModal ? data.vehicles.find((vehicle) => vehicle.id === costModal.vehicleId) : undefined
  const duplicateVehicle = duplicateVehicleId ? data.vehicles.find((vehicle) => vehicle.id === duplicateVehicleId) : undefined
  const openSettings = () => {
    setView('settings')
  }
  const goToView = (nextView: View) => {
    setMenu(false)
    setQuery('')
    setView(nextView)
  }
  if (blockedByOrigin) {
    return <main className="origin-blocked"><h1>{ORIGIN_BLOCK_MESSAGE}</h1></main>
  }
  return <div className="app-shell">
    <aside className={menu ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><div className="brand-mark">E</div><div><strong>ELIAS</strong><span>BODY SHOP ERP</span></div></div>
      <button className={view === 'settings' ? 'active' : ''} onClick={openSettings}>⚙ Impostazioni</button>
      {view === 'settings' && <div className="settings-nav">
        <nav>{settingsNav.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => goToView(item.id)}><Icon name={item.id} /><span>{item.label}</span></button>)}</nav>
      </div>}
      <nav>{nav.map((item) => {
        const isPracticeQueue = item.id === 'pending-cases' || item.id === 'confirmed-cases'
        const className = [
          view === item.id ? 'active' : '',
          isPracticeQueue ? 'practice-nav-item' : '',
          item.id === 'pending-cases' ? 'practice-nav-start' : '',
        ].filter(Boolean).join(' ')
        return <button key={item.id} className={className} onClick={() => goToView(item.id)}><Icon name={item.id} /><span>{item.label}</span>{item.id === 'cones' && <b>{occupied.length}</b>}</button>
      })}</nav>
      <div className="sidebar-foot"><span className="online-dot" /> {databaseReady ? 'Archivio pronto' : 'Caricamento archivio'}</div>
    </aside>
    {menu && <button className="menu-overlay" onClick={() => setMenu(false)} aria-label="Chiudi menu" />}

    <main>
      <header><button className="menu-button" onClick={() => setMenu(true)}><Icon name="menu" /></button><div><span className="eyebrow">PANORAMICA OPERATIVA</span><h1>{title}</h1></div><div className="header-actions"><div className="search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca targa, cliente..." /></div><div className="avatar">FE</div></div></header>
      {error && <div className="toast error"><span>{error}</span>{duplicateVehicle && <button onClick={() => { setView('vehicles'); setQuery(normalizePlate(duplicateVehicle.plate)); setModal({ type: 'vehicle', item: duplicateVehicle }); setDuplicateVehicleId(null); setError('') }}>Apri vettura</button>}<button onClick={() => { setDuplicateVehicleId(null); setError('') }}>×</button></div>}
      {notice && <div className="toast success">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      <div className="content">
        {view === 'dashboard' && <Dashboard data={data} setView={setView} onNewVehicle={() => {
          if (data.customers.length) setModal({ type: 'vehicle' })
          else {
            setView('customers')
            setModal({ type: 'customer' })
          }
        }} onNewCustomer={() => setModal({ type: 'customer' })} />}
        {view === 'today-shop' && <TodayShopPage data={data} customerById={customerById} onOpenPlanner={() => setView('planner')} onOpenVehicles={() => setView('vehicles')} onOpenPractice={(plate) => {
          setView('vehicles')
          setQuery(plate)
        }} onChange={setData} setNotice={setNotice} setError={setError} onUpdateVehicleStatus={updateStatus} statusOptions={vehicleStatusOptions} statusLabel={statusLabel} />}
        {view === 'customers' && <Customers customers={filteredCustomers} data={data} onAdd={() => setModal({ type: 'customer' })} onEdit={(item) => setModal({ type: 'customer', item })} onDelete={(id) => { try { allowCountReductionRef.current = true; setData(deleteCustomer(data, id)); setError('') } catch (problem) { allowCountReductionRef.current = false; setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } }} />}
        {view === 'vehicles' && <Vehicles vehicles={filteredVehicles} customers={data.customers} onAdd={() => { setQuery(''); setModal({ type: 'vehicle' }) }} onEdit={(item) => setModal({ type: 'vehicle', item })} onDelete={(id) => { if (window.confirm('Eliminare definitivamente questa vettura?')) { try { allowCountReductionRef.current = true; setData(deleteVehicle(data, id)); setError('') } catch (problem) { allowCountReductionRef.current = false; setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } } }} onOpenCosts={(vehicleId) => setCostModal({ vehicleId })} updateStatus={updateStatus} customerById={customerById} statusOptions={vehicleStatusOptions} statusLabel={statusLabel} />}
        {view === 'cones' && <Cones data={data} customerById={customerById} onMove={(vehicleId, cone) => { try { setData(moveVehicleCone(data, vehicleId, cone)); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operazione non riuscita.') } }} />}
        {view === 'planner' && <PlannerPage data={data} customerById={customerById} onOpenSettings={() => setView('planner-settings')} onOpenJob={(query) => {
          setView('estimates-jobs')
          setQuery(query)
        }} onOpenOperatorProgram={() => setView('operator-program')} onRecalculatePlanning={() => {
          setData((current) => ({ ...current }))
          setNotice('Pianificazione ricalcolata.')
        }} onMove={(vehicleId: string, date: string) => {
          const vehicle = data.vehicles.find((item) => item.id === vehicleId)
          if (!vehicle) return
          const capacity = calculateDayCapacity(date, data.plannerSettings)
          const hours = remainingHours(vehicle)
          if (hours > capacity.protected && !window.confirm(`La lavorazione richiede ${hours} ore, mentre il ${date} dispone di ${capacity.protected} ore protette. Eccedenza: ${Math.round((hours - capacity.protected) * 100) / 100} ore. Vuoi comunque fissare questa data di inizio?`)) return
          setData({ ...data, vehicles: data.vehicles.map((item) => item.id === vehicleId ? { ...item, manualPlanningDate: date } : item) })
        }} onUpdateVehicleStatus={updateStatus} statusOptions={vehicleStatusOptions} statusLabel={statusLabel} />}
        {view === 'operator-program' && <OperatorProgramPage data={data} onChange={setData} />}
        {view === 'planner-settings' && <PlannerSettingsPage settings={data.plannerSettings} onSave={async (plannerSettings) => {
          const nextData = { ...data, plannerSettings }
          try {
            await saveDatabase(nextData)
            setData(nextData)
            setNotice('Modifiche salvate')
            setError('')
          } catch {
            setError('Salvataggio non riuscito')
            throw new Error('Salvataggio non riuscito')
          }
        }} />}
        {view === 'vehicle-statuses' && <VehicleStatusesSettingsPage settings={data.plannerSettings} vehicles={data.vehicles} onSave={async (plannerSettings) => {
          const nextData = {
            ...data,
            plannerSettings,
            vehicles: data.vehicles.map((vehicle) => ({
              ...vehicle,
              status: resolveVehicleStatusId(plannerSettings, vehicle.status),
              suggestedStatus: vehicle.suggestedStatus ? resolveVehicleStatusId(plannerSettings, vehicle.suggestedStatus) : null,
              statusHistory: (vehicle.statusHistory ?? []).map((entry) => ({
                ...entry,
                from: resolveVehicleStatusId(plannerSettings, entry.from),
                to: resolveVehicleStatusId(plannerSettings, entry.to),
              })),
            })),
          }
          try {
            await saveDatabase(nextData)
            setData(nextData)
            setNotice('Stati vettura salvati.')
            setError('')
          } catch {
            setError('Salvataggio stati vettura non riuscito')
            throw new Error('Salvataggio stati vettura non riuscito')
          }
        }} />}
        {view === 'settings' && <section className="settings-dashboard">
          <div className="welcome settings-welcome">
            <div>
              <span className="eyebrow">IMPOSTAZIONI</span>
              <h2>Dashboard configurazione</h2>
              <p>Seleziona un'area per configurare tempi, orari, listino, costi interni e obiettivi.</p>
            </div>
          </div>
          <div className="settings-card-grid">
            {settingsCards.map((card) => <button key={card.id} className="settings-card" onClick={() => goToView(card.id)}>
              <span>{card.title}</span>
              <strong>{card.description}</strong>
            </button>)}
          </div>
        </section>}
        {view === 'work-hours' && <WorkHoursSettingsPage settings={data.plannerSettings} onSave={async (plannerSettings) => {
          const nextData = { ...data, plannerSettings }
          try {
            await saveDatabase(nextData)
            setData(nextData)
            setNotice('Orari di lavoro salvati.')
            setError('')
          } catch {
            setError('Salvataggio orari non riuscito')
          }
        }} />}
        {view === 'internal-costs' && <InternalCostsSettingsPage settings={data.plannerSettings} onSave={async (internalCostSettings: NonNullable<ErpData['plannerSettings']['internalCostSettings']>) => {
          const nextData = { ...data, plannerSettings: { ...data.plannerSettings, internalCostSettings } }
          try {
            await saveDatabase(nextData)
            setData(nextData)
            setNotice('Costi e tariffe interne salvati.')
            setError('')
          } catch {
            setError('Salvataggio costi interni non riuscito')
            throw new Error('Salvataggio costi interni non riuscito')
          }
        }} />}
        {view === 'monthly-goals' && <MonthlyGoalsSettingsPage data={data} onSave={(plannerSettings) => {
          setData({ ...data, plannerSettings })
          setNotice('Obiettivi salvati e storicizzati.')
        }} />}
        {view === 'database-diagnostics' && <DatabaseDiagnosticsSettingsPage onRefreshSnapshot={async () => {
          const reloaded = await loadDatabase()
          skipNextAutosaveRef.current = true
          skipNextHeavySyncRef.current = true
          setData(reloaded)
        }} setNotice={setNotice} setError={setError} />}
        {view === 'price-list' && <PriceListPage data={data} query={query} onChange={setData} setNotice={setNotice} setError={setError} />}
        {view === 'finance' && <FinancePage data={data} onChange={setData} customerById={customerById} setError={setError} setNotice={setNotice} />}
        {view === 'estimates-jobs' && <WorkflowPage data={data} customerById={customerById} query={query} onChange={setData} setError={setError} setNotice={setNotice} onUpdateVehicleStatus={updateStatus} statusOptions={vehicleStatusOptions} statusLabel={statusLabel} />}
        {view === 'acceptance' && <AcceptancePage data={data} autosaveState={acceptanceAutosaveState} customerById={customerById} onCreate={(customerId, vehicleId) => {
          const draft = createAcceptanceDraft(customerId, vehicleId, data.plannerSettings, new Date().toISOString().slice(0, 7))
          const existing = data.acceptances ?? []
          setData({ ...data, acceptances: [draft, ...existing] })
          return draft.id
        }} onSave={(acceptance) => {
          const existing = data.acceptances ?? []
          setData({ ...data, acceptances: existing.map((item) => item.id === acceptance.id ? acceptance : item) })
        }} onDeleteDraft={(acceptanceId) => {
          allowCountReductionRef.current = true
          const existing = data.acceptances ?? []
          setData({ ...data, acceptances: existing.filter((item) => item.id !== acceptanceId) })
        }} onOpenCustomerModal={(options) => setModal({ type: 'customer', returnToAcceptance: options?.returnToAcceptance, onSavedToAcceptance: options?.onSavedToAcceptance })} onOpenVehicleModal={(options) => setModal({ type: 'vehicle', initialCustomerId: options?.customerId, returnToAcceptance: options?.returnToAcceptance, onSavedToAcceptance: options?.onSavedToAcceptance })} />}
        {view === 'pending-cases' && <AcceptanceCasesPage data={data} customerById={customerById} onSave={(acceptance) => {
          const existing = data.acceptances ?? []
          setData({ ...data, acceptances: existing.map((item) => item.id === acceptance.id ? acceptance : item) })
          setNotice('Pratica aggiornata.')
        }} confirmed={false} />}
        {view === 'confirmed-cases' && <AcceptanceCasesPage data={data} customerById={customerById} onSave={(acceptance) => {
          const existing = data.acceptances ?? []
          setData({ ...data, acceptances: existing.map((item) => item.id === acceptance.id ? acceptance : item) })
          setNotice('Pratica aggiornata.')
        }} confirmed />}
      </div>
    </main>

    {modal?.type === 'customer' && <CustomerForm customer={modal.item} onClose={() => setModal(null)} onSave={async (input) => {
      try {
        const nextData = modal.item
          ? { ...data, customers: updateCustomer(data.customers, modal.item.id, input) }
          : { ...data, customers: [createCustomer(input), ...data.customers] }

        if (modal.returnToAcceptance) {
          await saveDatabase(nextData)
          const reloaded = await loadDatabase()
          const savedCustomerId = modal.item?.id ?? reloaded.customers[0]?.id
          if (!savedCustomerId || !reloaded.customers.some((customer) => customer.id === savedCustomerId)) {
            throw new Error('Salvataggio cliente non riuscito')
          }
          skipNextAutosaveRef.current = true
          skipNextHeavySyncRef.current = true
          setData(reloaded)
          setView('acceptance')
          modal.onSavedToAcceptance?.(savedCustomerId)
          setNotice('Cliente salvato')
        } else {
          setData(nextData)
        }

        setError('')
        setModal(null)
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : 'Salvataggio cliente non riuscito')
      }
    }} setError={setError} />}
    {modal?.type === 'vehicle' && <VehicleForm vehicle={modal.item} initialCustomerId={modal.initialCustomerId} customers={data.customers} statusOptions={vehicleStatusOptions} onClose={() => setModal(null)} onSave={async (input) => {
      try {
        setDuplicateVehicleId(null)
        const result = await saveVehicleWithPersistenceCheck({
          data,
          input,
          currentVehicle: modal.item,
          save: saveDatabase,
          load: loadDatabase,
        })
        skipNextAutosaveRef.current = true
        skipNextHeavySyncRef.current = true
        setData(result.data)
        setQuery('')
        if (modal.returnToAcceptance) {
          setView('acceptance')
          modal.onSavedToAcceptance?.(result.vehicleId)
        } else {
          setView('vehicles')
        }
        setNotice('Vettura salvata')
        setError('')
        setModal(null)
      } catch (problem) {
        const message = problem instanceof Error ? problem.message : 'Salvataggio vettura non riuscito'
        const insertedPlateRaw = String(input.plate ?? '').trim()
        const normalizedPlate = normalizePlate(input.plate)
        const normalizedVin = String(input.vin ?? '').trim().toUpperCase().replace(/\s+/g, '')
        const existing = data.vehicles.find((vehicle) =>
          vehicle.id !== modal.item?.id && (
            normalizePlate(vehicle.plate) === normalizedPlate
            || (normalizedVin && String(vehicle.vin ?? '').trim().toUpperCase().replace(/\s+/g, '') === normalizedVin)
          ),
        )
        if (existing) {
          setDuplicateVehicleId(existing?.id ?? null)
          if (normalizePlate(existing.plate) === normalizedPlate) {
            throw new Error(
              `Questa vettura è già presente nel Parco Veicoli. source=duplicate repository check; targaInserita=${insertedPlateRaw || '-'}; targaNormalizzata=${normalizedPlate || '-'}; conflictVehicleId=${existing.id}; rev=${Math.max(0, Number(data.dbRevision ?? 0))}.`,
            )
          }
          throw new Error('Esiste già una vettura con questo VIN.')
        }
        setError(message)
      }
    }} setError={setError} />}
    {selectedCostVehicle && <VehicleCostModal vehicle={selectedCostVehicle} data={data} onClose={() => setCostModal(null)} onSave={(entry) => {
      setData(addVehicleCostEntry(data, selectedCostVehicle.id, entry))
      setNotice(`Costo commessa registrato per ${selectedCostVehicle.plate}.`)
      setCostModal(null)
    }} />}
  </div>
}

export function PriceListPage({ data, query, onChange, setNotice, setError }: { data: ErpData; query: string; onChange: (next: ErpData) => void; setNotice: (message: string) => void; setError: (message: string) => void }) {
  const list = data.plannerSettings.standardWorkPriceList ?? []
  const history = data.plannerSettings.standardWorkPriceHistory ?? []
  const standardWorks = data.plannerSettings.standardWorks ?? []
  const activeStandardWorks = standardWorks.filter((work) => work.active)
  const [draft, setDraft] = useState<StandardWorkPriceListItem | null>(null)
  const [listQuery, setListQuery] = useState('')
  const [historyWorkFilter, setHistoryWorkFilter] = useState('')
  const draftRef = useRef<StandardWorkPriceListItem | null>(null)

  const updateDraft = (next: StandardWorkPriceListItem | null) => {
    draftRef.current = next
    setDraft(next)
  }

  const visibleList = list.filter((item) => {
    const needle = (listQuery || query).trim().toLowerCase()
    if (!needle) return true
    return [item.panelName, item.workName, item.variantCycle, item.note ?? '', item.repairExtent ?? ''].join(' ').toLowerCase().includes(needle)
  })

  const visibleHistory = history.filter((entry) => {
    if (!historyWorkFilter) return true
    return entry.newValue.workName === historyWorkFilter || entry.previousValue.workName === historyWorkFilter
  })

  const startNew = () => {
    const next: StandardWorkPriceListItem = {
      id: crypto.randomUUID(),
      workId: undefined,
      panelName: '',
      workName: '',
      repairExtent: '',
      variantCycle: '',
      vatRate: 22,
      unitPrice: 0,
      active: true,
      note: '',
    }
    updateDraft(next)
  }

  const persist = async (nextData: ErpData, successMessage: string) => {
    await saveDatabase(nextData)
    const persisted = await loadDatabase()
    onChange(persisted)
    setNotice(successMessage)
  }

  const withHistoryEntry = (source: ErpData, previousValue: StandardWorkPriceListItem, newValue: StandardWorkPriceListItem, operation: 'create' | 'update' | 'activate' | 'deactivate' | 'delete'): ErpData => ({
    ...source,
    plannerSettings: {
      ...source.plannerSettings,
      standardWorkPriceHistory: [{
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        itemId: newValue.id,
        operation,
        previousValue: structuredClone(previousValue),
        newValue: structuredClone(newValue),
      }, ...(source.plannerSettings.standardWorkPriceHistory ?? [])],
    },
  })

  const saveDraft = async () => {
    const currentDraft = draftRef.current
    if (!currentDraft) return
    const selectedWork = standardWorks.find((work) => work.id === currentDraft.workId)
    if (!selectedWork && !currentDraft.workName.trim()) {
      setError('Seleziona una lavorazione.')
      return
    }
    const normalizedDraft: StandardWorkPriceListItem = {
      ...currentDraft,
      panelName: currentDraft.panelName.trim(),
      workId: selectedWork?.id ?? currentDraft.workId,
      workName: selectedWork?.name ?? currentDraft.workName.trim(),
      variantCycle: currentDraft.variantCycle.trim(),
      note: (currentDraft.note ?? '').trim(),
    }
    const existing = list.find((item) => item.id === normalizedDraft.id)
    const nextData = upsertPriceListItem(data, normalizedDraft)
    const previousValue = existing ?? { ...normalizedDraft, active: false, unitPrice: 0 }
    const withHistory = withHistoryEntry(nextData, previousValue, normalizedDraft, existing ? 'update' : 'create')
    try {
      await persist(withHistory, 'Listino prezzi salvato.')
      updateDraft(null)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Salvataggio listino non riuscito.')
    }
  }

  const toggleActive = async (item: StandardWorkPriceListItem) => {
    const nextValue = { ...item, active: !item.active }
    const nextData = setPriceListItemActive(data, item.id, !item.active)
    const withHistory = withHistoryEntry(nextData, item, nextValue, item.active ? 'deactivate' : 'activate')
    try {
      await persist(withHistory, item.active ? 'Voce listino disattivata.' : 'Voce listino attivata.')
      if (draft?.id === item.id) updateDraft(nextValue)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Aggiornamento listino non riuscito.')
    }
  }

  const removeItem = async (item: StandardWorkPriceListItem) => {
    if (!window.confirm('Eliminare questa voce del listino prezzi?')) return
    const nextData = removePriceListItem(data, item.id)
    const withHistory = withHistoryEntry(nextData, item, { ...item, active: false }, 'delete')
    try {
      await persist(withHistory, 'Voce del listino rimossa.')
      updateDraft(null)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Rimozione listino non riuscita.')
    }
  }

  const cleanHistory = async () => {
    if (!window.confirm('Pulire lo storico filtrato del listino?')) return
    const nextHistory = visibleHistory.length === history.length
      ? []
      : history.filter((entry) => !visibleHistory.some((target) => target.id === entry.id))
    const nextData: ErpData = {
      ...data,
      plannerSettings: {
        ...data.plannerSettings,
        standardWorkPriceHistory: nextHistory,
      },
    }
    try {
      await persist(nextData, 'Storico listino pulito.')
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Pulizia storico non riuscita.')
    }
  }

  const workOptions = draft
    ? (() => {
        const options = [...activeStandardWorks]
        const selectedWork = standardWorks.find((work) => work.id === draft.workId)
        if (selectedWork && !selectedWork.active && !options.some((work) => work.id === selectedWork.id)) options.push(selectedWork)
        return options
      })()
    : activeStandardWorks

  return <section className="panel">
    <div className="panel-head">
      <div>
        <span className="eyebrow">LISTINO PREZZI</span>
        <h3>Catalogo prezzi centralizzato</h3>
      </div>
      <button className="primary" onClick={startNew}>+ Nuova voce listino</button>
    </div>

    <label>Cerca nel listino...
      <input placeholder="Cerca nel listino..." value={listQuery} onChange={(event) => setListQuery(event.target.value)} />
    </label>

    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pannello</th>
            <th>Estensione</th>
            <th>Lavorazione</th>
            <th>Variante</th>
            <th>Prezzo</th>
            <th>IVA</th>
            <th>Attiva</th>
            <th>Modifica</th>
          </tr>
        </thead>
        <tbody>
          {visibleList.map((item) => <tr key={item.id}>
            <td>{item.panelName || 'Generico'}</td>
            <td>{item.repairExtent ? (item.repairExtent === 'mezzo' ? 'Mezzo pezzo' : 'Pezzo intero') : 'Tutti'}</td>
            <td>{item.workName || '—'}</td>
            <td>{item.variantCycle || 'Standard'}</td>
            <td>{(item.unitPrice ?? 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</td>
            <td>{item.vatRate ?? 22}%</td>
            <td>{item.active ? '✓' : '—'}</td>
            <td>
              <div className="row-actions">
                <button onClick={() => { updateDraft(item) }}>Modifica</button>
                <button className="secondary" onClick={() => void toggleActive(item)}>{item.active ? 'Disattiva' : 'Attiva'}</button>
                <button className="danger" onClick={() => void removeItem(item)}>Elimina</button>
              </div>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>

    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-head">
        <div>
          <span className="eyebrow">STORICO LISTINO</span>
          <h3>Modifiche registrate</h3>
        </div>
        <button className="secondary" onClick={() => void cleanHistory()}>Pulisci storico</button>
      </div>
      <label>Lavorazione
        <select value={historyWorkFilter} onChange={(event) => setHistoryWorkFilter(event.target.value)}>
          <option value="">Tutte</option>
          {standardWorks.map((work) => <option key={work.id} value={work.name}>{work.name} (storico)</option>)}
        </select>
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Lavorazione</th>
              <th>Pannello</th>
              <th>Operazione</th>
              <th>Nuovo prezzo</th>
            </tr>
          </thead>
          <tbody>
            {visibleHistory.map((entry) => <tr key={entry.id}>
              <td>{new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.at))}</td>
              <td>{entry.newValue.workName}</td>
              <td>{entry.newValue.panelName || 'Generico'}</td>
              <td>{entry.operation ?? 'update'}</td>
              <td>{entry.newValue.unitPrice.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>

    {draft && <Modal title="Modifica voce listino" onClose={() => { updateDraft(null) }}>
      <div className="form-grid">
        <label>Pannello<input value={draft.panelName} onChange={(event) => updateDraft({ ...draft, panelName: event.target.value })} /></label>
        <label>Lavorazione<select value={draft.workId ?? ''} onChange={(event) => {
          const selected = standardWorks.find((work) => work.id === event.target.value)
          updateDraft({ ...draft, workId: selected?.id, workName: selected?.name ?? '' })
        }}><option value="">Seleziona lavorazione</option>{workOptions.map((work) => <option key={work.id} value={work.id}>{work.active ? work.name : `${work.name} (disattivata)`}</option>)}</select></label>
        <label>Estensione<select value={draft.repairExtent ?? ''} onChange={(event) => updateDraft({ ...draft, repairExtent: event.target.value === 'mezzo' || event.target.value === 'intero' ? event.target.value : '' })}><option value="">Tutti</option><option value="intero">Pezzo intero</option><option value="mezzo">Mezzo pezzo</option></select></label>
        <label>Variante/ciclo<input value={draft.variantCycle} onChange={(event) => updateDraft({ ...draft, variantCycle: event.target.value })} /></label>
        <label>Prezzo imponibile<MoneyInput minValue={0} value={draft.unitPrice} onValueChange={(value) => updateDraft({ ...draft, unitPrice: value ?? 0 })} /></label>
        <label>IVA %<input type="number" min="0" step="1" value={draft.vatRate ?? 22} onChange={(event) => updateDraft({ ...draft, vatRate: Number(event.target.value) })} /></label>
        <label>Attiva<input type="checkbox" checked={draft.active} onChange={(event) => updateDraft({ ...draft, active: event.target.checked })} /></label>
        <label className="full">Nota interna<textarea rows={3} value={draft.note ?? ''} onChange={(event) => updateDraft({ ...draft, note: event.target.value })} /></label>
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="primary" onClick={() => void saveDraft()}>Salva</button>
        <button className="secondary" onClick={() => void toggleActive(draft)}>{draft.active ? 'Disattiva' : 'Attiva'}</button>
        <button className="danger" onClick={() => void removeItem(draft)}>Elimina</button>
      </div>
    </Modal>}
  </section>
}

function WorkHoursSettingsPage({ settings, onSave }: { settings: ErpData['plannerSettings']; onSave: (settings: ErpData['plannerSettings']) => Promise<void> }) {
  const [draft, setDraft] = useState(() => ({
    ...structuredClone(settings),
    weeklyWorkSchedule: normalizeWeeklyWorkSchedule(settings.weeklyWorkSchedule ?? DEFAULT_WEEKLY_WORK_SCHEDULE),
    companyClosures: structuredClone(settings.companyClosures ?? []),
  }))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft({
      ...structuredClone(settings),
      weeklyWorkSchedule: normalizeWeeklyWorkSchedule(settings.weeklyWorkSchedule ?? DEFAULT_WEEKLY_WORK_SCHEDULE),
      companyClosures: structuredClone(settings.companyClosures ?? []),
    })
  }, [settings])

  const dayLabel = (day: number) => ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'][day] ?? String(day)
  const updateDay = (dayOfWeek: number, patch: Partial<WeeklyWorkDaySchedule>) => {
    setDraft((current) => ({
      ...current,
      weeklyWorkSchedule: normalizeWeeklyWorkSchedule(current.weeklyWorkSchedule).map((entry) => entry.dayOfWeek === dayOfWeek ? { ...entry, ...patch } : entry),
    }))
  }
  const updateInterval = (dayOfWeek: number, index: number, field: 'startTime' | 'endTime', value: string) => {
    const day = normalizeWeeklyWorkSchedule(draft.weeklyWorkSchedule).find((entry) => entry.dayOfWeek === dayOfWeek)
    if (!day) return
    const nextIntervals = day.intervals.map((interval, intervalIndex) => intervalIndex === index ? { ...interval, [field]: value } : interval)
    updateDay(dayOfWeek, { intervals: nextIntervals })
  }
  const addInterval = (dayOfWeek: number) => {
    const day = normalizeWeeklyWorkSchedule(draft.weeklyWorkSchedule).find((entry) => entry.dayOfWeek === dayOfWeek)
    if (!day) return
    updateDay(dayOfWeek, { intervals: [...day.intervals, { startTime: '08:00', endTime: '12:00' }] })
  }
  const removeInterval = (dayOfWeek: number, index: number) => {
    const day = normalizeWeeklyWorkSchedule(draft.weeklyWorkSchedule).find((entry) => entry.dayOfWeek === dayOfWeek)
    if (!day) return
    updateDay(dayOfWeek, { intervals: day.intervals.filter((_, intervalIndex) => intervalIndex !== index) })
  }
  const updateClosure = (id: string, patch: Partial<CompanyClosureEntry>) => {
    setDraft((current) => ({
      ...current,
      companyClosures: (current.companyClosures ?? []).map((entry) => entry.id === id ? { ...entry, ...patch } : entry),
    }))
  }
  const addClosure = () => {
    setDraft((current) => ({
      ...current,
      companyClosures: [...(current.companyClosures ?? []), { id: crypto.randomUUID(), type: 'chiusura-straordinaria', startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), startTime: '', endTime: '', note: '' }],
    }))
  }

  return <section className="settings-stack">
    <div className="welcome">
      <div>
        <span className="eyebrow">ORARI DI LAVORO</span>
        <h2>Calendario aziendale condiviso</h2>
        <p>Usato da Planner, Programma operatori e previsione del preventivo.</p>
      </div>
      <button className="primary" disabled={saving} onClick={async () => {
        setSaving(true)
        try { await onSave(draft) } finally { setSaving(false) }
      }}>{saving ? 'Salvataggio...' : 'Salva orari'}</button>
    </div>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">ORARI SETTIMANALI</span><h3>Intervalli lavorativi</h3></div></div>
      <div className="settings-list">
        {normalizeWeeklyWorkSchedule(draft.weeklyWorkSchedule).map((day) => <div className="settings-row" key={day.dayOfWeek}>
          <strong>{dayLabel(day.dayOfWeek)}</strong>
          <label className="check"><input type="checkbox" checked={day.active} onChange={(event) => updateDay(day.dayOfWeek, { active: event.target.checked })} /> Attivo</label>
          <small>{day.active ? intervalsToText(day.intervals) || 'Nessun intervallo' : 'Chiuso'}</small>
          <div className="row-actions">
            <button className="secondary" onClick={() => addInterval(day.dayOfWeek)}>+ Intervallo</button>
          </div>
          <div className="full" style={{ display: 'grid', gap: 8 }}>
            {day.intervals.map((interval, index) => <div className="settings-row" key={`${day.dayOfWeek}-${index}`}>
              <input value={interval.startTime} onChange={(event) => updateInterval(day.dayOfWeek, index, 'startTime', event.target.value)} placeholder="08:00" />
              <input value={interval.endTime} onChange={(event) => updateInterval(day.dayOfWeek, index, 'endTime', event.target.value)} placeholder="12:30" />
              <button className="danger" onClick={() => removeInterval(day.dayOfWeek, index)}>Rimuovi</button>
            </div>)}
          </div>
        </div>)}
      </div>
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">CHIUSURE E ASSENZE AZIENDALI</span><h3>Festivita, ferie e mezze giornate</h3></div><button className="secondary" onClick={addClosure}>+ Aggiungi chiusura</button></div>
      <div className="settings-list">
        {(draft.companyClosures ?? []).map((entry) => <div className="settings-row" key={entry.id}>
          <select value={entry.type} onChange={(event) => updateClosure(entry.id, { type: event.target.value as CompanyClosureEntry['type'] })}><option value="festivita">Festivita</option><option value="ferie">Ferie</option><option value="chiusura-straordinaria">Chiusura straordinaria</option><option value="mezza-giornata">Mezza giornata</option><option value="indisponibilita">Indisponibilita</option></select>
          <input type="date" value={entry.startDate} onChange={(event) => updateClosure(entry.id, { startDate: event.target.value })} />
          <input type="date" value={entry.endDate} onChange={(event) => updateClosure(entry.id, { endDate: event.target.value })} />
          <input value={entry.startTime ?? ''} onChange={(event) => updateClosure(entry.id, { startTime: event.target.value })} placeholder="08:00" />
          <input value={entry.endTime ?? ''} onChange={(event) => updateClosure(entry.id, { endTime: event.target.value })} placeholder="12:30" />
          <input value={entry.note} onChange={(event) => updateClosure(entry.id, { note: event.target.value })} placeholder="Nota" />
          <button className="danger" onClick={() => setDraft((current) => ({ ...current, companyClosures: (current.companyClosures ?? []).filter((item) => item.id !== entry.id) }))}>Elimina</button>
        </div>)}
        {!(draft.companyClosures ?? []).length && <small>Nessuna chiusura aziendale configurata.</small>}
      </div>
    </section>
  </section>
}

function Dashboard({ data, setView, onNewVehicle, onNewCustomer }: { data: ErpData; setView: (view: View) => void; onNewVehicle: () => void; onNewCustomer: () => void }) {
  const normalizeStatus = (value: string) => value.trim().toLowerCase()
  const today = new Date().toISOString().slice(0, 10)
  const plusDays = (days: number) => {
    const date = new Date(`${today}T12:00:00`)
    date.setDate(date.getDate() + days)
    return date.toISOString().slice(0, 10)
  }

  const snapshot = calculateExecutiveDashboardSnapshot(data)
  const [overviewPeriod, setOverviewPeriod] = useState<BusinessOverviewPeriod>('mese')
  const overview = calculateBusinessOverviewSnapshot(data, overviewPeriod)
  const monthOverview = calculateBusinessOverviewSnapshot(data, 'mese')
  const rate = (value: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)

  const topKpis = [
    { id: 'monthly-revenue', label: 'Fatturato del mese', value: rate(snapshot.monthlyRevenue), note: 'Totale fatture emesse nel mese in corso.' },
    { id: 'monthly-margin', label: 'Margine del mese', value: rate(monthOverview.current.margin), note: 'Differenza reale tra fatturato e costi del mese.' },
    { id: 'liquidity-collections', label: 'Incassi previsti / Liquidità', value: `${rate(snapshot.projectedCollections.days30)} / ${rate(snapshot.availableLiquidity)}`, note: 'Incassi attesi a 30 giorni rispetto alla liquidità disponibile.' },
    { id: 'late-vehicles', label: 'Auto in ritardo', value: String(snapshot.vehiclesLate), note: 'Vetture oltre la data richiesta e non ancora consegnate.' },
  ]

  const economicChartMax = Math.max(
    1,
    overview.objective,
    ...overview.points.map((point) => Math.max(point.revenue, point.cost, point.margin)),
  )

  const productionStats = [
    { id: 'presenti', label: 'Auto presenti', value: snapshot.vehiclesPresent },
    { id: 'lavorazione', label: 'In lavorazione', value: snapshot.vehiclesInProgress },
    { id: 'pronte', label: 'Pronte', value: snapshot.vehiclesReady },
    { id: 'ritardo', label: 'In ritardo', value: snapshot.vehiclesLate },
    { id: 'consegne-oggi', label: 'Consegne oggi', value: snapshot.todaysDeliveries },
    { id: 'bloccate', label: 'Vetture bloccate', value: snapshot.blockedVehicles },
  ]
  const productionMax = Math.max(1, ...productionStats.map((item) => item.value))

  const openInvoices = data.invoices.filter((invoice) => !['Incassata', 'Stornata'].includes(invoice.status))
  const overdueCollections = openInvoices
    .filter((invoice) => invoice.dueDate < today)
    .reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.collectedAmount), 0)
  const collectionsStats = [
    { id: '30', label: '30 giorni', value: snapshot.projectedCollections.days30 },
    { id: '60', label: '60 giorni', value: snapshot.projectedCollections.days60 },
    { id: '90', label: '90 giorni', value: snapshot.projectedCollections.days90 },
    { id: 'scaduto', label: 'Scaduto', value: overdueCollections },
  ]
  const collectionsMax = Math.max(1, ...collectionsStats.map((item) => item.value))

  const riskLimit = plusDays(2)
  const imminentLimit = plusDays(7)
  const deliveriesAtRisk = data.vehicles.filter((vehicle) =>
    normalizeStatus(vehicle.status) !== 'consegnata'
    && vehicle.requestedDeliveryDate
    && vehicle.requestedDeliveryDate >= today
    && vehicle.requestedDeliveryDate <= riskLimit
    && remainingHours(vehicle) > 0,
  ).length
  const invoicesToIssue = data.vehicles.filter((vehicle) =>
    normalizeStatus(vehicle.status) === 'consegnata'
    && !vehicle.invoiceId,
  ).length
  const imminentInvoices = openInvoices.filter((invoice) => invoice.dueDate >= today && invoice.dueDate <= imminentLimit).length
  const imminentRiba = data.ribaBatches.filter((batch) => !['Chiusa', 'Stornata'].includes(batch.status) && batch.dueDate >= today && batch.dueDate <= imminentLimit).length
  const productionSnapshot = buildTodayInShopSnapshot(data)
  const productionOpenReports = openProductionReports(data).length
  const attentionItems = [
    { id: 'late-vehicles', label: 'Auto in ritardo', count: snapshot.vehiclesLate, detail: 'Verifica priorità e capacità residua del planner.', action: () => setView('vehicles') },
    { id: 'risk-deliveries', label: 'Consegne a rischio', count: deliveriesAtRisk, detail: 'Consegne nei prossimi 2 giorni con ore residue > 0.', action: () => setView('planner') },
    { id: 'to-invoice', label: 'Fatture da emettere', count: invoicesToIssue, detail: 'Vetture consegnate senza fattura collegata.', action: () => setView('finance') },
    { id: 'riba-deadlines', label: 'RIBA / scadenze imminenti', count: imminentInvoices + imminentRiba, detail: 'Scadenze finanziarie nei prossimi 7 giorni.', action: () => setView('finance') },
    { id: 'blocked', label: 'Pratiche bloccate', count: snapshot.blockedVehicles, detail: 'Pratiche ferme per ricambi mancanti o blocchi operativi.', action: () => setView('vehicles') },
    { id: 'production-alerts', label: 'Segnalazioni produzione', count: productionOpenReports, detail: 'Richieste operative inviate dai tablet reparto.', action: () => setView('today-shop') },
    { id: 'production-overdue', label: 'Produzione in ritardo', count: productionSnapshot.overdue, detail: 'Lavorazioni oltre la data promessa cliente.', action: () => setView('today-shop') },
  ].filter((item) => item.count > 0)

  return <>
    <section className="welcome premium-welcome compact-welcome"><div><span className="eyebrow">DASHBOARD TITOLARE</span><h2>Visione sintetica e operativa</h2><p>Vista pulita basata solo su dati reali ERP: economico, produzione, incassi e criticità.</p></div><div className="quick-links"><button className="secondary" onClick={onNewCustomer}><Icon name="plus" /> Nuovo cliente</button><button className="secondary" onClick={onNewVehicle}><Icon name="plus" /> Nuova vettura</button><button className="secondary" onClick={() => setView('finance')}><Icon name="plus" /> Nuova fattura</button><button className="secondary" onClick={() => setView('planner')}><Icon name="planner" /> Planner</button></div></section>

    <section className="owner-kpi-grid">{topKpis.map((kpi) => <article className="owner-kpi-card" key={kpi.id}><span>{kpi.label}</span><strong>{kpi.value}</strong><small>{kpi.note}</small></article>)}</section>

    <section className="panel owner-economy-panel">
      <div className="panel-head"><div><span className="eyebrow">GRAFICO ECONOMICO PRINCIPALE</span><h3>Fatturato, costi, margine e obiettivo</h3></div><div className="segmented"><button className={overviewPeriod === 'oggi' ? 'active' : ''} onClick={() => setOverviewPeriod('oggi')}>Oggi</button><button className={overviewPeriod === 'settimana' ? 'active' : ''} onClick={() => setOverviewPeriod('settimana')}>Settimana</button><button className={overviewPeriod === 'mese' ? 'active' : ''} onClick={() => setOverviewPeriod('mese')}>Mese</button><button className={overviewPeriod === 'anno' ? 'active' : ''} onClick={() => setOverviewPeriod('anno')}>Anno</button></div></div>
      {!overview.hasData ? <div className="empty"><div>◌</div><p>Nessun dato economico disponibile per il periodo selezionato.</p></div> : <><div className="economy-summary-grid"><div className="summary-card"><span>Fatturato</span><strong>{rate(overview.current.revenue)}</strong></div><div className="summary-card"><span>Costi</span><strong>{rate(overview.current.cost)}</strong></div><div className="summary-card"><span>Margine</span><strong>{rate(overview.current.margin)}</strong></div><div className="summary-card"><span>Obiettivo</span><strong>{rate(overview.objective)}</strong></div></div><div className="economy-chart"><div className="economy-objective-row"><span>Obiettivo economico</span><strong>{rate(overview.objective)}</strong></div><div className="economy-bars">{overview.points.map((point) => <div className="economy-bar-col" key={point.label}><div className="economy-bar-track"><i className="objective" style={{ bottom: `${Math.min(100, (overview.objective / economicChartMax) * 100)}%` }} /><i className="revenue" style={{ height: `${Math.max(4, (point.revenue / economicChartMax) * 100)}%` }} /><i className="cost" style={{ height: `${Math.max(4, (point.cost / economicChartMax) * 100)}%` }} /><i className="margin" style={{ height: `${Math.max(4, (point.margin / economicChartMax) * 100)}%` }} /></div><small>{point.label}</small></div>)}</div><div className="economy-legend"><span><i className="revenue" /> Fatturato</span><span><i className="cost" /> Costi</span><span><i className="margin" /> Margine</span><span><i className="objective" /> Obiettivo</span></div></div></>}
    </section>

    <section className="owner-secondary-grid">
      <section className="panel owner-production-panel"><div className="panel-head"><div><span className="eyebrow">GRAFICO STATO PRODUZIONE</span><h3>Carico operativo corrente</h3></div></div><div className="metric-bars">{productionStats.map((item) => <div className="metric-bar-row" key={item.id}><span>{item.label}</span><div className="metric-bar-track"><i style={{ width: `${Math.max(6, (item.value / productionMax) * 100)}%` }} /></div><strong>{item.value}</strong></div>)}</div></section>
      <section className="panel owner-collections-panel"><div className="panel-head"><div><span className="eyebrow">GRAFICO INCASSI</span><h3>Scadenze e previsione</h3></div></div><div className="collections-chart">{collectionsStats.map((item) => <div className="collections-col" key={item.id}><div className="collections-track"><i style={{ height: `${Math.max(8, (item.value / collectionsMax) * 100)}%` }} /></div><strong>{rate(item.value)}</strong><small>{item.label}</small></div>)}</div></section>
    </section>

    <section className="panel owner-attention-panel">
      <div className="panel-head"><div><span className="eyebrow">RICHIEDE ATTENZIONE</span><h3>Solo elementi con intervento reale</h3></div></div>
      {attentionItems.length ? <div className="attention-list">{attentionItems.map((item) => <button className="attention-item" key={item.id} onClick={item.action}><div><strong>{item.label}</strong><small>{item.detail}</small></div><b>{item.count}</b></button>)}</div> : <div className="empty-small">Nessuna criticità attiva al momento.</div>}
    </section>
  </>
}

function Customers({ customers, data, onAdd, onEdit, onDelete }: { customers: Customer[]; data: ErpData; onAdd: () => void; onEdit: (customer: Customer) => void; onDelete: (id: string) => void }) {
  return <div className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">ANAGRAFICA</span><h3>{customers.length} clienti</h3></div><button className="primary" onClick={onAdd}><Icon name="plus" /> Nuovo cliente</button></div>
    <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Tipo</th><th>Contatti</th><th>Codice fiscale / P.IVA</th><th>Veicoli</th><th>Azioni</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id}><td><strong>{customer.name}</strong><small>{customer.address || 'Indirizzo non indicato'}</small></td><td><span className="tag">{customer.type}</span></td><td>{customer.phone}<small>{customer.email || 'Email non indicata'}</small></td><td>{customer.taxId || '—'}</td><td><b className="count">{data.vehicles.filter((vehicle) => vehicle.customerId === customer.id).length}</b></td><td><div className="row-actions"><button onClick={() => onEdit(customer)}>Modifica</button><button className="danger" onClick={() => { if (window.confirm(`Eliminare il cliente ${customer.name}?`)) onDelete(customer.id) }}>Elimina</button></div></td></tr>)}</tbody></table></div>{!customers.length && <Empty text="Nessun cliente trovato. Crea la prima anagrafica." />}</div>
}

function Vehicles({ vehicles, customers, onAdd, onEdit, onDelete, onOpenCosts, updateStatus, customerById, statusOptions, statusLabel }: { vehicles: Vehicle[]; customers: Customer[]; onAdd: () => void; onEdit: (vehicle: Vehicle) => void; onDelete: (id: string) => void; onOpenCosts: (id: string) => void; updateStatus: (id: string, status: VehicleStatus) => void; customerById: (id: string) => Customer | undefined; statusOptions: Array<{ id: string; label: string }>; statusLabel: (status: VehicleStatus) => string }) {
  return <div className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">PARCO VEICOLI</span><h3>{vehicles.length} vetture</h3></div><button className="primary" onClick={onAdd} disabled={!customers.length} title={!customers.length ? 'Crea prima un cliente' : ''}><Icon name="plus" /> Nuova vettura</button></div>
    <div className="table-wrap"><table><thead><tr><th>Vettura</th><th>Cliente</th><th>Stato operativo</th><th>Cono</th><th>Dati</th><th>Azioni</th></tr></thead><tbody>{vehicles.map((vehicle) => { const options = statusOptions.some((item) => item.id === vehicle.status) ? statusOptions : [...statusOptions, { id: vehicle.status, label: statusLabel(vehicle.status) }]; return <tr key={vehicle.id}><td><strong className="plate">{vehicle.plate}</strong><small>{vehicle.make} {vehicle.model} · {vehicle.color || 'Colore n/d'}</small></td><td>{customerById(vehicle.customerId)?.name}</td><td><select className={`status status-${String(vehicle.status).toLowerCase().replaceAll(' ', '-')}`} value={vehicle.status} onChange={(event) => updateStatus(vehicle.id, event.target.value as VehicleStatus)}>{options.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select><small>{vehicle.statusMode === 'manual' ? 'Override manuale' : (vehicle.suggestedStatus ? `Suggerito: ${statusLabel(vehicle.suggestedStatus)}` : 'Suggerimento automatico')}</small></td><td>{vehicle.coneNumber ? <b className="cone-badge">{vehicle.coneNumber}</b> : <small>{coneLabel(vehicle)}</small>}</td><td>{vehicle.year || 'Anno n/d'}<small>{vehicle.mileage ? `${vehicle.mileage} km` : 'Km n/d'}</small></td><td><div className="row-actions"><button onClick={() => onEdit(vehicle)}>Modifica</button><button onClick={() => onOpenCosts(vehicle.id)}>Costi</button><button className="danger" onClick={() => onDelete(vehicle.id)}>Elimina</button></div></td></tr>})}</tbody></table></div>{!vehicles.length && <Empty text={customers.length ? 'Nessuna vettura trovata. Registrane una nuova.' : 'Crea prima un cliente, poi potrai registrare la sua vettura.'} />}</div>
}

function VehicleCostModal({ vehicle, data, onClose, onSave }: { vehicle: Vehicle; data: ErpData; onClose: () => void; onSave: (entry: Omit<NonNullable<Vehicle['costEntries']>[number], 'id' | 'createdAt' | 'updatedAt'>) => void }) {
  const money = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
  const snapshot = calculateVehicleEconomicSnapshot(vehicle, data.financeSettings)
  const [form, setForm] = useState({
      usedAt: new Date().toISOString().slice(0, 10),
    category: 'ricambi' as VehicleCostCategory,
    description: '',
    supplier: '',
    quantity: '1',
    unit: 'pz',
       unitCost: '0.00',
    discount: '0.00',
    vatRate: String(data.financeSettings.defaultVatRate ?? 22),
    note: '',
  })
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }))
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const quantity = Math.max(0, Number(form.quantity) || 0)
    const unitCost = Math.max(0, parseMoney(form.unitCost))
    const discount = Math.max(0, parseMoney(form.discount))
    const description = form.description.trim()
    if (!description) return
    onSave({
      usedAt: form.usedAt,
      category: form.category as VehicleCostCategory,
      description,
      supplier: form.supplier.trim(),
      quantity,
      unit: form.unit.trim() || 'pz',
      unitCost,
      discount,
      total: Math.round((quantity * unitCost - discount + Number.EPSILON) * 100) / 100,
      vatRate: Number(form.vatRate) || data.financeSettings.defaultVatRate,
      note: form.note.trim(),
    })
  }
  return <Modal title={`Materiali e costi · ${vehicle.plate}`} onClose={onClose}><div className="cost-modal"><div className="summary-grid"><div className="summary-card"><span>Ricavo previsto</span><strong>{money(snapshot.taxableRevenue)}</strong></div><div className="summary-card"><span>Costi diretti</span><strong>{money(snapshot.totalDirectCosts)}</strong></div><div className="summary-card"><span>Margine reale</span><strong>{money(snapshot.realMargin)}</strong></div><div className="summary-card"><span>Margine %</span><strong>{snapshot.grossMarginPercent}%</strong></div></div><form className="cost-form" onSubmit={submit}><label>Data<input type="date" value={form.usedAt} onChange={(event) => update('usedAt', event.target.value)} /></label><label>Categoria<select value={form.category} onChange={(event) => update('category', event.target.value)}><option value="ricambi">Ricambi</option><option value="vernice">Vernice</option><option value="trasparente">Trasparente</option><option value="fondo">Fondo</option><option value="stucco">Stucco</option><option value="carta abrasiva">Carta abrasiva</option><option value="nastro e materiale da mascheratura">Nastro e materiale da mascheratura</option><option value="minuteria">Minuteria</option><option value="materiali di lucidatura">Materiali di lucidatura</option><option value="lavorazioni esterne">Lavorazioni esterne</option><option value="lavaggio">Lavaggio</option><option value="trasporto">Trasporto</option><option value="smaltimento">Smaltimento</option><option value="altro">Altro</option></select></label><label>Descrizione<input required value={form.description} onChange={(event) => update('description', event.target.value)} /></label><label>Fornitore<input value={form.supplier} onChange={(event) => update('supplier', event.target.value)} /></label><label>Quantità<input type="number" min="0" step="0.01" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} /></label><label>Unità<input value={form.unit} onChange={(event) => update('unit', event.target.value)} /></label><label>Prezzo unitario<input type="text" inputMode="decimal" value={form.unitCost} onChange={(event) => update('unitCost', event.target.value)} /></label><label>Sconto<input type="text" inputMode="decimal" value={form.discount} onChange={(event) => update('discount', event.target.value)} /></label><label>IVA %<input type="number" min="0" step="1" value={form.vatRate} onChange={(event) => update('vatRate', event.target.value)} /></label><label>Nota<textarea value={form.note} onChange={(event) => update('note', event.target.value)} /></label><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Chiudi</button><button className="primary">Salva costo</button></div></form>{vehicle.costEntries?.length ? <div className="entry-list"><h4>Costi già registrati</h4>{vehicle.costEntries.slice().reverse().map((entry) => <div className="entry-item" key={entry.id}><strong>{entry.description}</strong><span>{entry.category} · {entry.quantity} {entry.unit} · {money(entry.total)}</span></div>)}</div> : <div className="empty"><div>◌</div><p>Nessun costo registrato per questa commessa.</p></div>}</div></Modal>
}

function Cones({ data, customerById, onMove }: { data: ErpData; customerById: (id: string) => Customer | undefined; onMove: (id: string, cone: number | null) => void }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [filter, setFilter] = useState<'Tutti' | 'Liberi' | 'Occupati'>('Tutti')
  const occupied = data.vehicles.filter((vehicle) => vehicle.coneNumber !== null)
  const waitingVehicles = data.vehicles
    .filter((item) => isVehicleWaitingForCone(item))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const cones = useMemo(() => Array.from({ length: TOTAL_CONES }, (_, i) => i + 1).filter((number) => filter === 'Tutti' || (filter === 'Occupati') === occupied.some((vehicle) => vehicle.coneNumber === number)), [filter, occupied])
  const vehicle = occupied.find((item) => item.coneNumber === selected)
  return <>
    <section className="cone-summary"><div><span>Coni occupati</span><strong>{occupied.length}</strong></div><div><span>Coni liberi</span><strong>{TOTAL_CONES - occupied.length}</strong></div><div className="occupancy"><span>Occupazione piazzale</span><strong>{Math.round(occupied.length / TOTAL_CONES * 100)}%</strong><i><b style={{ width: `${occupied.length / TOTAL_CONES * 100}%` }} /></i></div></section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">MAPPA PIAZZALE</span><h3>Coni da 1 a 30</h3></div><div className="segmented">{(['Tutti', 'Liberi', 'Occupati'] as const).map((item) => <button className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div></div>
      <div className="cone-grid">{cones.map((number) => { const assigned = occupied.find((item) => item.coneNumber === number); return <button onClick={() => setSelected(number)} className={`cone-card ${assigned ? 'busy' : ''}`} key={number}><span>CONO</span><strong>{number}</strong>{assigned ? <><b className="plate">{assigned.plate}</b><small>{assigned.make} {assigned.model}</small></> : <b className="available">LIBERO</b>}</button> })}</div>
    </section>
    <section className="panel history"><div className="panel-head"><div><span className="eyebrow">REGISTRO NON MODIFICABILE</span><h3>Storico assegnazioni</h3></div></div><div className="table-wrap"><table><thead><tr><th>Data e ora</th><th>Evento</th><th>Cono</th><th>Vettura</th><th>Nota</th></tr></thead><tbody>{data.coneHistory.map((item) => { const itemVehicle = data.vehicles.find((entry) => entry.id === item.vehicleId); return <tr key={item.id}><td>{formatDate(item.timestamp)}</td><td><span className="tag">{item.action}</span></td><td><b className="cone-badge">{item.coneNumber}</b></td><td><strong className="plate">{item.vehiclePlate}</strong><small>{itemVehicle ? customerById(itemVehicle.customerId)?.name : 'Vettura rimossa'}</small></td><td>{item.note}</td></tr> })}</tbody></table></div>{!data.coneHistory.length && <Empty text="Nessuna assegnazione registrata." />}</section>
    {selected !== null && <Modal title={`Cono ${selected}`} onClose={() => setSelected(null)}>{vehicle ? <div className="cone-detail"><div className="detail-plate">{vehicle.plate}</div><dl><div><dt>Vettura</dt><dd>{vehicle.make} {vehicle.model}</dd></div><div><dt>Cliente</dt><dd>{customerById(vehicle.customerId)?.name}</dd></div><div><dt>Stato</dt><dd>{vehicle.status}</dd></div></dl><label>Sposta manualmente su un cono libero<select defaultValue="" onChange={(event) => { onMove(vehicle.id, Number(event.target.value)); setSelected(null) }}><option value="" disabled>Seleziona nuovo cono</option>{Array.from({ length: TOTAL_CONES }, (_, i) => i + 1).filter((cone) => !occupied.some((entry) => entry.coneNumber === cone)).map((cone) => <option value={cone} key={cone}>Cono {cone}</option>)}</select></label><button type="button" className="secondary" onClick={() => { onMove(vehicle.id, null); setSelected(null) }}>Libera cono manualmente</button></div> : <div className="cone-detail"><div className="detail-plate">Cono libero</div><p>Assegna manualmente questo cono a una vettura in attesa.</p>{waitingVehicles.length ? <label>Vettura in attesa cono<select defaultValue="" onChange={(event) => { const selectedVehicle = event.target.value; if (!selectedVehicle) return; onMove(selectedVehicle, selected); setSelected(null) }}><option value="" disabled>Seleziona vettura</option>{waitingVehicles.map((item) => <option value={item.id} key={item.id}>{item.plate} · {customerById(item.customerId)?.name || 'Cliente'}</option>)}</select></label> : <div className="empty modal-empty"><b>Nessun cono disponibile</b><p>Non ci sono vetture in coda In attesa cono.</p></div>}</div>}</Modal>}
  </>
}

function CustomerForm({ customer, onClose, onSave, setError }: { customer?: Customer; onClose: () => void; onSave: (customer: Omit<Customer, 'id' | 'createdAt'>) => void; setError: (error: string) => void }) {
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { onSave({ type: form.get('type') as CustomerType, name: String(form.get('name')), phone: String(form.get('phone')), email: String(form.get('email')), taxId: String(form.get('taxId')), address: String(form.get('address')) }); setError('') } catch (problem) { setError(problem instanceof Error ? problem.message : 'Dati non validi.') } }
  return <Modal title={customer ? 'Modifica cliente' : 'Nuovo cliente'} onClose={onClose}><form onSubmit={submit} className="form-grid"><label>Tipo cliente<select name="type" defaultValue={customer?.type ?? 'Privato'}><option>Privato</option><option>Azienda</option></select></label><label>Nome / ragione sociale<input name="name" required autoFocus defaultValue={customer?.name} /></label><label>Telefono<input name="phone" required inputMode="tel" defaultValue={customer?.phone} /></label><label>Email<input name="email" type="email" defaultValue={customer?.email} /></label><label>Codice fiscale / P.IVA<input name="taxId" defaultValue={customer?.taxId} /></label><label>Indirizzo<input name="address" defaultValue={customer?.address} /></label><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Annulla</button><button className="primary">Salva cliente</button></div></form></Modal>
}

function VehicleForm({ vehicle, initialCustomerId, customers, statusOptions, onClose, onSave, setError }: { vehicle?: Vehicle; initialCustomerId?: string; customers: Customer[]; statusOptions: Array<{ id: string; label: string }>; onClose: () => void; onSave: (vehicle: Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'>) => Promise<void> | void; setError: (error: string) => void }) {
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); try {
    const estimatedHours = vehicle?.estimatedHours ?? 0
    const workedHours = vehicle?.workedHours ?? 0
    const expectedRevenue = vehicle?.expectedRevenue ?? 0
    const expectedMargin = vehicle?.expectedMargin ?? 0
    const status = (vehicle?.status ?? statusOptions[0]?.id ?? 'accettata') as VehicleStatus
    const priority = vehicle?.priority ?? 'Normale'
    const plannedEntryDate = vehicle?.plannedEntryDate ?? ''
    const requestedDeliveryDate = vehicle?.requestedDeliveryDate ?? ''
    const deliveryDate = vehicle?.deliveryDate ?? requestedDeliveryDate
    const partsStatus = vehicle?.partsStatus ?? 'Disponibili'
    const blockReason = vehicle?.blockReason ?? ''
    const manualPlanningDate = vehicle?.manualPlanningDate ?? ''
    const calculatedDeliveryDate = vehicle?.calculatedDeliveryDate ?? ''
    if ([estimatedHours, workedHours, expectedRevenue, expectedMargin].some((value) => value < 0)) throw new Error('Ore e importi non possono essere negativi.')
    if (workedHours > estimatedHours) throw new Error('Le ore lavorate non possono superare quelle preventivate.')
    await onSave({ customerId: String(form.get('customerId')), plate: String(form.get('plate')), make: String(form.get('make')), model: String(form.get('model')), color: String(form.get('color')), year: String(form.get('year')), vin: String(form.get('vin')), mileage: String(form.get('mileage')), status, priority, deliveryDate, estimatedHours, workedHours, plannedEntryDate, requestedDeliveryDate, calculatedDeliveryDate, expectedRevenue, expectedMargin, partsStatus, blockReason, manualPlanningDate }); setError('')
  } catch (problem) { setError(problem instanceof Error ? problem.message : 'Dati non validi.') } finally { setSaving(false) } }
  return <Modal title={vehicle ? 'Modifica vettura' : 'Nuova vettura'} onClose={onClose}><form onSubmit={submit} className="form-grid"><label>Cliente<select name="customerId" required defaultValue={vehicle?.customerId ?? initialCustomerId ?? ''}><option value="">Seleziona cliente</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label><label>Targa<input name="plate" required autoFocus className="uppercase" placeholder="AB123CD" defaultValue={vehicle?.plate} /></label><label>Marca<input name="make" defaultValue={vehicle?.make} /></label><label>Modello<input name="model" defaultValue={vehicle?.model} /></label><label>Colore<input name="color" defaultValue={vehicle?.color} /></label><label>Anno<input name="year" inputMode="numeric" defaultValue={vehicle?.year} /></label><label>Telaio<input name="vin" defaultValue={vehicle?.vin} /></label><label>Chilometraggio<input name="mileage" inputMode="numeric" defaultValue={vehicle?.mileage} /></label><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Annulla</button><button className="primary" disabled={saving}>{saving ? 'Salvataggio...' : 'Salva vettura'}</button></div></form></Modal>
}

function AcceptancePage({ data, autosaveState, customerById, onCreate, onSave, onDeleteDraft, onOpenCustomerModal, onOpenVehicleModal }: { data: ErpData; autosaveState: 'idle' | 'saving' | 'saved'; customerById: (id: string) => Customer | undefined; onCreate: (customerId: string, vehicleId: string) => string; onSave: (acceptance: AcceptanceCase) => void; onDeleteDraft: (acceptanceId: string) => void; onOpenCustomerModal: (options?: { returnToAcceptance?: boolean; onSavedToAcceptance?: (customerId: string) => void }) => void; onOpenVehicleModal: (options?: { customerId?: string; returnToAcceptance?: boolean; onSavedToAcceptance?: (vehicleId: string) => void }) => void }) {
  const acceptances = useMemo(() => data.acceptances ?? [], [data.acceptances])
  const draftPractices = useMemo(
    () => acceptances
      .filter((item) => item.status === 'draft')
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [acceptances],
  )
  const [selectedId, setSelectedId] = useState<string>('')
  const [draftRestoreNotice, setDraftRestoreNotice] = useState('')
  const [customerQuery, setCustomerQuery] = useState('')
  const [vehicleQuery, setVehicleQuery] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('')
  const [customerEditing, setCustomerEditing] = useState(false)
  const [vehicleEditing, setVehicleEditing] = useState(false)
  const [openCustomerDetailsRequest, setOpenCustomerDetailsRequest] = useState(false)
  const [openVehicleDetailsRequest, setOpenVehicleDetailsRequest] = useState(false)
  const [pendingCustomerDocumentForOcr, setPendingCustomerDocumentForOcr] = useState<{ file: File; targetAcceptanceId: string } | null>(null)
  const [pendingVehicleBookletForOcr, setPendingVehicleBookletForOcr] = useState<{ file: File; targetAcceptanceId: string } | null>(null)
  const [vehicleBookletPreview, setVehicleBookletPreview] = useState<{ fileName: string; previewUrl: string | null } | null>(null)
  const customerDocumentInputRef = useRef<HTMLInputElement | null>(null)
  const vehicleBookletInputRef = useRef<HTMLInputElement | null>(null)
  const draftAutoRestoreDoneRef = useRef(false)
  const selected = acceptances.find((item) => item.id === selectedId)
  const saveStatusText = autosaveState === 'saving' ? 'Salvataggio...' : 'Bozza salvata'

  const revokePreview = (preview: { previewUrl: string | null } | null) => {
    if (!preview?.previewUrl || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
    URL.revokeObjectURL(preview.previewUrl)
  }

  const buildPreview = (file: File) => ({
    fileName: file.name,
    previewUrl: typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null,
  })

  const customerMatches = useMemo(() => {
    const needle = customerQuery.trim().toLowerCase()
    return data.customers.filter((customer) => !needle || `${customer.name} ${customer.phone} ${customer.email}`.toLowerCase().includes(needle))
  }, [customerQuery, data.customers])

  const vehicleMatches = useMemo(() => {
    const needle = vehicleQuery.trim().toLowerCase()
    return data.vehicles.filter((vehicle) => {
      if (selectedCustomerId && vehicle.customerId !== selectedCustomerId) return false
      if (!needle) return true
      const customer = customerById(vehicle.customerId)
      return `${vehicle.plate} ${vehicle.make} ${vehicle.model} ${vehicle.vin} ${vehicle.year} ${vehicle.color} ${customer?.name ?? ''}`.toLowerCase().includes(needle)
    })
  }, [customerById, data.vehicles, selectedCustomerId, vehicleQuery])

  useEffect(() => {
    if (selectedId && acceptances.some((item) => item.id === selectedId)) return
    if (selectedId) setSelectedId('')
  }, [acceptances, selectedId])

  useEffect(() => {
    if (selected) {
      setSelectedCustomerId(selected.customerId)
      setSelectedVehicleId(selected.vehicleId)
      return
    }
    if (!draftPractices.length || draftAutoRestoreDoneRef.current) return
    const latestDraft = draftPractices[0]
    setSelectedId(latestDraft.id)
    setSelectedCustomerId(latestDraft.customerId)
    setSelectedVehicleId(latestDraft.vehicleId)
    setCustomerEditing(false)
    setVehicleEditing(false)
    setDraftRestoreNotice('Bozza ripristinata automaticamente')
    draftAutoRestoreDoneRef.current = true
  }, [draftPractices, selected])

  useEffect(() => {
    if (selectedCustomerId && data.customers.some((customer) => customer.id === selectedCustomerId)) return
    if (selectedCustomerId) setSelectedCustomerId('')
  }, [data.customers, selectedCustomerId])

  useEffect(() => {
    if (!selectedCustomerId) {
      if (selectedVehicleId) setSelectedVehicleId('')
      return
    }
    const matchingVehicles = data.vehicles.filter((vehicle) => vehicle.customerId === selectedCustomerId)
    if (matchingVehicles.some((vehicle) => vehicle.id === selectedVehicleId)) return
    if (selectedVehicleId) setSelectedVehicleId('')
  }, [data.vehicles, selectedCustomerId, selectedVehicleId])

  const createFromSelection = () => {
    if (!selectedCustomerId || !selectedVehicleId) return
    const createdId = onCreate(selectedCustomerId, selectedVehicleId)
    setSelectedId(createdId)
    setCustomerEditing(false)
    setVehicleEditing(false)
    setDraftRestoreNotice('')
    draftAutoRestoreDoneRef.current = true
  }

  const resumeDraft = () => {
    const latestDraft = draftPractices[0]
    if (!latestDraft) return
    setSelectedId(latestDraft.id)
    setSelectedCustomerId(latestDraft.customerId)
    setSelectedVehicleId(latestDraft.vehicleId)
    setOpenCustomerDetailsRequest(false)
    setOpenVehicleDetailsRequest(false)
    setCustomerEditing(false)
    setVehicleEditing(false)
    setDraftRestoreNotice('Bozza in corso ripristinata')
  }

  const startNewAcceptance = () => {
    setSelectedId('')
    setSelectedCustomerId('')
    setSelectedVehicleId('')
    setOpenCustomerDetailsRequest(false)
    setOpenVehicleDetailsRequest(false)
    setCustomerQuery('')
    setVehicleQuery('')
    setCustomerEditing(false)
    setVehicleEditing(false)
    setDraftRestoreNotice('')
    draftAutoRestoreDoneRef.current = true
  }

  const deleteDraft = () => {
    const targetDraft = selected && selected.status === 'draft' ? selected : draftPractices[0]
    if (!targetDraft) return
    onDeleteDraft(targetDraft.id)
    if (selectedId === targetDraft.id) setSelectedId('')
    setOpenCustomerDetailsRequest(false)
    setOpenVehicleDetailsRequest(false)
    setDraftRestoreNotice('Bozza eliminata')
  }

  const currentCustomer = data.customers.find((customer) => customer.id === selectedCustomerId)
  const currentVehicle = data.vehicles.find((vehicle) => vehicle.id === selectedVehicleId)

  const ensureCustomerDocumentTargetAcceptance = () => {
    let targetAcceptanceId = selected?.id ?? draftPractices[0]?.id ?? ''

    if (!selected?.id && targetAcceptanceId) {
      const restoredDraft = draftPractices.find((item) => item.id === targetAcceptanceId)
      if (restoredDraft) {
        setSelectedId(restoredDraft.id)
        setSelectedCustomerId(restoredDraft.customerId)
        setSelectedVehicleId(restoredDraft.vehicleId)
        draftAutoRestoreDoneRef.current = true
      }
    }

    if (!targetAcceptanceId && selectedCustomerId && selectedVehicleId) {
      targetAcceptanceId = onCreate(selectedCustomerId, selectedVehicleId)
      setSelectedId(targetAcceptanceId)
      setDraftRestoreNotice('')
      draftAutoRestoreDoneRef.current = true
    }

    if (!targetAcceptanceId) {
      setDraftRestoreNotice('Seleziona cliente e vettura, poi acquisisci documento')
      return ''
    }

    setDraftRestoreNotice('')
    return targetAcceptanceId
  }

  const ensureVehicleBookletTargetAcceptance = () => {
    let targetAcceptanceId = selected?.id ?? draftPractices[0]?.id ?? ''

    if (!selected?.id && targetAcceptanceId) {
      const restoredDraft = draftPractices.find((item) => item.id === targetAcceptanceId)
      if (restoredDraft) {
        setSelectedId(restoredDraft.id)
        setSelectedCustomerId(restoredDraft.customerId)
        setSelectedVehicleId(restoredDraft.vehicleId)
        draftAutoRestoreDoneRef.current = true
      }
    }

    if (!targetAcceptanceId && selectedCustomerId && selectedVehicleId) {
      targetAcceptanceId = onCreate(selectedCustomerId, selectedVehicleId)
      setSelectedId(targetAcceptanceId)
      setDraftRestoreNotice('')
      draftAutoRestoreDoneRef.current = true
    }

    if (!targetAcceptanceId) {
      setDraftRestoreNotice('Seleziona cliente e vettura, poi acquisisci libretto')
      return ''
    }

    setDraftRestoreNotice('')
    return targetAcceptanceId
  }

  const handleCustomerDocumentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setCustomerEditing(false)
    let targetAcceptanceId = ensureCustomerDocumentTargetAcceptance()
    if (!targetAcceptanceId) {
      const fallbackCustomerId = selectedCustomerId || data.customers[0]?.id || ''
      const fallbackVehicleId = selectedVehicleId
        || data.vehicles.find((vehicle) => vehicle.customerId === fallbackCustomerId)?.id
        || data.vehicles[0]?.id
        || ''

      const createdFallbackAcceptanceId = onCreate(fallbackCustomerId, fallbackVehicleId)
      targetAcceptanceId = createdFallbackAcceptanceId
      setSelectedId(createdFallbackAcceptanceId)
      if (fallbackCustomerId) setSelectedCustomerId(fallbackCustomerId)
      if (fallbackVehicleId) setSelectedVehicleId(fallbackVehicleId)
      setDraftRestoreNotice('')
      draftAutoRestoreDoneRef.current = true
    }
    setPendingCustomerDocumentForOcr({ file, targetAcceptanceId })
    queueDocumentCaptureFile(file)
    setOpenCustomerDetailsRequest(true)
    event.target.value = ''
  }

  const openVehicleBookletAcquisition = () => {
    setVehicleEditing(false)
    vehicleBookletInputRef.current?.click()
  }

  const openVehicleManualEntry = () => {
    onOpenVehicleModal({
      customerId: selectedCustomerId || undefined,
      returnToAcceptance: true,
      onSavedToAcceptance: (vehicleId) => {
        setSelectedVehicleId(vehicleId)
        setVehicleEditing(false)
      },
    })
  }

  const openCustomerManualEntry = () => {
    onOpenCustomerModal({
      returnToAcceptance: true,
      onSavedToAcceptance: (customerId) => {
        setSelectedCustomerId(customerId)
        setCustomerEditing(false)
      },
    })
  }

  const handleVehicleBookletChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setVehicleEditing(false)
    let targetAcceptanceId = ensureVehicleBookletTargetAcceptance()
    if (!targetAcceptanceId) {
      const fallbackCustomerId = selectedCustomerId || data.customers[0]?.id || ''
      const fallbackVehicleId = selectedVehicleId
        || data.vehicles.find((vehicle) => vehicle.customerId === fallbackCustomerId)?.id
        || data.vehicles[0]?.id
        || ''

      const createdFallbackAcceptanceId = onCreate(fallbackCustomerId, fallbackVehicleId)
      targetAcceptanceId = createdFallbackAcceptanceId
      setSelectedId(createdFallbackAcceptanceId)
      if (fallbackCustomerId) setSelectedCustomerId(fallbackCustomerId)
      if (fallbackVehicleId) setSelectedVehicleId(fallbackVehicleId)
      setDraftRestoreNotice('')
      draftAutoRestoreDoneRef.current = true
    }

    setPendingVehicleBookletForOcr({ file, targetAcceptanceId })
    setOpenVehicleDetailsRequest(true)
    setVehicleBookletPreview((current) => {
      revokePreview(current)
      return buildPreview(file)
    })
    event.target.value = ''
  }

  useEffect(() => () => {
    revokePreview(vehicleBookletPreview)
  }, [vehicleBookletPreview])

  const renderCustomerCompact = () => currentCustomer ? (
    <div className="summary-card">
      <span>Cliente</span>
      <strong>{currentCustomer.name} - {currentCustomer.phone || 'Telefono n/d'}</strong>
      <button type="button" className="secondary" onClick={() => setCustomerEditing(true)}>Verifica / modifica dati cliente</button>
    </div>
  ) : null

  const renderVehicleCompact = () => currentVehicle ? (
    <div className="summary-card">
      <span>Vettura</span>
      <strong>{currentVehicle.plate} - {currentVehicle.make || 'Marca n/d'} - {currentVehicle.model || 'Modello n/d'}</strong>
      <button type="button" className="secondary" onClick={() => setVehicleEditing(true)}>Verifica / modifica dati vettura</button>
    </div>
  ) : null

  return <section className="panel">
    <div className="welcome">
      <div>
        <span className="eyebrow">ACCETTAZIONE</span>
        <h2>Nuova accettazione</h2>
        <p>Flusso rapido: documento, libretto, foto vettura/danni + quadro strumenti, accessori, firma e passaggio successivo.</p>
        <small className="acceptance-draft-state" aria-live="polite">{saveStatusText}</small>
        {draftRestoreNotice && <small className="acceptance-draft-note" aria-live="polite">{draftRestoreNotice}</small>}
      </div>
      <div className="planner-actions acceptance-quick-actions">
        {!!draftPractices.length && <>
          <button type="button" className="secondary" onClick={resumeDraft}>Riprendi bozza</button>
          <button type="button" className="secondary" onClick={startNewAcceptance}>Nuova accettazione</button>
          <button type="button" className="danger" onClick={deleteDraft}>Elimina bozza</button>
        </>}
        <button className="primary" onClick={createFromSelection} disabled={!selectedCustomerId || !selectedVehicleId || Boolean(selected)}>Avanti → Preventivo</button>
      </div>
    </div>

    <section className="panel table-panel">
      <div className="panel-head"><div><span className="eyebrow">NUOVA ACCETTAZIONE</span><h3>1. Cliente</h3></div></div>
      <div className="acceptance-flow-grid">
        <div className="panel table-panel">
          <div className="panel-head"><div><span className="eyebrow">CLIENTE</span><h3>Cliente</h3></div>{currentCustomer && !customerEditing && <button className="secondary" onClick={() => setCustomerEditing(true)}>Verifica / modifica dati cliente</button>}</div>
          <input id={CUSTOMER_DOCUMENT_INPUT_ID} ref={customerDocumentInputRef} aria-label="Carica documento cliente" type="file" accept="image/*" capture="environment" onChange={handleCustomerDocumentChange} style={{ display: 'none' }} />
          {!customerEditing && !currentCustomer ? <div className="planner-actions acceptance-quick-actions">
            <label htmlFor={CUSTOMER_DOCUMENT_INPUT_ID} className="primary">Acquisisci documento</label>
            <button type="button" className="secondary" onClick={() => setCustomerEditing(true)}>Cliente esistente</button>
            <button type="button" className="secondary" onClick={openCustomerManualEntry}>Inserisci manualmente</button>
          </div> : customerEditing ? <>
            <div className="planner-actions acceptance-quick-actions">
              <label htmlFor={CUSTOMER_DOCUMENT_INPUT_ID} className="primary">Acquisisci documento</label>
              <button type="button" className="secondary" onClick={() => setCustomerEditing(true)}>Cliente esistente</button>
              <button type="button" className="secondary" onClick={openCustomerManualEntry}>Inserisci manualmente</button>
            </div>
            <div className="form-grid">
              <label className="full">Cerca cliente<input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Nome, telefono o email" /></label>
            </div>
            <div className="selection-stack">
              {customerMatches.map((customer) => <button className={selectedCustomerId === customer.id ? 'active acceptance-card' : 'acceptance-card'} key={customer.id} onClick={() => setSelectedCustomerId(customer.id)}>
                <strong>{customer.name}</strong>
                <small>{customer.phone || 'Telefono n/d'}{customer.email ? ` · ${customer.email}` : ''}</small>
              </button>)}
              {!customerMatches.length && <Empty text="Nessun cliente corrispondente." />}
            </div>
          </> : renderCustomerCompact()}
        </div>

        <div className="panel table-panel">
          <div className="panel-head"><div><span className="eyebrow">NUOVA ACCETTAZIONE</span><h3>2. Vettura</h3></div>{currentVehicle && !vehicleEditing && <button className="secondary" onClick={() => setVehicleEditing(true)}>Verifica / modifica dati vettura</button>}</div>
          {!vehicleEditing && !currentVehicle ? <div className="planner-actions acceptance-quick-actions">
            <button type="button" className="primary" onClick={openVehicleBookletAcquisition}>Acquisisci libretto</button>
            <button type="button" className="secondary" onClick={() => setVehicleEditing(true)}>Veicolo esistente</button>
            <button type="button" className="secondary" onClick={openVehicleManualEntry}>Inserisci manualmente</button>
            <input ref={vehicleBookletInputRef} aria-label="Carica libretto veicolo" type="file" accept="image/*" capture="environment" onChange={handleVehicleBookletChange} style={{ display: 'none' }} />
            {vehicleBookletPreview && <div className="preview-card">
              <span>Libretto acquisito</span>
              <strong>{vehicleBookletPreview.fileName}</strong>
              <small>Anteprima disponibile</small>
              {vehicleBookletPreview.previewUrl && <img src={vehicleBookletPreview.previewUrl} alt="Anteprima libretto veicolo" />}
            </div>}
          </div> : vehicleEditing ? <>
            <div className="planner-actions acceptance-quick-actions">
              <button type="button" className="primary" onClick={openVehicleBookletAcquisition}>Acquisisci libretto</button>
              <button type="button" className="secondary" onClick={() => setVehicleEditing(true)}>Veicolo esistente</button>
              <button type="button" className="secondary" onClick={openVehicleManualEntry}>Inserisci manualmente</button>
            </div>
            <input ref={vehicleBookletInputRef} aria-label="Carica libretto veicolo" type="file" accept="image/*" capture="environment" onChange={handleVehicleBookletChange} style={{ display: 'none' }} />
            <div className="form-grid">
              <label className="full">Cerca veicolo<input value={vehicleQuery} onChange={(event) => setVehicleQuery(event.target.value)} placeholder="Targa, marca, modello o telaio" /></label>
            </div>
            <div className="selection-stack">
              {vehicleMatches.map((vehicle) => {
                const customer = customerById(vehicle.customerId)
                return <button className={selectedVehicleId === vehicle.id ? 'active acceptance-card' : 'acceptance-card'} key={vehicle.id} onClick={() => setSelectedVehicleId(vehicle.id)}>
                  <strong>{vehicle.plate}</strong>
                  <small>{vehicle.make || 'Marca n/d'} {vehicle.model || ''}</small>
                  <span>{customer?.name ?? 'Cliente non trovato'}</span>
                </button>
              })}
              {!vehicleMatches.length && <Empty text="Nessuna vettura compatibile trovata." />}
            </div>
          </> : renderVehicleCompact()}
        </div>
      </div>
    </section>

    {selected ? <AcceptanceEditor
      acceptance={selected}
      data={data}
      customerById={customerById}
      onSave={onSave}
      openCustomerDetailsRequest={openCustomerDetailsRequest}
      onOpenCustomerDetailsRequestHandled={() => setOpenCustomerDetailsRequest(false)}
      openVehicleDetailsRequest={openVehicleDetailsRequest}
      onOpenVehicleDetailsRequestHandled={() => setOpenVehicleDetailsRequest(false)}
      pendingCustomerDocumentForOcr={pendingCustomerDocumentForOcr}
      onPendingCustomerDocumentForOcrHandled={() => setPendingCustomerDocumentForOcr(null)}
      pendingVehicleBookletForOcr={pendingVehicleBookletForOcr}
      onPendingVehicleBookletForOcrHandled={() => setPendingVehicleBookletForOcr(null)}
    /> : null}

  </section>
}

function isPracticeConfirmed(acceptance: AcceptanceCase) {
  return acceptance.status === 'confirmed'
}

function practiceStatusLabel(status: AcceptanceCase['status']) {
  if (status === 'confirmed') return 'Confermata'
  return 'Bozza'
}

const ACCEPTANCE_FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  surname: 'Cognome',
  taxid: 'Codice fiscale',
  birthdate: 'Data di nascita',
  birthplace: 'Luogo di nascita',
  residence: 'Residenza',
  documentnumber: 'Numero documento',
  issuedate: 'Data rilascio',
  expirydate: 'Data scadenza',
  issuingauthority: 'Ente rilascio',
  plate: 'Targa',
  vin: 'Telaio',
  firstregistration: 'Prima immatricolazione',
  fuel: 'Alimentazione',
  enginedisplacement: 'Cilindrata',
  power: 'Potenza',
  owner: 'Intestatario',
  make: 'Marca',
  model: 'Modello',
}

const normalizeAcceptanceFieldKey = (field: string) => field.toLowerCase().replace(/[^a-z0-9]/g, '')

function acceptanceFieldLabel(field: string) {
  const normalized = normalizeAcceptanceFieldKey(field)
  return ACCEPTANCE_FIELD_LABELS[normalized] ?? field
}

function acceptanceSourceLabel(source: 'azure' | 'ocr' | 'manual') {
  return source === 'manual' ? 'Inserito manualmente' : 'Rilevato automaticamente'
}

function acceptanceConfidenceLabel(confidence: string) {
  const normalized = String(confidence ?? '').trim().toLowerCase()
  if (normalized === 'high') return 'Affidabilita alta'
  if (normalized === 'medium') return 'Affidabilita media'
  if (normalized === 'low') return 'Affidabilita bassa'
  return 'Affidabilita non disponibile'
}

function AcceptanceCasesPage({ data, customerById, onSave, confirmed }: { data: ErpData; customerById: (id: string) => Customer | undefined; onSave: (acceptance: AcceptanceCase) => void; confirmed: boolean }) {
  const acceptances = useMemo(() => data.acceptances ?? [], [data.acceptances])
  const filtered = useMemo(
    () => acceptances.filter((item) => confirmed ? isPracticeConfirmed(item) : !isPracticeConfirmed(item)),
    [acceptances, confirmed],
  )
  const [selectedId, setSelectedId] = useState<string>('')
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0]

  useEffect(() => {
    if (!filtered.length) {
      if (selectedId) setSelectedId('')
      return
    }
    if (selectedId && filtered.some((item) => item.id === selectedId)) return
    setSelectedId(filtered[0].id)
  }, [filtered, selectedId])

  return <section className="panel">
    <div className="welcome">
      <div>
        <span className="eyebrow">{confirmed ? 'PRATICHE CONFERMATE' : 'PRATICHE DA CONFERMARE'}</span>
        <h2>{confirmed ? 'Pratiche approvate dal cliente' : 'Pratiche aperte da completare'}</h2>
        <p>{confirmed ? 'Le pratiche confermate restano disponibili con lo stesso ID per gli step successivi.' : 'Riapri una pratica e continua dal punto in cui era stata lasciata.'}</p>
      </div>
    </div>
    <div className="acceptance-layout">
      <div className="selection-stack">
        {filtered.map((acceptance) => {
          const customer = customerById(acceptance.customerId)
          const vehicle = data.vehicles.find((item) => item.id === acceptance.vehicleId)
          return <button className={selected?.id === acceptance.id ? 'active acceptance-card' : 'acceptance-card'} key={acceptance.id} onClick={() => setSelectedId(acceptance.id)}>
            <strong>{customer?.name ?? 'Cliente non trovato'}</strong>
            <small>{vehicle?.plate ?? 'Vettura non trovata'}</small>
            <span>{practiceStatusLabel(acceptance.status)}</span>
          </button>
        })}
        {!filtered.length && <Empty text={confirmed ? 'Nessuna pratica confermata.' : 'Nessuna pratica da confermare.'} />}
      </div>
      {selected && <AcceptanceEditor
        acceptance={selected}
        data={data}
        customerById={customerById}
        onSave={onSave}
        onChangeStatus={(status) => onSave({ ...selected, status, updatedAt: new Date().toISOString() })}
      />}
    </div>
  </section>
}

function AcceptanceEditor({ acceptance, data, customerById, onSave, onChangeStatus, openCustomerDetailsRequest, onOpenCustomerDetailsRequestHandled, openVehicleDetailsRequest, onOpenVehicleDetailsRequestHandled, pendingCustomerDocumentForOcr, onPendingCustomerDocumentForOcrHandled, pendingVehicleBookletForOcr, onPendingVehicleBookletForOcrHandled }: { acceptance: AcceptanceCase; data: ErpData; customerById: (id: string) => Customer | undefined; onSave: (acceptance: AcceptanceCase) => void; onChangeStatus?: (status: AcceptanceCase['status']) => void; openCustomerDetailsRequest?: boolean; onOpenCustomerDetailsRequestHandled?: () => void; openVehicleDetailsRequest?: boolean; onOpenVehicleDetailsRequestHandled?: () => void; pendingCustomerDocumentForOcr?: { file: File; targetAcceptanceId: string } | null; onPendingCustomerDocumentForOcrHandled?: () => void; pendingVehicleBookletForOcr?: { file: File; targetAcceptanceId: string } | null; onPendingVehicleBookletForOcrHandled?: () => void }) {
  const customer = customerById(acceptance.customerId)
  const vehicle = data.vehicles.find((item) => item.id === acceptance.vehicleId)
  const intake = {
    mileage: acceptance.intake?.mileage ?? '',
    fuelLevel: acceptance.intake?.fuelLevel ?? '',
    occurredAt: acceptance.intake?.occurredAt || new Date().toISOString(),
    operator: acceptance.intake?.operator?.trim() ? acceptance.intake.operator : 'Operatore ERP',
    damageDescription: acceptance.intake?.damageDescription ?? '',
    accessories: acceptance.intake?.accessories ?? [],
    accessoriesDraft: acceptance.intake?.accessoriesDraft ?? createEmptyAccessoriesDraft(),
    customerNotes: acceptance.intake?.customerNotes ?? '',
    checklist: acceptance.intake?.checklist ?? [],
    signatureDataUrl: acceptance.intake?.signatureDataUrl ?? '',
  }
  const [archiveCaption, setArchiveCaption] = useState('')
  const [archiveCategory, setArchiveCategory] = useState<'ingresso' | 'danni' | 'lavorazione' | 'fine lavori' | 'consegna'>('danni')
  const [quickPhotoKind, setQuickPhotoKind] = useState<'danno' | 'vettura' | 'quadro' | 'altro'>('danno')
  const [customerDetailsOpen, setCustomerDetailsOpen] = useState(false)
  const [vehicleDetailsOpen, setVehicleDetailsOpen] = useState(false)
  const [expandedDamagePhotoId, setExpandedDamagePhotoId] = useState<string | null>(null)
  const [damageUploadError, setDamageUploadError] = useState('')
  const [documentOcrState, setDocumentOcrState] = useState<{ status: 'idle' | 'loading' | 'success' | 'error' | 'info'; message: string }>({ status: 'idle', message: '' })
  const [vehicleBookletOcrState, setVehicleBookletOcrState] = useState<{ status: 'idle' | 'loading' | 'success' | 'error' | 'info'; message: string }>({ status: 'idle', message: '' })
  const [signatureModalOpen, setSignatureModalOpen] = useState(false)
  const [signatureStrokes, setSignatureStrokes] = useState<Array<Array<{ x: number; y: number }>>>([])
  const intakePhotoInputRef = useRef<HTMLInputElement | null>(null)
  const signaturePadRef = useRef<HTMLDivElement | null>(null)
  const signaturePointerIdRef = useRef<number | null>(null)
  const documentOcrRequestIdRef = useRef(0)
  const vehicleBookletOcrRequestIdRef = useRef(0)
  const latestAcceptanceRef = useRef(acceptance)
  const latestIntakeRef = useRef(intake)
  const documentFields = Object.entries(acceptance.customerDraft[0]?.fields ?? {}) as Array<[string, { value: string; confidence: string; source: 'azure' | 'ocr' | 'manual' }]>
  const bookletFields = Object.entries(acceptance.vehicleBooklet[0]?.fields ?? {}) as Array<[string, { value: string; confidence: string; source: 'azure' | 'ocr' | 'manual' }]>
  const damagePhotoEntries = useMemo(() => (acceptance.photos ?? []).filter((photo) => photo.category === 'danni'), [acceptance.photos])
  const dashboardPhotoEntries = useMemo(() => (acceptance.photos ?? []).filter((photo) => photo.category === 'ingresso'), [acceptance.photos])
  const accessoriesDraft = intake.accessoriesDraft ?? parseAccessoriesDraftFromLegacy(intake.accessories ?? [])
  const damagePhotoPreviewItems = useMemo(() => damagePhotoEntries.map((photo, index) => {
    const directSrc = typeof photo.dataUrl === 'string' ? photo.dataUrl.trim() : ''
    const fallbackSrc = typeof acceptance.damagePhotos?.[index] === 'string' ? acceptance.damagePhotos[index].trim() : ''
    const previewSrc = directSrc.startsWith('data:image/') || directSrc.startsWith('blob:')
      ? directSrc
      : fallbackSrc
    return { photo, index, previewSrc }
  }), [acceptance.damagePhotos, damagePhotoEntries])
  const dashboardPhotoPreviewItems = useMemo(() => dashboardPhotoEntries.map((photo) => {
    const directSrc = typeof photo.dataUrl === 'string' ? photo.dataUrl.trim() : ''
    const previewSrc = directSrc.startsWith('data:image/') || directSrc.startsWith('blob:')
      ? directSrc
      : ''
    return { photo, previewSrc }
  }), [dashboardPhotoEntries])
  const expandedDamagePhoto = damagePhotoPreviewItems.find(({ photo }) => photo.id === expandedDamagePhotoId) ?? null
  const [expandedDashboardPhotoId, setExpandedDashboardPhotoId] = useState<string | null>(null)
  const expandedDashboardPhoto = dashboardPhotoPreviewItems.find(({ photo }) => photo.id === expandedDashboardPhotoId) ?? null
  const otherIngressPhotoEntries = useMemo(() => (acceptance.photos ?? []).filter((photo) =>
    photo.category === 'consegna' || (photo.category === 'ingresso' && !/quadro/i.test(photo.caption || '')),
  ), [acceptance.photos])
  const signaturePreviewSrc = intake.signatureDataUrl || acceptance.signatureDataUrl || ''
  const signaturePaths = useMemo(() => signatureStrokes
    .filter((stroke) => stroke.length)
    .map((stroke) => stroke.length === 1
      ? `M ${stroke[0].x.toFixed(1)} ${stroke[0].y.toFixed(1)} l 0.1 0.1`
      : stroke.reduce((path, point, index) => `${path}${index === 0 ? 'M' : ' L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`, '')),
  [signatureStrokes])

  useEffect(() => {
    latestAcceptanceRef.current = acceptance
    latestIntakeRef.current = intake
  }, [acceptance, intake])

  const saveAcceptance = (nextAcceptance: AcceptanceCase) => {
    const nextIntake = nextAcceptance.intake ?? latestIntakeRef.current
    const hasDamagePhotos = (nextAcceptance.photos ?? []).some((photo) => photo.category === 'danni') || (nextAcceptance.damagePhotos ?? []).length > 0
    const hasDamageNotes = Boolean(nextIntake.damageDescription.trim())
    const hasSignature = Boolean((nextIntake.signatureDataUrl || nextAcceptance.signatureDataUrl || '').trim())
    const hasAccessoriesConfirmation = Boolean(nextIntake.accessoriesDraft?.confirmed)
    const nextChecklist = (nextIntake.checklist ?? []).map((item) => {
      if (item.label === ACCEPTANCE_CHECKLIST_DAMAGE_LABEL) return { ...item, checked: hasDamagePhotos || hasDamageNotes }
      if (item.label === ACCEPTANCE_CHECKLIST_ACCESSORIES_LABEL) return { ...item, checked: hasAccessoriesConfirmation }
      if (item.label === ACCEPTANCE_CHECKLIST_PHOTOS_LABEL) return { ...item, checked: hasDamagePhotos }
      if (item.label === ACCEPTANCE_CHECKLIST_SIGNATURE_LABEL) return { ...item, checked: hasSignature }
      return item
    })
    onSave({
      ...nextAcceptance,
      intake: { ...nextIntake, checklist: nextChecklist },
      updatedAt: new Date().toISOString(),
    })
  }

  const updateSignature = (dataUrl: string) => {
    const currentAcceptance = latestAcceptanceRef.current
    const currentIntake = currentAcceptance.intake ?? latestIntakeRef.current
    saveAcceptance({
      ...currentAcceptance,
      signatureDataUrl: dataUrl,
      intake: { ...currentIntake, signatureDataUrl: dataUrl },
      updatedAt: new Date().toISOString(),
    })
  }

  const resetSignatureModal = () => {
    signaturePointerIdRef.current = null
    setSignatureStrokes([])
  }

  const openSignatureModal = () => {
    resetSignatureModal()
    setSignatureModalOpen(true)
  }

  const closeSignatureModal = () => {
    resetSignatureModal()
    setSignatureModalOpen(false)
  }

  const getSignaturePoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = signaturePadRef.current?.getBoundingClientRect()
    const width = rect?.width || 900
    const height = rect?.height || 320
    const left = rect?.left || 0
    const top = rect?.top || 0
    const x = Math.max(0, Math.min(width, event.clientX - left))
    const y = Math.max(0, Math.min(height, event.clientY - top))
    return { x, y }
  }

  const beginSignatureStroke = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointerId = event.pointerId || 1
    signaturePointerIdRef.current = pointerId
    if ('setPointerCapture' in event.currentTarget) event.currentTarget.setPointerCapture(pointerId)
    const point = getSignaturePoint(event)
    setSignatureStrokes((current) => [...current, [point]])
  }

  const continueSignatureStroke = (event: React.PointerEvent<HTMLDivElement>) => {
    if (signaturePointerIdRef.current !== (event.pointerId || 1)) return
    const point = getSignaturePoint(event)
    setSignatureStrokes((current) => {
      if (!current.length) return [[point]]
      const next = [...current]
      next[next.length - 1] = [...next[next.length - 1], point]
      return next
    })
  }

  const endSignatureStroke = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointerId = event.pointerId || 1
    if (signaturePointerIdRef.current !== pointerId) return
    if ('releasePointerCapture' in event.currentTarget) event.currentTarget.releasePointerCapture(pointerId)
    signaturePointerIdRef.current = null
  }

  const confirmSignature = () => {
    if (!signaturePaths.length) return
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 320" width="900" height="320"><rect width="100%" height="100%" fill="#fff"/><path d="${signaturePaths.join(' ')}" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    const dataUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
    updateSignature(dataUrl)
    closeSignatureModal()
  }

  const updateIntake = (field: keyof AcceptanceIntakeData, value: AcceptanceIntakeData[keyof AcceptanceIntakeData]) => {
    const currentAcceptance = latestAcceptanceRef.current
    const currentIntake = currentAcceptance.intake ?? latestIntakeRef.current
    saveAcceptance({ ...currentAcceptance, intake: { ...currentIntake, [field]: value }, updatedAt: new Date().toISOString() })
  }

  const updateDocumentField = (field: string, value: string) => {
    const currentAcceptance = latestAcceptanceRef.current
    const draft = currentAcceptance.customerDraft[0]
    if (!draft) return
    const nextDraft = {
      ...draft,
      fields: {
        ...draft.fields,
        [field]: {
          ...draft.fields[field as keyof typeof draft.fields],
          value,
          source: 'manual',
        },
      },
    }
    saveAcceptance({ ...currentAcceptance, customerDraft: [nextDraft], updatedAt: new Date().toISOString() })
  }

  const confirmDocumentFields = () => {
    const currentAcceptance = latestAcceptanceRef.current
    const draft = currentAcceptance.customerDraft[0]
    if (!draft) return
    saveAcceptance({
      ...currentAcceptance,
      customerDraft: [{ ...draft }],
      updatedAt: new Date().toISOString(),
    })
    setDocumentOcrState({ status: 'info', message: 'Dati documento confermati. Prosegui con la pratica.' })
  }

  const updateBookletField = (field: string, value: string) => {
    const currentAcceptance = latestAcceptanceRef.current
    const draft = currentAcceptance.vehicleBooklet[0]
    if (!draft) return
    const nextDraft = {
      ...draft,
      fields: {
        ...draft.fields,
        [field]: {
          ...draft.fields[field as keyof typeof draft.fields],
          value,
          source: 'manual',
        },
      },
    }
    saveAcceptance({ ...currentAcceptance, vehicleBooklet: [nextDraft], updatedAt: new Date().toISOString() })
  }

  const confirmVehicleBookletFields = () => {
    const currentAcceptance = latestAcceptanceRef.current
    const draft = currentAcceptance.vehicleBooklet[0]
    if (!draft) return
    saveAcceptance({
      ...currentAcceptance,
      vehicleBooklet: [{ ...draft }],
      updatedAt: new Date().toISOString(),
    })
    setVehicleBookletOcrState({ status: 'info', message: 'Dati vettura confermati. Prosegui con la pratica.' })
  }

  const startVehicleBookletOcr = (file: File, dataUrl: string) => {
    const currentAcceptance = latestAcceptanceRef.current
    const requestId = vehicleBookletOcrRequestIdRef.current + 1
    vehicleBookletOcrRequestIdRef.current = requestId
    setVehicleBookletOcrState({ status: 'loading', message: 'Lettura libretto in corso...' })
    saveAcceptance({
      ...currentAcceptance,
      vehicleBooklet: [{ ...currentAcceptance.vehicleBooklet[0], dataUrl, name: file.name }],
      updatedAt: new Date().toISOString(),
    })

    void readVehicleBooklet(file).then((ocrResult) => {
      if (vehicleBookletOcrRequestIdRef.current !== requestId) return
      const latestAcceptance = latestAcceptanceRef.current
      const latestDraft = latestAcceptance.vehicleBooklet[0]
      if (!latestDraft) return
      const mergedDraft = mergeVehicleBookletDraftWithOcr({
        ...latestDraft,
        dataUrl,
        name: file.name,
      }, ocrResult)
      saveAcceptance({
        ...latestAcceptance,
        vehicleBooklet: [mergedDraft],
        updatedAt: new Date().toISOString(),
      })
      setVehicleBookletOcrState({
        status: 'success',
        message: ocrResult.warnings.length ? 'Libretto letto parzialmente. Controlla i campi prima del salvataggio.' : 'Libretto letto automaticamente. Controlla i dati prima del salvataggio.',
      })
    }).catch(() => {
      if (vehicleBookletOcrRequestIdRef.current !== requestId) return
      setVehicleBookletOcrState({ status: 'error', message: VEHICLE_BOOKLET_OCR_GENERIC_ERROR })
    })
  }

  const startDocumentOcr = (file: File, dataUrl: string) => {
    const currentAcceptance = latestAcceptanceRef.current
    const requestId = documentOcrRequestIdRef.current + 1
    documentOcrRequestIdRef.current = requestId
    setDocumentOcrState({ status: 'loading', message: 'Lettura documento in corso…' })
    saveAcceptance({
      ...currentAcceptance,
      customerDraft: [{ ...currentAcceptance.customerDraft[0], dataUrl, name: file.name }],
      updatedAt: new Date().toISOString(),
    })

    void readIdentityDocument(file).then((ocrResult) => {
      if (documentOcrRequestIdRef.current !== requestId) return
      const latestAcceptance = latestAcceptanceRef.current
      const latestDraft = latestAcceptance.customerDraft[0] ?? createEmptyDocumentDraft()[0]
      const mergedDraft = mergeCustomerDocumentDraftWithOcr({
        ...latestDraft,
        dataUrl,
        name: file.name,
      }, ocrResult)
      saveAcceptance({
        ...latestAcceptance,
        customerDraft: [mergedDraft],
        updatedAt: new Date().toISOString(),
      })
      setDocumentOcrState({
        status: 'success',
        message: ocrResult.warnings.length ? 'Documento letto parzialmente. Controlla i campi evidenziati prima del salvataggio.' : 'Documento letto automaticamente. Controlla i dati prima del salvataggio.',
      })
    }).catch(() => {
      if (documentOcrRequestIdRef.current !== requestId) return
      setDocumentOcrState({ status: 'error', message: DOCUMENT_IDENTITY_OCR_GENERIC_ERROR })
    })
  }

  const handleCapturedDocumentReady = (file: File, dataUrl: string) => {
    setCustomerDetailsOpen(true)
    startDocumentOcr(file, dataUrl)
  }

  const handleCapturedBookletReady = (file: File, dataUrl: string) => {
    setVehicleDetailsOpen(true)
    startVehicleBookletOcr(file, dataUrl)
  }

  const handleVehicleBookletFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      handleCapturedBookletReady(file, dataUrl)
    }
    reader.onerror = () => {
      setVehicleBookletOcrState({ status: 'error', message: 'Impossibile leggere il file libretto.' })
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  useEffect(() => {
    if (!openCustomerDetailsRequest) return
    setCustomerDetailsOpen(true)
    onOpenCustomerDetailsRequestHandled?.()
  }, [onOpenCustomerDetailsRequestHandled, openCustomerDetailsRequest])

  useEffect(() => {
    if (!openVehicleDetailsRequest) return
    setVehicleDetailsOpen(true)
    onOpenVehicleDetailsRequestHandled?.()
  }, [onOpenVehicleDetailsRequestHandled, openVehicleDetailsRequest])

  useEffect(() => {
    if (!pendingCustomerDocumentForOcr) return
    if (pendingCustomerDocumentForOcr.targetAcceptanceId !== acceptance.id) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const dataUrl = String(reader.result ?? '')
        handleCapturedDocumentReady(pendingCustomerDocumentForOcr.file, dataUrl)
      } catch (problem) {
        const message = problem instanceof Error ? problem.message : 'Errore avvio OCR da fallback'
        setDocumentOcrState({ status: 'error', message })
      } finally {
        onPendingCustomerDocumentForOcrHandled?.()
      }
    }
    reader.onerror = () => {
      setDocumentOcrState({ status: 'error', message: 'Impossibile leggere il file documento per avvio OCR' })
      onPendingCustomerDocumentForOcrHandled?.()
    }
    reader.readAsDataURL(pendingCustomerDocumentForOcr.file)
  }, [acceptance.id, handleCapturedDocumentReady, onPendingCustomerDocumentForOcrHandled, pendingCustomerDocumentForOcr])

  useEffect(() => {
    if (!pendingVehicleBookletForOcr) return
    if (pendingVehicleBookletForOcr.targetAcceptanceId !== acceptance.id) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const dataUrl = String(reader.result ?? '')
        handleCapturedBookletReady(pendingVehicleBookletForOcr.file, dataUrl)
      } catch (problem) {
        const message = problem instanceof Error ? problem.message : 'Errore avvio OCR libretto da fallback'
        setVehicleBookletOcrState({ status: 'error', message })
      } finally {
        onPendingVehicleBookletForOcrHandled?.()
      }
    }
    reader.onerror = () => {
      setVehicleBookletOcrState({ status: 'error', message: 'Impossibile leggere il file libretto per avvio OCR' })
      onPendingVehicleBookletForOcrHandled?.()
    }
    reader.readAsDataURL(pendingVehicleBookletForOcr.file)
  }, [acceptance.id, handleCapturedBookletReady, onPendingVehicleBookletForOcrHandled, pendingVehicleBookletForOcr])

  const handleQuickIntakePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!isAcceptedImageFile(file)) {
      setDamageUploadError('Seleziona un file immagine valido')
      event.target.value = ''
      return
    }
    if (damageUploadError) setDamageUploadError('')
    const reader = new FileReader()
    reader.onload = () => {
      const currentAcceptance = latestAcceptanceRef.current
      const dataUrl = String(reader.result)
      const map = {
        danno: { category: 'danni' as const, caption: 'Foto danni' },
        vettura: { category: 'ingresso' as const, caption: 'Foto vettura' },
        quadro: { category: 'ingresso' as const, caption: 'Foto quadro strumenti' },
        altro: { category: 'consegna' as const, caption: 'Foto altro' },
      }
      const choice = map[quickPhotoKind]
      const photo = createPhotoArchiveEntry(currentAcceptance.id, currentAcceptance.vehicleId, choice.category, file.name, dataUrl, choice.caption)
      saveAcceptance(appendAcceptancePhotoEntry(currentAcceptance, photo))
      event.target.value = ''
    }
    reader.readAsDataURL(file)
  }

  const handleArchivePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const currentAcceptance = latestAcceptanceRef.current
      const dataUrl = String(reader.result)
      const photo = createPhotoArchiveEntry(currentAcceptance.id, currentAcceptance.vehicleId, archiveCategory, file.name, dataUrl, archiveCaption || 'Foto archivio')
      saveAcceptance(appendAcceptancePhotoEntry(currentAcceptance, photo))
      setArchiveCaption('')
      event.target.value = ''
    }
    reader.readAsDataURL(file)
  }

  const persistQuote = () => {
    const currentAcceptance = latestAcceptanceRef.current
    saveAcceptance({ ...currentAcceptance, updatedAt: new Date().toISOString() })
  }

  const updateAccessoriesDraft = (patch: Partial<NonNullable<AcceptanceIntakeData['accessoriesDraft']>>) => {
    updateIntake('accessoriesDraft', {
      ...accessoriesDraft,
      ...patch,
      confirmed: false,
    })
  }

  const confirmAccessories = () => {
    const currentAcceptance = latestAcceptanceRef.current
    const currentIntake = currentAcceptance.intake ?? latestIntakeRef.current
    const nextDraft = { ...accessoriesDraft, confirmed: true }
    saveAcceptance({
      ...currentAcceptance,
      intake: {
        ...currentIntake,
        accessoriesDraft: nextDraft,
        accessories: buildAccessoriesList(nextDraft),
      },
      updatedAt: new Date().toISOString(),
    })
  }

  const removePhotoEntry = (photoId: string) => {
    const currentAcceptance = latestAcceptanceRef.current
    const removedPhoto = (currentAcceptance.photos ?? []).find((photo) => photo.id === photoId)
    const nextPhotos = (currentAcceptance.photos ?? []).filter((photo) => photo.id !== photoId)
    const nextDamagePhotos = (currentAcceptance.damagePhotos ?? []).filter((dataUrl) => dataUrl !== removedPhoto?.dataUrl)
    saveAcceptance({ ...currentAcceptance, photos: nextPhotos, damagePhotos: [...new Set(nextDamagePhotos)], updatedAt: new Date().toISOString() })
  }

  return <div className="acceptance-editor">
    <div className="panel">
      <div className="panel-head">
        <div><span className="eyebrow">PASSAGGIO 2</span><h3>Foto e accettazione</h3><p>{customer?.name ?? 'Cliente'} · {vehicle?.plate ?? 'Vettura'}</p></div>
        {onChangeStatus && <div className="planner-actions">
          {isPracticeConfirmed(acceptance)
            ? <button type="button" className="secondary" onClick={() => onChangeStatus('draft')}>Riporta da confermare</button>
            : <button type="button" className="primary" onClick={() => onChangeStatus('confirmed')}>Registra conferma cliente</button>}
        </div>}
      </div>
      <div className="form-grid">
        <label>Classifica foto
          <select value={quickPhotoKind} onChange={(event) => setQuickPhotoKind(event.target.value as 'danno' | 'vettura' | 'quadro' | 'altro')}>
            <option value="danno">Danno</option>
            <option value="vettura">Vettura</option>
            <option value="quadro">Quadro strumenti</option>
            <option value="altro">Altro</option>
          </select>
        </label>
        <button type="button" className="primary" onClick={() => intakePhotoInputRef.current?.click()}>+ Aggiungi foto</button>
        <input ref={intakePhotoInputRef} aria-label="Carica foto ingresso" type="file" accept={ACCEPTANCE_IMAGE_FILE_TYPES} capture="environment" onChange={handleQuickIntakePhoto} style={{ display: 'none' }} />
      </div>
      {damageUploadError && <p className="goal-critical">{damageUploadError}</p>}
      <div className="preview-grid">
        <div className="preview-card"><h4>Foto vettura / danni</h4>{damagePhotoPreviewItems.length ? <div className="damage-photo-grid">{damagePhotoPreviewItems.map(({ photo, index, previewSrc }) => <div className="damage-photo-card" key={photo.id}><button type="button" className="damage-photo-trigger" onClick={() => setExpandedDamagePhotoId(photo.id)}>{previewSrc ? <img src={previewSrc} alt={`Danno ${index + 1}`} /> : <div className="empty"><div>◇</div><p>Preview non disponibile</p></div>}</button><strong>{photo.name}</strong><button type="button" className="danger" onClick={() => removePhotoEntry(photo.id)}>Elimina</button></div>)}</div> : acceptance.damagePhotos.length ? <div className="damage-photo-grid">{acceptance.damagePhotos.map((photo, index) => <div className="damage-photo-card" key={`${photo}-${index}`}><button type="button" className="damage-photo-trigger" onClick={() => setExpandedDamagePhotoId(damagePhotoEntries[index]?.id ?? null)}><img src={photo} alt={`Danno ${index + 1}`} /></button><strong>{`Foto danni ${index + 1}`}</strong></div>)}</div> : <p>Nessuna foto danno allegata.</p>}</div>
        <div className="preview-card"><h4>Foto ingresso</h4>{dashboardPhotoPreviewItems.length || otherIngressPhotoEntries.length ? <div className="damage-photo-grid">{dashboardPhotoPreviewItems.map(({ photo, previewSrc }, index) => <div className="damage-photo-card" key={photo.id}><button type="button" className="damage-photo-trigger" onClick={() => setExpandedDashboardPhotoId(photo.id)}>{previewSrc ? <img src={previewSrc} alt={`Quadro ${index + 1}`} /> : <div className="empty"><div>◇</div><p>Preview non disponibile</p></div>}</button><strong>{photo.name}</strong><small>Quadro strumenti</small><button type="button" className="danger" onClick={() => removePhotoEntry(photo.id)}>Elimina</button></div>)}{otherIngressPhotoEntries.map((photo, index) => <div className="damage-photo-card" key={photo.id}><button type="button" className="damage-photo-trigger" onClick={() => setExpandedDashboardPhotoId(photo.id)}><img src={photo.dataUrl} alt={`Ingresso ${index + 1}`} /></button><strong>{photo.name}</strong><small>{/vettura/i.test(photo.caption || '') ? 'Vettura' : 'Altro'}</small><button type="button" className="danger" onClick={() => removePhotoEntry(photo.id)}>Elimina</button></div>)}</div> : <p>Nessuna foto ingresso allegata.</p>}</div>
        <div className="preview-card signature-card"><h4>Firma cliente</h4><div className="signature-actions"><button type="button" className="secondary" onClick={openSignatureModal}>{signaturePreviewSrc ? 'Rifai firma' : 'Firma cliente'}</button></div>{signaturePreviewSrc ? <img src={signaturePreviewSrc} alt="Firma digitale" /> : <p>Nessuna firma salvata.</p>}</div>
        <div className="preview-card checklist-card"><h4>Checklist essenziale</h4><div className="checklist-list">{(intake.checklist ?? []).map((item) => <label key={item.id}><input type="checkbox" checked={item.checked} readOnly disabled />{item.label}</label>)}</div></div>
      </div>
      <div className="form-grid">
        <label className="full">Note / danni / richieste cliente<textarea rows={3} value={intake.damageDescription} onChange={(event) => updateIntake('damageDescription', event.target.value)} placeholder="Annota danni, condizioni o richieste del cliente" /></label>
      </div>
      <details className="preview-card accessories-confirmation" onToggle={(event) => {
        const open = (event.currentTarget as HTMLDetailsElement).open
        if (!open) return
      }}>
        <summary><h4>Accessori alla consegna</h4></summary>
        <div className="accessories-grid">
          <label>Numero chiavi<input type="number" min="0" value={accessoriesDraft.keyCount} onChange={(event) => updateAccessoriesDraft({ keyCount: event.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={accessoriesDraft.hasRegistrationCard} onChange={(event) => updateAccessoriesDraft({ hasRegistrationCard: event.target.checked })} /> Carta/libretto presente</label>
          <label className="check"><input type="checkbox" checked={accessoriesDraft.hasSpareWheelKit} onChange={(event) => updateAccessoriesDraft({ hasSpareWheelKit: event.target.checked })} /> Ruota di scorta / kit gonfiaggio</label>
          <label className="check"><input type="checkbox" checked={accessoriesDraft.hasTriangle} onChange={(event) => updateAccessoriesDraft({ hasTriangle: event.target.checked })} /> Triangolo</label>
          <label className="check"><input type="checkbox" checked={accessoriesDraft.hasSafetyVest} onChange={(event) => updateAccessoriesDraft({ hasSafetyVest: event.target.checked })} /> Giubbotto alta visibilita</label>
          <label className="check"><input type="checkbox" checked={accessoriesDraft.hasFloorMats} onChange={(event) => updateAccessoriesDraft({ hasFloorMats: event.target.checked })} /> Tappetini</label>
          <label className="check"><input type="checkbox" checked={accessoriesDraft.hasPersonalItems} onChange={(event) => updateAccessoriesDraft({ hasPersonalItems: event.target.checked })} /> Oggetti personali</label>
          <label className="full">Altro / note<textarea rows={2} value={accessoriesDraft.otherNotes} onChange={(event) => updateAccessoriesDraft({ otherNotes: event.target.value })} /></label>
          <div className="accessories-actions">
            <button type="button" className="primary" onClick={confirmAccessories}>Verifica accessori</button>
            {accessoriesDraft.confirmed && <small className="goal-ok">Accessori confermati</small>}
          </div>
        </div>
      </details>
      <details className="preview-card" open={customerDetailsOpen} onToggle={(event) => setCustomerDetailsOpen((event.currentTarget as HTMLDetailsElement).open)}>
        <summary><h4>Verifica / modifica dati cliente</h4></summary>
        {customerDetailsOpen && <div className="archive-form">
          <label className="full">Note cliente<textarea rows={3} value={intake.customerNotes} onChange={(event) => updateIntake('customerNotes', event.target.value)} /></label>
          {documentOcrState.status !== 'idle' && <p className={`acceptance-ocr-status ${documentOcrState.status === 'error' ? 'goal-critical' : documentOcrState.status === 'loading' ? 'goal-gap' : documentOcrState.status === 'success' ? 'goal-ok' : ''}`}>{documentOcrState.message}</p>}
          <DocumentCapturePanel onReadDocument={handleCapturedDocumentReady} />
          <div className="preview-card"><h4>Documento ID</h4>{acceptance.customerDraft[0]?.dataUrl ? <img src={acceptance.customerDraft[0].dataUrl} alt="Documento ID" /> : <p>Carica documento fronte/retro per il flusso OCR.</p>}</div>
          <div className="preview-card ocr-document-review-card"><h4>Conferma dati documento</h4><div className="ocr-field-grid">{documentFields.map(([field, draft]) => <label key={field} className={draft.source === 'azure' && draft.confidence !== 'high' ? 'ocr-needs-review' : draft.source === 'azure' ? 'ocr-from-azure' : ''}><span>{acceptanceFieldLabel(field)}</span><input value={draft.value} onChange={(event) => updateDocumentField(field, event.target.value)} /><small>{acceptanceConfidenceLabel(draft.confidence)} · {acceptanceSourceLabel(draft.source)}</small></label>)}</div><div className="ocr-document-actions"><button type="button" className="primary" onClick={confirmDocumentFields}>Conferma dati</button></div></div>
        </div>}
      </details>
      <details className="preview-card" open={vehicleDetailsOpen} onToggle={(event) => setVehicleDetailsOpen((event.currentTarget as HTMLDetailsElement).open)}>
        <summary><h4>Verifica / modifica dati vettura</h4></summary>
        {vehicleDetailsOpen && <div className="archive-form">
          <label>Chilometraggio<input value={intake.mileage} onChange={(event) => updateIntake('mileage', event.target.value)} /></label>
          <label>Livello carburante<input value={intake.fuelLevel} onChange={(event) => updateIntake('fuelLevel', event.target.value)} /></label>
          <label>Data e ora ingresso<input type="datetime-local" value={intake.occurredAt ? new Date(intake.occurredAt).toISOString().slice(0, 16) : ''} readOnly /></label>
          <label>Operatore<input value={intake.operator} readOnly /></label>
          <label>Libretto<input type="file" accept={ACCEPTANCE_IMAGE_FILE_TYPES} capture="environment" onChange={handleVehicleBookletFileInput} /></label>
          <label>Foto aggiuntive<input type="file" accept={ACCEPTANCE_IMAGE_FILE_TYPES} capture="environment" onChange={(event) => handleArchivePhoto(event)} /></label>
          <label>Categoria<select value={archiveCategory} onChange={(event) => setArchiveCategory(event.target.value as 'ingresso' | 'danni' | 'lavorazione' | 'fine lavori' | 'consegna')}><option value="ingresso">Ingresso</option><option value="danni">Danni</option><option value="lavorazione">Lavorazione</option><option value="fine lavori">Fine lavori</option><option value="consegna">Consegna</option></select></label>
          <label>Didascalia<input value={archiveCaption} onChange={(event) => setArchiveCaption(event.target.value)} placeholder="Inserisci didascalia" /></label>
          {vehicleBookletOcrState.status !== 'idle' && <p className={`acceptance-ocr-status ${vehicleBookletOcrState.status === 'error' ? 'goal-critical' : vehicleBookletOcrState.status === 'loading' ? 'goal-gap' : vehicleBookletOcrState.status === 'success' ? 'goal-ok' : ''}`}>{vehicleBookletOcrState.message}</p>}
          <div className="preview-card"><h4>Libretto</h4>{acceptance.vehicleBooklet[0]?.dataUrl ? <img src={acceptance.vehicleBooklet[0].dataUrl} alt="Libretto" /> : <p>Carica il libretto per l'inserimento dati veicolo.</p>}</div>
          <div className="preview-card ocr-document-review-card"><h4>Conferma dati vettura</h4><div className="ocr-field-grid">{bookletFields.map(([field, draft]) => <label key={field}><span>{acceptanceFieldLabel(field)}</span><input value={draft.value} onChange={(event) => updateBookletField(field, event.target.value)} /><small>{acceptanceConfidenceLabel(draft.confidence)} · {acceptanceSourceLabel(draft.source)}</small></label>)}</div><div className="ocr-document-actions"><button type="button" className="primary" onClick={confirmVehicleBookletFields}>Conferma dati vettura</button></div></div>
          <div className="preview-card"><h4>Accessori confermati</h4>{(intake.accessories ?? []).length ? <ul className="accessory-confirmed-list">{(intake.accessories ?? []).map((accessory) => <li key={accessory}>{accessory}</li>)}</ul> : <p>Nessun accessorio confermato.</p>}</div>
          <div className="photo-list">{(acceptance.photos ?? []).map((photo) => <div className="photo-item" key={photo.id}><img src={photo.dataUrl} alt={photo.name} /><div><strong>{photo.name}</strong><small>{photo.category} · {photo.caption || 'Nessuna didascalia'}</small></div><button type="button" className="danger" onClick={() => removePhotoEntry(photo.id)}>Elimina</button></div>)}</div>
        </div>}
      </details>
      <div className="form-actions">
        <button type="button" className="primary" onClick={persistQuote}>Avanti → Preventivo</button>
      </div>
    </div>
    {expandedDamagePhoto && expandedDamagePhoto.previewSrc && <Modal title={expandedDamagePhoto.photo.name} onClose={() => setExpandedDamagePhotoId(null)}><div className="damage-photo-modal"><img src={expandedDamagePhoto.previewSrc} alt={expandedDamagePhoto.photo.name} /><small>{expandedDamagePhoto.photo.caption || expandedDamagePhoto.photo.name}</small></div></Modal>}
    {expandedDashboardPhoto && expandedDashboardPhoto.previewSrc && <Modal title={expandedDashboardPhoto.photo.name} onClose={() => setExpandedDashboardPhotoId(null)}><div className="damage-photo-modal"><img src={expandedDashboardPhoto.previewSrc} alt={expandedDashboardPhoto.photo.name} /><small>{expandedDashboardPhoto.photo.caption || expandedDashboardPhoto.photo.name}</small></div></Modal>}
    {signatureModalOpen && <Modal title="Firma cliente" onClose={closeSignatureModal} className="signature-modal"><div className="signature-modal-body"><div className="signature-pad-shell"><div ref={signaturePadRef} className="signature-pad" aria-label="Area firma cliente" onPointerDown={beginSignatureStroke} onPointerMove={continueSignatureStroke} onPointerUp={endSignatureStroke} onPointerLeave={endSignatureStroke}><svg viewBox="0 0 900 320" aria-hidden="true">{signaturePaths.map((path, index) => <path key={`${path}-${index}`} d={path} fill="none" stroke="#111" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}</svg></div></div><div className="form-actions"><button type="button" className="secondary" onClick={resetSignatureModal}>Cancella</button><button type="button" className="secondary" onClick={closeSignatureModal}>Annulla</button><button type="button" className="primary" disabled={!signaturePaths.length} onClick={confirmSignature}>Conferma firma</button></div></div></Modal>}
  </div>
}

function Empty({ text }: { text: string }) { return <div className="empty"><div>◇</div><p>{text}</p></div> }
export default App


