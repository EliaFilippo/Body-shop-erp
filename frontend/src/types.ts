export type View = 'dashboard' | 'customers' | 'vehicles' | 'cones' | 'planner' | 'planner-settings' | 'monthly-goals' | 'acceptance' | 'finance'
export type CustomerType = 'Concessionario' | 'Privato' | 'Assicurazione' | 'Società' | 'Azienda'
export type VehicleStatus =
  | 'da accettare'
  | 'accettata'
  | 'in attesa autorizzazione'
  | 'da smontare'
  | 'in lavorazione'
  | 'preparazione'
  | 'verniciatura'
  | 'rimontaggio'
  | 'lucidatura'
  | 'lavaggio'
  | 'controllo qualità'
  | 'pronta'
  | 'consegnata'
  | 'sospesa'
  | 'annullata'
  | 'Accettata'
  | 'Confermata'
  | 'Pronta'
  | 'Consegnata'
export type PaymentMethod = 'Bonifico' | 'R.I.B.A.' | 'Contanti' | 'POS' | 'Personalizzato'
export type InvoiceStatus = 'Da incassare' | 'Parzialmente inserita in R.I.B.A.' | 'Inserita in R.I.B.A.' | 'Anticipata' | 'Incassata' | 'Scaduta' | 'Insoluta' | 'Contestata' | 'Stornata'
export type RibaBatchStatus = 'Bozza' | 'Presentata' | 'Anticipata' | 'Chiusa' | 'Insoluta' | 'Stornata'
export type AcceptanceLineKind = 'labor' | 'parts' | 'consumption' | 'external' | 'other' | 'discount' | 'surcharge'
export type AcceptanceDocumentSide = 'front' | 'back'
export type OcrConfidence = 'high' | 'medium' | 'low'

export interface Customer {
  id: string
  type: CustomerType
  category?: CustomerType
  name: string
  phone: string
  email: string
  taxId: string
  address: string
  usualPaymentMethod?: PaymentMethod
  paymentDays?: number
  endOfMonth?: boolean
  priority?: 'Normale' | 'Alta' | 'Urgente'
  usualBank?: string
  iban?: string
  siaCuc?: string
  ribaBankId?: string
  createdAt: string
}

export type VehicleCostCategory = 'vernice' | 'trasparente' | 'fondo' | 'stucco' | 'carta abrasiva' | 'nastro e materiale da mascheratura' | 'minuteria' | 'ricambi' | 'materiali di lucidatura' | 'lavorazioni esterne' | 'lavaggio' | 'trasporto' | 'smaltimento' | 'altro'

export interface VehicleCostEntry {
  id: string
  usedAt: string
  category: VehicleCostCategory
  description: string
  supplier?: string
  quantity: number
  unit: string
  unitCost: number
  discount: number
  total: number
  vatRate: number
  documentNo?: string
  note?: string
  createdAt: string
  updatedAt: string
}

export interface VehicleEconomicChange {
  id: string
  vehicleId: string
  action: 'aggiunta' | 'modifica' | 'eliminazione'
  previousValue: string
  newValue: string
  user: string
  at: string
}

export interface VehicleStatusChange {
  id: string
  vehicleId: string
  from: VehicleStatus
  to: VehicleStatus
  at: string
  note: string
}

export interface Vehicle {
  id: string
  customerId: string
  plate: string
  make: string
  model: string
  version?: string
  color: string
  year: string
  vin: string
  chassisNumber?: string
  mileage: string
  status: VehicleStatus
  coneNumber: number | null
  priority?: 'Normale' | 'Alta' | 'Urgente'
  deliveryDate?: string
  entryDate?: string
  estimatedHours: number
  workedHours: number
  plannedEntryDate: string
  requestedDeliveryDate: string
  calculatedDeliveryDate: string
  expectedRevenue: number
  expectedMargin: number
  agreementAmount?: number
  materialsCost?: number
  externalCosts?: number
  actualMargin?: number
  notes?: string
  partsStatus: 'Disponibili' | 'Ordinati' | 'Mancanti'
  blockReason: string
  manualPlanningDate: string
  invoiceId?: string | null
  deliveredAt?: string
  billingStatus?: 'Non fatturabile' | 'Da fatturare' | 'Fatturata'
  assignedEmployees?: string[]
  costEntries?: VehicleCostEntry[]
  costHistory?: VehicleEconomicChange[]
  statusHistory?: VehicleStatusChange[]
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

export interface MonthlyGoalRecord {
  id: string
  monthKey: string
  revenueGoal: number
  revenueActual: number
  marginGoal: number | null
  marginActual: number
  forecastRevenue: number
  updatedAt: string
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
  monthlyGoalHistory?: MonthlyGoalRecord[]
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
  laborHourlyCost?: number
  laborHoursBase?: 'preventivate' | 'effettive'
  laborOperatorById?: Record<string, number>
  marginThresholds?: {
    positive?: number
    low?: number
    breakEven?: number
  }
}

export interface OcrFieldDraft {
  value: string
  confidence: OcrConfidence
  source: 'ocr' | 'manual'
}

export interface CustomerDocumentDraft {
  id: string
  side: AcceptanceDocumentSide
  name: string
  dataUrl: string
  fields: {
    name: OcrFieldDraft
    surname: OcrFieldDraft
    taxId: OcrFieldDraft
    birthDate: OcrFieldDraft
    birthPlace: OcrFieldDraft
    residence: OcrFieldDraft
    documentNumber: OcrFieldDraft
    issueDate: OcrFieldDraft
    expiryDate: OcrFieldDraft
    issuingAuthority: OcrFieldDraft
  }
}

export interface VehicleBookletDraft {
  id: string
  name: string
  dataUrl: string
  fields: {
    plate: OcrFieldDraft
    vin: OcrFieldDraft
    make: OcrFieldDraft
    model: OcrFieldDraft
    firstRegistration: OcrFieldDraft
    fuel: OcrFieldDraft
    engineDisplacement: OcrFieldDraft
    power: OcrFieldDraft
    owner: OcrFieldDraft
  }
}

export interface AcceptanceLine {
  id: string
  kind: AcceptanceLineKind
  description: string
  quantity: number
  unitCost: number
  unitPrice: number
  source: 'manual' | 'auto'
}

export interface AcceptanceQuote {
  id: string
  monthKey: string
  hourlyRate: number
  productiveHours: number
  monthlyEconomicGoal: number
  appliedVatRate: number
  materialPercent: number
  lines: AcceptanceLine[]
}

export interface AcceptanceChecklistItem {
  id: string
  label: string
  checked: boolean
}

export interface AcceptanceIntakeData {
  mileage: string
  fuelLevel: string
  occurredAt: string
  operator: string
  damageDescription: string
  accessories: string[]
  customerNotes: string
  checklist: AcceptanceChecklistItem[]
  signatureDataUrl: string
}

export interface AcceptancePhotoEntry {
  id: string
  acceptanceId: string
  vehicleId: string
  category: 'ingresso' | 'danni' | 'lavorazione' | 'fine lavori' | 'consegna'
  name: string
  dataUrl: string
  caption: string
  createdAt: string
}

export interface AcceptanceCase {
  id: string
  customerId: string
  vehicleId: string
  customerDraft: CustomerDocumentDraft[]
  vehicleBooklet: VehicleBookletDraft[]
  damagePhotos: string[]
  quote: AcceptanceQuote
  signatureDataUrl: string
  intake?: AcceptanceIntakeData
  photos?: AcceptancePhotoEntry[]
  createdAt: string
  updatedAt: string
  status: 'draft' | 'confirmed'
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
  acceptances?: AcceptanceCase[]
}
