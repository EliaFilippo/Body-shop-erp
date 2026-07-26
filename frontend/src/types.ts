export type View = 'dashboard' | 'customers' | 'vehicles' | 'cones' | 'planner' | 'planner-settings'
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
  estimatedHours: number
  workedHours: number
  plannedEntryDate: string
  requestedDeliveryDate: string
  calculatedDeliveryDate: string
  expectedRevenue: number
  expectedMargin: number
  partsStatus: 'Disponibili' | 'Ordinati' | 'Mancanti'
  blockReason: string
  manualPlanningDate: string
  createdAt: string
}

export interface PlannerOperator {
  id: string
  name: string
  dailyHours: number
  active: boolean
}

export interface PlannerAbsence {
  id: string
  operatorId: string
  startDate: string
  endDate: string
  hoursPerDay: number | null
  reason: string
}

export interface PlannerSettings {
  operators: PlannerOperator[]
  workingDays: number[]
  efficiencyPercent: number
  safetyMarginPercent: number
  holidays: string[]
  closures: string[]
  absences: PlannerAbsence[]
  monthlyRevenueGoal: number
  monthlyMarginGoal: number | null
}

export interface PlannerAssignment {
  vehicleId: string
  date: string
  protectedHours: number
  normalHours: number
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
  plannerSettings: PlannerSettings
  plannerAssignments: PlannerAssignment[]
}
