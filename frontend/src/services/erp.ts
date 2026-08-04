import type { ConeEvent, Customer, ErpData, PlannerSettings, Vehicle, VehicleCostEntry, VehicleStatus, VehicleStatusChange } from '../types'
import { calculateVehicleEconomicSnapshot } from './economic'

export const TOTAL_CONES = 30
export const STORAGE_KEY = 'carrozzeria-elias-erp-v1'

export const defaultPlannerSettings: PlannerSettings = {
  operators: [],
  workingDays: [1, 2, 3, 4, 5],
  efficiencyPercent: 85,
  safetyMarginPercent: 15,
  holidays: [],
  closures: [],
  absences: [],
  monthlyRevenueGoal: 0,
  monthlyMarginGoal: null,
  monthlyGoalHistory: [],
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

const id = () => crypto.randomUUID()
const now = () => new Date().toISOString()

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
  if (plate.length < 5) throw new Error('Inserisci una targa valida.')
  if (vehicles.some((vehicle) => normalizePlate(vehicle.plate) === plate)) {
    throw new Error(`La targa ${plate} è già presente.`)
  }
  if (!data.customerId) throw new Error('Seleziona il cliente proprietario.')
  return { ...data, plate, id: id(), coneNumber: null, createdAt: now() }
}

export function addVehicle(data: ErpData, input: Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'>): ErpData {
  const vehicle = createVehicle(input, data.vehicles)
  const next = { ...data, vehicles: [vehicle, ...data.vehicles] }
  return input.status === 'Confermata' ? changeVehicleStatus(next, vehicle.id, 'Confermata') : next
}

export function updateVehicle(
  data: ErpData,
  vehicleId: string,
  input: Omit<Vehicle, 'id' | 'createdAt' | 'coneNumber'>,
): ErpData {
  const current = data.vehicles.find((vehicle) => vehicle.id === vehicleId)
  if (!current) throw new Error('Vettura non trovata.')
  const plate = normalizePlate(input.plate)
  if (plate.length < 5) throw new Error('Inserisci una targa valida.')
  if (data.vehicles.some((vehicle) => vehicle.id !== vehicleId && normalizePlate(vehicle.plate) === plate)) {
    throw new Error(`La targa ${plate} è già presente.`)
  }
  if (!input.customerId) throw new Error('Seleziona il cliente proprietario.')
  return {
    ...data,
    vehicles: data.vehicles.map((vehicle) =>
      vehicle.id === vehicleId ? { ...vehicle, ...input, status: current.status, plate } : vehicle,
    ),
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
): VehicleStatusChange => ({
  id: id(),
  vehicleId,
  from,
  to,
  at: now(),
  note,
})

export function changeVehicleStatus(data: ErpData, vehicleId: string, status: VehicleStatus): ErpData {
  const vehicle = data.vehicles.find((item) => item.id === vehicleId)
  if (!vehicle) throw new Error('Vettura non trovata.')

  let coneNumber = vehicle.coneNumber
  const history = [...data.coneHistory]
  const statusHistory = [...(vehicle.statusHistory ?? [])]

  if (status === 'Confermata' && coneNumber === null) {
    const occupied = new Set(data.vehicles.flatMap((item) => item.coneNumber ?? []))
    coneNumber = Array.from({ length: TOTAL_CONES }, (_, index) => index + 1)
      .find((number) => !occupied.has(number)) ?? null
    if (coneNumber === null) throw new Error('Tutti i 30 coni sono occupati.')
    history.unshift(event(vehicle, coneNumber, 'Assegnato', 'Primo cono libero assegnato automaticamente'))
  }

  if (status === 'Consegnata' && coneNumber !== null) {
    history.unshift(event(vehicle, coneNumber, 'Liberato', 'Vettura consegnata'))
    coneNumber = null
  }

  if (vehicle.status !== status) {
    statusHistory.unshift(statusHistoryEvent(vehicleId, vehicle.status, status, `Cambio stato registrato in ${status}.`))
  }

  return {
    ...data,
    coneHistory: history,
    vehicles: data.vehicles.map((item) =>
      item.id === vehicleId
        ? {
            ...item,
            status,
            coneNumber,
            deliveredAt: status === 'Consegnata' ? (item.deliveredAt || now()) : item.deliveredAt,
            billingStatus: status === 'Consegnata' && !item.invoiceId ? 'Da fatturare' : item.billingStatus,
            statusHistory,
          }
        : item,
    ),
  }
}

export function moveVehicleCone(data: ErpData, vehicleId: string, newCone: number): ErpData {
  if (newCone < 1 || newCone > TOTAL_CONES) throw new Error('Cono non valido.')
  const vehicle = data.vehicles.find((item) => item.id === vehicleId)
  if (!vehicle?.coneNumber) throw new Error('La vettura non ha un cono assegnato.')
  if (data.vehicles.some((item) => item.id !== vehicleId && item.coneNumber === newCone)) {
    throw new Error(`Il cono ${newCone} è già occupato.`)
  }
  if (vehicle.coneNumber === newCone) return data
  const oldCone = vehicle.coneNumber
  return {
    ...data,
    vehicles: data.vehicles.map((item) =>
      item.id === vehicleId ? { ...item, coneNumber: newCone } : item,
    ),
    coneHistory: [
      event(vehicle, newCone, 'Spostato', `Spostamento manuale dal cono ${oldCone}`),
      event(vehicle, oldCone, 'Liberato', `Spostamento manuale al cono ${newCone}`),
      ...data.coneHistory,
    ],
  }
}
