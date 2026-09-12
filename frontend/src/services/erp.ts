import type { ConeEvent, Customer, ErpData, InternalMonthlyCostCategory, InternalMonthlyCostItem, PlannerSettings, Vehicle, VehicleCostEntry, VehicleStatus, VehicleStatusChange } from '../types'
import { calculateVehicleEconomicSnapshot } from './economic'
import { defaultVehicleStatus, isVehicleConeRequiredStatus, resolveVehicleStatusId } from './vehicleStatuses'
import { DEFAULT_WEEKLY_WORK_SCHEDULE } from './workCalendar'

export const TOTAL_CONES = 30
export const STORAGE_KEY = 'carrozzeria-elias-erp-v1'

const INTERNAL_MONTHLY_COST_CATEGORIES: Array<{ category: InternalMonthlyCostCategory; description: string }> = [
  { category: 'personale', description: 'Personale' },
  { category: 'affitto', description: 'Affitto' },
  { category: 'noleggi-leasing', description: 'Noleggi / Leasing' },
  { category: 'energia', description: 'Energia' },
  { category: 'assicurazioni', description: 'Assicurazioni' },
  { category: 'software', description: 'Software' },
  { category: 'consulenze-amministrazione', description: 'Consulenze / amministrazione' },
  { category: 'utenze', description: 'Utenze' },
  { category: 'altri-costi-fissi', description: 'Altri costi fissi' },
  { category: 'altri-costi-generali', description: 'Altri costi generali' },
]

const defaultMonthlyCostItems: InternalMonthlyCostItem[] = INTERNAL_MONTHLY_COST_CATEGORIES.map((item) => ({
  id: crypto.randomUUID(),
  category: item.category,
  description: item.description,
  monthlyAmount: 0,
  active: true,
}))

export const defaultPlannerSettings: PlannerSettings = {
  operators: [],
  standardWorks: [
    { id: crypto.randomUUID(), name: 'Smontaggio', calculationType: 'per-vehicle', standardMinutes: 60, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], categoryOrPhase: 'Smontaggio', rules: [], active: true, requiredSkill: 'smontaggio', cycleOrder: 10 },
    { id: crypto.randomUUID(), name: 'Lattoneria', calculationType: 'per-panel', standardMinutes: 30, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], categoryOrPhase: 'Lattoneria', rules: [], active: true, requiredSkill: 'lattoneria', cycleOrder: 20 },
    { id: crypto.randomUUID(), name: 'Incartatura', calculationType: 'per-vehicle', standardMinutes: 40, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], categoryOrPhase: 'Preparazione', rules: [], active: true, requiredSkill: 'preparazione', cycleOrder: 30 },
    { id: crypto.randomUUID(), name: 'Scartatura', calculationType: 'per-vehicle', standardMinutes: 40, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], categoryOrPhase: 'Preparazione', rules: [], active: true, requiredSkill: 'preparazione', cycleOrder: 35 },
    { id: crypto.randomUUID(), name: 'Stuccatura', calculationType: 'per-panel', standardMinutes: 0, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], categoryOrPhase: 'Preparazione', rules: [], active: false, requiredSkill: 'preparazione', cycleOrder: 37 },
    { id: crypto.randomUUID(), name: 'Preparazione', calculationType: 'per-panel', standardMinutes: 60, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], categoryOrPhase: 'Preparazione', rules: [], active: true, requiredSkill: 'preparazione', cycleOrder: 40 },
    { id: crypto.randomUUID(), name: 'Verniciatura standard', calculationType: 'per-panel', standardMinutes: 30, technicalWaitMinutes: 360, technicalWaitBlocksPhaseNames: ['Lucidatura', 'Rimontaggio', 'Lavaggio', 'Controllo qualità'], categoryOrPhase: 'Verniciatura', rules: [], active: true, requiredSkill: 'verniciatura', cycleOrder: 50 },
    { id: crypto.randomUUID(), name: 'Verniciatura perlato', calculationType: 'per-panel', standardMinutes: 45, technicalWaitMinutes: 360, technicalWaitBlocksPhaseNames: ['Lucidatura', 'Rimontaggio', 'Lavaggio', 'Controllo qualità'], categoryOrPhase: 'Verniciatura', rules: [], active: true, requiredSkill: 'verniciatura', cycleOrder: 55 },
    { id: crypto.randomUUID(), name: 'Rimontaggio', calculationType: 'per-vehicle', standardMinutes: 60, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], categoryOrPhase: 'Rimontaggio', rules: [], active: true, requiredSkill: 'rimontaggio', cycleOrder: 60 },
    { id: crypto.randomUUID(), name: 'Lavaggio', calculationType: 'per-vehicle', standardMinutes: 20, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], categoryOrPhase: 'Lavaggio', rules: [], active: true, requiredSkill: 'lavaggio', cycleOrder: 80 },
  ],
  standardWorkRuleHistory: [],
  standardWorkTimePresets: [],
  standardWorkPriceList: [],
  standardWorkPriceHistory: [],
  internalCostSettings: {
    internalHourlyRate: 0,
    minimumMarginPercent: 20,
    monthlyCostItems: defaultMonthlyCostItems,
    productiveCapacity: {
      productiveOperators: 4,
      hoursPerOperatorPerDay: 8,
      workingDaysPerMonth: 22,
      efficiencyPercent: 85,
    },
    useManualHourlyRate: false,
    manualHourlyRate: null,
    futureHourlyRateBySkill: {},
  },
  workingDays: [1, 2, 3, 4, 5],
  weeklyWorkSchedule: structuredClone(DEFAULT_WEEKLY_WORK_SCHEDULE),
  efficiencyPercent: 85,
  safetyMarginPercent: 15,
  holidays: [],
  closures: [],
  companyClosures: [],
  absences: [],
  monthlyRevenueGoal: 0,
  monthlyRevenueGoalMode: 'automatic',
  monthlyRevenueGoalSuggested: 0,
  monthlyRevenueGoalManual: null,
  ownerWithdrawalAmount: 3000,
  ownerWithdrawalPlannedDate: new Date().toISOString().slice(0, 10),
  ownerWithdrawalSettledMonthKey: null,
  ownerWithdrawalSettledAt: null,
  economicSafetyMarginPercent: 10,
  monthlyMarginGoal: null,
  monthlyGoalHistory: [],
  phaseTrackingMetric: 'calendar',
  deliveryBufferMode: 'percent',
  deliveryBufferValue: 10,
  vehicleStatuses: undefined,
  defaultVehicleStatus: 'accettata',
}

export const emptyData: ErpData = {
  customers: [],
  vehicles: [],
  coneHistory: [],
  plannerSettings: defaultPlannerSettings,
  plannerAssignments: [],
  invoices: [],
  bankAccounts: [],
  ribaBatches: [],
  financialEvents: [],
  payables: [],
  vatQuarterlyRecords: [],
  quotes: [],
  communications: [],
  documentCounters: {
    quote: 0,
    invoice: 0,
  },
  companyProfile: {
    name: 'ELIAS BODY SHOP',
    vatId: '',
    taxCode: '',
    address: '',
    phone: '',
    email: '',
    logoText: 'ELIAS',
  },
  production: {
    jobs: [],
    phaseHistory: [],
    workLogs: [],
    reports: [],
    paceStates: [],
    paceHistory: [],
    identities: [
      {
        role: 'production',
        operatorId: 'tablet-operator',
        operatorName: 'Operatore Produzione',
      },
    ],
  },
  estimates: [],
  jobs: [],
  workflowCounters: {
    estimate: 0,
    job: 0,
  },
  qualityChecklistTemplates: [],
  operatorPrograms: [],
  operatorProgramHistory: [],
  operatorProgramRevision: 0,
  dbRevision: 0,
  dbUpdatedAt: '',
  financeSettings: {
    defaultVatRate: 22,
    defaultPaymentDays: 30,
    minimumProjectedBalance: 0,
    laborHourlyCost: 45,
    laborHoursBase: 'effettive',
    laborOperatorById: {},
    marginThresholds: {
      positive: 15,
      low: 5,
      breakEven: 0,
    },
  },
}

export const normalizePlate = (plate: string) => plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
export const normalizeVin = (vin: string) => vin.trim().toUpperCase().replace(/\s+/g, '')

const id = () => crypto.randomUUID()
const now = () => new Date().toISOString()

const waitingSince = (vehicle: Vehicle) => {
  const latestForCurrentStatus = (vehicle.statusHistory ?? []).find((entry) => entry.to === vehicle.status)
  return latestForCurrentStatus?.at || vehicle.createdAt
}

export function isVehicleWaitingForCone(vehicle: Pick<Vehicle, 'status' | 'coneNumber'>, settings: PlannerSettings = defaultPlannerSettings) {
  return vehicle.coneNumber === null && isVehicleConeRequiredStatus(settings, vehicle.status)
}

export function reconcileVehicleCones(data: ErpData, skipAutoAssignVehicleIds?: Set<string>): ErpData {
  let changed = false
  let history = [...data.coneHistory]
  let vehicles = data.vehicles.map((vehicle) => {
    if (vehicle.coneNumber === null) return vehicle
    if (isVehicleConeRequiredStatus(data.plannerSettings, vehicle.status)) return vehicle
    changed = true
    history.unshift(event(vehicle, vehicle.coneNumber, 'Liberato', 'Rilascio automatico: vettura fuori lavorazione'))
    return { ...vehicle, coneNumber: null }
  })

  const occupied = new Set(vehicles.flatMap((vehicle) => vehicle.coneNumber ?? []))
  const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const waiting = vehicles
    .filter((vehicle) => isVehicleWaitingForCone(vehicle, data.plannerSettings))
    .filter((vehicle) => !skipAutoAssignVehicleIds?.has(vehicle.id))
    .sort((a, b) => waitingSince(a).localeCompare(waitingSince(b)) || a.createdAt.localeCompare(b.createdAt))

  for (const waitingVehicle of waiting) {
    const freeCone = Array.from({ length: TOTAL_CONES }, (_, index) => index + 1)
      .find((cone) => !occupied.has(cone))
    if (freeCone == null) break
    const current = byId.get(waitingVehicle.id)
    if (!current || current.coneNumber !== null) continue
    changed = true
    occupied.add(freeCone)
    byId.set(waitingVehicle.id, { ...current, coneNumber: freeCone })
    history.unshift(event(waitingVehicle, freeCone, 'Assegnato', 'Assegnazione automatica: primo cono libero'))
  }

  if (!changed) return data
  vehicles = data.vehicles.map((vehicle) => byId.get(vehicle.id) ?? vehicle)
  return {
    ...data,
    vehicles,
    coneHistory: history,
  }
}

export function loadData(): ErpData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) as ErpData : emptyData
  } catch {
    return emptyData
  }
}

export function saveData(data: ErpData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

function cleanCustomer(data: Omit<Customer, 'id' | 'createdAt'>) {
  if (!data.name.trim()) throw new Error('Il nome o la ragione sociale è obbligatorio.')
  if (!data.phone.trim()) throw new Error('Il telefono è obbligatorio.')
  return {
    ...data,
    name: data.name.trim(),
    phone: data.phone.trim(),
    email: data.email.trim(),
    taxId: data.taxId.trim().toUpperCase(),
    address: data.address.trim(),
    usualBank: data.usualBank?.trim() || '',
    iban: data.iban?.replace(/\s/g, '').toUpperCase() || '',
    siaCuc: data.siaCuc?.trim().toUpperCase() || '',
  }
}

export function createCustomer(data: Omit<Customer, 'id' | 'createdAt'>): Customer {
  return { ...cleanCustomer(data), id: id(), createdAt: now() }
}

export function updateCustomer(
  customers: Customer[],
  customerId: string,
  data: Omit<Customer, 'id' | 'createdAt'>,
): Customer[] {
  if (!customers.some((customer) => customer.id === customerId)) throw new Error('Cliente non trovato.')
  const cleaned = cleanCustomer(data)
  return customers.map((customer) => customer.id === customerId ? { ...customer, ...cleaned } : customer)
}

export function createVehicle(
  data: Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'>,
  vehicles: Vehicle[],
): Vehicle {
  const plate = normalizePlate(data.plate)
  const vin = normalizeVin(data.vin)
  if (plate.length < 5) throw new Error('Inserisci una targa valida.')
  if (vehicles.some((vehicle) => normalizePlate(vehicle.plate) === plate)) {
    throw new Error('Esiste già una vettura con questa targa.')
  }
  if (vin && vehicles.some((vehicle) => normalizeVin(vehicle.vin) === vin)) {
    throw new Error('Esiste già una vettura con questo VIN.')
  }
  if (!data.customerId) throw new Error('Seleziona il cliente proprietario.')
  return { ...data, plate, vin, id: id(), coneNumber: null, statusMode: 'automatic', suggestedStatus: null, createdAt: now() }
}

export function addVehicle(data: ErpData, input: Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'>): ErpData {
  const initialStatus = resolveVehicleStatusId(data.plannerSettings, input.status || defaultVehicleStatus(data.plannerSettings))
  const vehicle = createVehicle({ ...input, status: initialStatus }, data.vehicles)
  const next = { ...data, vehicles: [vehicle, ...data.vehicles] }
  return changeVehicleStatus(next, vehicle.id, initialStatus, { source: 'automatic', note: 'Stato iniziale vettura.' })
}

export function updateVehicle(
  data: ErpData,
  vehicleId: string,
  input: Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'>,
): ErpData {
  const current = data.vehicles.find((vehicle) => vehicle.id === vehicleId)
  if (!current) throw new Error('Vettura non trovata.')
  const plate = normalizePlate(input.plate)
  const vin = normalizeVin(input.vin)
  if (plate.length < 5) throw new Error('Inserisci una targa valida.')
  if (data.vehicles.some((vehicle) => vehicle.id !== vehicleId && normalizePlate(vehicle.plate) === plate)) {
    throw new Error('Esiste già una vettura con questa targa.')
  }
  if (vin && data.vehicles.some((vehicle) => vehicle.id !== vehicleId && normalizeVin(vehicle.vin) === vin)) {
    throw new Error('Esiste già una vettura con questo VIN.')
  }
  if (!input.customerId) throw new Error('Seleziona il cliente proprietario.')
  return {
    ...data,
    vehicles: data.vehicles.map((vehicle) =>
      vehicle.id === vehicleId ? { ...vehicle, ...input, status: current.status, plate, vin } : vehicle,
    ),
  }
}

export function saveVehicleCostEntries(
  data: ErpData,
  vehicleId: string,
  entries: VehicleCostEntry[],
): ErpData {
  const vehicle = data.vehicles.find((item) => item.id === vehicleId)
  if (!vehicle) throw new Error('Vettura non trovata.')
  const normalizedEntries: VehicleCostEntry[] = entries.map((entry) => ({
    ...entry,
    id: entry.id || id(),
    createdAt: entry.createdAt || now(),
    updatedAt: now(),
    description: entry.description.trim(),
    supplier: entry.supplier?.trim() || '',
    unit: entry.unit.trim() || 'pz',
    quantity: Math.max(0, Number(entry.quantity) || 0),
    unitCost: Math.max(0, Number(entry.unitCost) || 0),
    discount: Math.max(0, Number(entry.discount) || 0),
    total: Math.round((Math.max(0, Number(entry.quantity) || 0) * Math.max(0, Number(entry.unitCost) || 0) - Math.max(0, Number(entry.discount) || 0) + Number.EPSILON) * 100) / 100,
    vatRate: Number(entry.vatRate) || data.financeSettings.defaultVatRate,
    note: entry.note?.trim() || '',
  }))
  const snapshot = calculateVehicleEconomicSnapshot({ ...vehicle, costEntries: normalizedEntries }, data.financeSettings)
  const history = [{
    id: id(),
    vehicleId,
    action: 'modifica' as const,
    previousValue: vehicle.costEntries?.length ? 'Costi aggiornati' : 'Nessun costo registrato',
    newValue: `${normalizedEntries.length} voci di costo · € ${snapshot.totalDirectCosts.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`,
    user: 'Operatore ERP',
    at: now(),
  }, ...(vehicle.costHistory ?? [])]
  return {
    ...data,
    vehicles: data.vehicles.map((item) => item.id === vehicleId ? {
      ...item,
      costEntries: normalizedEntries,
      costHistory: history,
      actualMargin: snapshot.realMargin,
    } : item),
  }
}

export function addVehicleCostEntry(
  data: ErpData,
  vehicleId: string,
  input: Omit<VehicleCostEntry, 'id' | 'createdAt' | 'updatedAt'>,
): ErpData {
  const vehicle = data.vehicles.find((item) => item.id === vehicleId)
  if (!vehicle) throw new Error('Vettura non trovata.')
  const entry: VehicleCostEntry = {
    ...input,
    id: id(),
    createdAt: now(),
    updatedAt: now(),
    total: Math.max(0, Number(input.total) || 0),
  }
  const nextEntries = [...(vehicle.costEntries ?? []), entry]
  const snapshot = calculateVehicleEconomicSnapshot({ ...vehicle, costEntries: nextEntries }, data.financeSettings)
  const history = [{
    id: id(),
    vehicleId,
    action: 'aggiunta' as const,
    previousValue: 'Nessun costo registrato',
    newValue: `${input.description.trim()} · € ${entry.total.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`,
    user: 'Operatore ERP',
    at: now(),
  }, ...(vehicle.costHistory ?? [])]
  return {
    ...data,
    vehicles: data.vehicles.map((item) => item.id === vehicleId ? {
      ...item,
      costEntries: nextEntries,
      costHistory: history,
      actualMargin: snapshot.realMargin,
    } : item),
  }
}

export function deleteCustomer(data: ErpData, customerId: string): ErpData {
  if (data.vehicles.some((vehicle) => vehicle.customerId === customerId)) {
    throw new Error('Non puoi eliminare un cliente con veicoli collegati.')
  }
  if (data.invoices.some((invoice) => invoice.customerId === customerId)) {
    throw new Error('Non puoi eliminare un cliente con documenti contabili collegati.')
  }
  return { ...data, customers: data.customers.filter((customer) => customer.id !== customerId) }
}

export function deleteVehicle(data: ErpData, vehicleId: string): ErpData {
  const vehicle = data.vehicles.find((item) => item.id === vehicleId)
  if (!vehicle) throw new Error('Vettura non trovata.')
  if (vehicle.invoiceId) throw new Error('Non puoi eliminare una vettura già collegata a una fattura.')
  const history = vehicle.coneNumber === null
    ? data.coneHistory
    : [event(vehicle, vehicle.coneNumber, 'Liberato', 'Vettura eliminata dall’archivio'), ...data.coneHistory]
  return { ...data, vehicles: data.vehicles.filter((item) => item.id !== vehicleId), coneHistory: history }
}

const event = (
  vehicle: Pick<Vehicle, 'id' | 'plate'>,
  coneNumber: number,
  action: ConeEvent['action'],
  note: string,
): ConeEvent => ({ id: id(), vehicleId: vehicle.id, vehiclePlate: vehicle.plate, coneNumber, action, note, timestamp: now() })

const statusHistoryEvent = (
  vehicleId: string,
  from: VehicleStatus,
  to: VehicleStatus,
  note: string,
  source: 'manual' | 'automatic',
): VehicleStatusChange => ({
  id: id(),
  vehicleId,
  from,
  to,
  at: now(),
  note,
  source,
})

export function changeVehicleStatus(
  data: ErpData,
  vehicleId: string,
  status: VehicleStatus,
  options?: { source?: 'manual' | 'automatic'; note?: string; forceAutomatic?: boolean },
): ErpData {
  const vehicle = data.vehicles.find((item) => item.id === vehicleId)
  if (!vehicle) throw new Error('Vettura non trovata.')
  const source = options?.source ?? 'manual'
  const nextStatus = resolveVehicleStatusId(data.plannerSettings, status)

  const history = [...data.coneHistory]
  const statusHistory = [...(vehicle.statusHistory ?? [])]

  if (source === 'automatic' && vehicle.statusMode === 'manual' && vehicle.status !== nextStatus && !options?.forceAutomatic) {
    return {
      ...data,
      vehicles: data.vehicles.map((item) => item.id === vehicleId ? {
        ...item,
        suggestedStatus: nextStatus,
      } : item),
    }
  }

  if (vehicle.status !== nextStatus) {
    statusHistory.unshift(statusHistoryEvent(
      vehicleId,
      vehicle.status,
      nextStatus,
      options?.note || `Cambio stato registrato in ${nextStatus}.`,
      source,
    ))
  }

  return reconcileVehicleCones({
    ...data,
    coneHistory: history,
    vehicles: data.vehicles.map((item) =>
      item.id === vehicleId
        ? {
            ...item,
            status: nextStatus,
            statusMode: source,
            suggestedStatus: source === 'automatic' ? item.suggestedStatus : null,
            coneNumber: item.coneNumber,
            deliveredAt: nextStatus === resolveVehicleStatusId(data.plannerSettings, 'Consegnata') ? (item.deliveredAt || now()) : item.deliveredAt,
            billingStatus: nextStatus === resolveVehicleStatusId(data.plannerSettings, 'Consegnata') && !item.invoiceId ? 'Da fatturare' : item.billingStatus,
            statusHistory,
          }
        : item,
    ),
  })
}

export function moveVehicleCone(data: ErpData, vehicleId: string, newCone: number | null): ErpData {
  const vehicle = data.vehicles.find((item) => item.id === vehicleId)
  if (!vehicle) throw new Error('Vettura non trovata.')
  if (newCone !== null && (newCone < 1 || newCone > TOTAL_CONES)) throw new Error('Cono non valido.')
  if (newCone !== null && data.vehicles.some((item) => item.id !== vehicleId && item.coneNumber === newCone)) {
    throw new Error(`Il cono ${newCone} è già occupato.`)
  }
  if (vehicle.coneNumber === newCone) return data

  if (newCone === null) {
    if (vehicle.coneNumber === null) return data
    return reconcileVehicleCones({
      ...data,
      vehicles: data.vehicles.map((item) =>
        item.id === vehicleId ? { ...item, coneNumber: null } : item,
      ),
      coneHistory: [
        event(vehicle, vehicle.coneNumber, 'Liberato', 'Rilascio manuale cono'),
        ...data.coneHistory,
      ],
    }, new Set([vehicleId]))
  }

  if (vehicle.coneNumber === null) {
    return reconcileVehicleCones({
      ...data,
      vehicles: data.vehicles.map((item) =>
        item.id === vehicleId ? { ...item, coneNumber: newCone } : item,
      ),
      coneHistory: [
        event(vehicle, newCone, 'Assegnato', 'Assegnazione manuale cono'),
        ...data.coneHistory,
      ],
    })
  }

  const oldCone = vehicle.coneNumber
  return reconcileVehicleCones({
    ...data,
    vehicles: data.vehicles.map((item) =>
      item.id === vehicleId ? { ...item, coneNumber: newCone } : item,
    ),
    coneHistory: [
      event(vehicle, newCone, 'Spostato', `Spostamento manuale dal cono ${oldCone}`),
      event(vehicle, oldCone, 'Liberato', `Spostamento manuale al cono ${newCone}`),
      ...data.coneHistory,
    ],
  })
}
