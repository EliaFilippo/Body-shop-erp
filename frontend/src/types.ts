export type View = 'dashboard' | 'customers' | 'vehicles' | 'cones' | 'planner'
export type CustomerType = 'Privato' | 'Azienda'
export type VehicleStatus = 'Accettata' | 'Confermata' | 'In lavorazione' | 'Pronta' | 'Consegnata'

export interface Customer {
  id: string
  type: CustomerType
  name: string
  phone: string
  email: string
  taxId: string
  address: string
  createdAt: string
}

export interface Vehicle {
  id: string
  customerId: string
  plate: string
  make: string
  model: string
  color: string
  year: string
  vin: string
  mileage: string
  status: VehicleStatus
  coneNumber: number | null
  priority?: 'Normale' | 'Alta' | 'Urgente'
  deliveryDate?: string
  createdAt: string
}

export interface ConeEvent {
  id: string
  vehicleId: string
  vehiclePlate: string
  coneNumber: number
  action: 'Assegnato' | 'Spostato' | 'Liberato'
  timestamp: string
  note: string
}

export interface ErpData {
  customers: Customer[]
  vehicles: Vehicle[]
  coneHistory: ConeEvent[]
}
