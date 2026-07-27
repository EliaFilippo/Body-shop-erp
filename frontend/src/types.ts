export type View = 'dashboard' | 'customers' | 'vehicles' | 'cones' | 'planner' | 'planner-settings' | 'finance'
export type CustomerType = 'Privato' | 'Azienda'
export type VehicleStatus = 'Accettata' | 'Confermata' | 'In lavorazione' | 'Pronta' | 'Consegnata'
export type PaymentMethod = 'Bonifico' | 'R.I.B.A.' | 'Contanti' | 'POS' | 'Personalizzato'
export type InvoiceStatus = 'Da incassare' | 'Parzialmente inserita in R.I.B.A.' | 'Inserita in R.I.B.A.' | 'Anticipata' | 'Incassata' | 'Scaduta' | 'Insoluta' | 'Contestata' | 'Stornata'
export type RibaBatchStatus = 'Bozza' | 'Presentata' | 'Anticipata' | 'Chiusa' | 'Insoluta' | 'Stornata'

export interface Customer {
  id: string
  type: CustomerType
  name: string
  phone: string
  email: string
  taxId: string
  address: string
  usualPaymentMethod?: PaymentMethod
  paymentDays?: number
  endOfMonth?: boolean
  usualBank?: string
  iban?: string
  siaCuc?: string
  ribaBankId?: string
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
  invoiceId?: string | null
  deliveredAt?: string
  billingStatus?: 'Non fatturabile' | 'Da fatturare' | 'Fatturata'
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

export interface InvoiceLine {
  id: string
  vehicleId: string
  description: string
  taxableAmount: number
  vatRate: number
  vatAmount: number
  total: number
}

export interface Invoice {
  id: string
  customerId: string
  number: string
  issueDate: string
  dueDate: string
  paymentMethod: PaymentMethod
  lines: InvoiceLine[]
  taxableAmount: number
  vatAmount: number
  total: number
  collectedAmount: number
  ribaAllocatedAmount: number
  status: InvoiceStatus
  notes: string
  createdAt: string
  updatedAt: string
}

export interface BankAccount {
  id: string
  name: string
  iban: string
  creditLimit: number
  blockOverLimit: boolean
  minimumBalanceAlert: number
  currentBalance: number
  createdAt: string
}

export interface RibaAllocation {
  id: string
  invoiceId: string
  amount: number
}

export interface RibaBatch {
  id: string
  number: string
  bankAccountId: string
  presentationDate: string
  dueDate: string
  allocations: RibaAllocation[]
  total: number
  advancedAmount: number
  advanceDate: string
  fees: number
  interest: number
  status: RibaBatchStatus
  createdAt: string
  updatedAt: string
}

export interface FinancialEvent {
  id: string
  type: 'Fattura emessa' | 'R.I.B.A. presentata' | 'Anticipo bancario' | 'Incasso definitivo' | 'Insoluto' | 'Storno' | 'Uscita prevista'
  date: string
  amount: number
  customerId?: string
  invoiceId?: string
  ribaBatchId?: string
  bankAccountId?: string
  note: string
  createdAt: string
}

export interface FinanceSettings {
  defaultVatRate: number
  defaultPaymentDays: number
  minimumProjectedBalance: number
}

export interface ErpData {
  customers: Customer[]
  vehicles: Vehicle[]
  coneHistory: ConeEvent[]
  plannerSettings: PlannerSettings
  plannerAssignments: PlannerAssignment[]
  invoices: Invoice[]
  bankAccounts: BankAccount[]
  ribaBatches: RibaBatch[]
  financialEvents: FinancialEvent[]
  financeSettings: FinanceSettings
}
