import type { ConeEvent, Customer, ErpData, Vehicle, VehicleStatus } from '../types'

export const TOTAL_CONES = 30
export const STORAGE_KEY = 'carrozzeria-elias-erp-v1'

export const emptyData: ErpData = { customers: [], vehicles: [], coneHistory: [] }

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

export function createCustomer(data: Omit<Customer, 'id' | 'createdAt'>): Customer {
  if (!data.name.trim()) throw new Error('Il nome o la ragione sociale è obbligatorio.')
  if (!data.phone.trim()) throw new Error('Il telefono è obbligatorio.')
  return { ...data, name: data.name.trim(), id: id(), createdAt: now() }
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

const event = (
  vehicleId: string,
  coneNumber: number,
  action: ConeEvent['action'],
  note: string,
): ConeEvent => ({ id: id(), vehicleId, coneNumber, action, note, timestamp: now() })

export function changeVehicleStatus(data: ErpData, vehicleId: string, status: VehicleStatus): ErpData {
  const vehicle = data.vehicles.find((item) => item.id === vehicleId)
  if (!vehicle) throw new Error('Vettura non trovata.')

  let coneNumber = vehicle.coneNumber
  const history = [...data.coneHistory]

  if (status === 'Confermata' && coneNumber === null) {
    const occupied = new Set(data.vehicles.flatMap((item) => item.coneNumber ?? []))
    coneNumber = Array.from({ length: TOTAL_CONES }, (_, index) => index + 1)
      .find((number) => !occupied.has(number)) ?? null
    if (coneNumber === null) throw new Error('Tutti i 30 coni sono occupati.')
    history.unshift(event(vehicleId, coneNumber, 'Assegnato', 'Primo cono libero assegnato automaticamente'))
  }

  if (status === 'Consegnata' && coneNumber !== null) {
    history.unshift(event(vehicleId, coneNumber, 'Liberato', 'Vettura consegnata'))
    coneNumber = null
  }

  return {
    ...data,
    coneHistory: history,
    vehicles: data.vehicles.map((item) =>
      item.id === vehicleId ? { ...item, status, coneNumber } : item,
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
      event(vehicleId, newCone, 'Spostato', `Spostamento manuale dal cono ${oldCone}`),
      event(vehicleId, oldCone, 'Liberato', `Spostamento manuale al cono ${newCone}`),
      ...data.coneHistory,
    ],
  }
}

