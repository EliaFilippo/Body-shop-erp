export type View = 'dashboard' | 'today-shop' | 'customers' | 'vehicles' | 'cones' | 'planner' | 'settings' | 'planner-settings' | 'vehicle-statuses' | 'work-hours' | 'price-list' | 'internal-costs' | 'operator-program' | 'monthly-goals' | 'database-diagnostics' | 'acceptance' | 'pending-cases' | 'confirmed-cases' | 'finance' | 'estimates-jobs'
export type CustomerType = 'Concessionario' | 'Privato' | 'Assicurazione' | 'Società' | 'Azienda'
export type VehicleStatus = string
export type VehicleStatusSemantic = 'accepted' | 'planning' | 'waiting' | 'waiting-parts' | 'phase' | 'in-work' | 'ready' | 'delivered' | 'blocked' | 'cancelled' | 'custom'

export interface VehicleStatusDefinition {
  id: string
  label: string
  color: string
  icon: string
  active: boolean
  sortOrder: number
  semantic: VehicleStatusSemantic
}
export type PaymentMethod = 'Bonifico' | 'R.I.B.A.' | 'Contanti' | 'POS' | 'Personalizzato'
export type InvoiceStatus = 'Da incassare' | 'Parzialmente inserita in R.I.B.A.' | 'Inserita in R.I.B.A.' | 'Anticipata' | 'Incassata' | 'Scaduta' | 'Insoluta' | 'Contestata' | 'Stornata'
export type RibaBatchStatus = 'Bozza' | 'Presentata' | 'Anticipata' | 'Chiusa' | 'Insoluta' | 'Stornata'
export type QuoteStatus = 'bozza' | 'inviato' | 'accettato' | 'rifiutato'
export type InvoiceDocumentStatus = 'bozza' | 'emessa' | 'parzialmente pagata' | 'pagata' | 'scaduta'
export type AcceptanceLineKind = 'labor' | 'parts' | 'consumption' | 'external' | 'other' | 'discount' | 'surcharge'
export type AcceptanceDocumentSide = 'front' | 'back'
export type OcrConfidence = 'high' | 'medium' | 'low'
export type CommunicationChannel = 'email' | 'whatsapp' | 'copy'
export type ProductionPhase = 'Da iniziare' | 'Smontaggio' | 'Lattoneria' | 'Preparazione' | 'Verniciatura' | 'Rimontaggio' | 'Lucidatura' | 'Lavaggio/Controllo' | 'Pronta'
export type ProductionReportType = 'ricambio mancante' | 'problema tecnico' | 'lavorazione aggiuntiva' | 'danno non previsto' | 'richiesta all\'ufficio' | 'altro'
export type ProductionRole = 'production' | 'office' | 'owner'

export interface ProductionOperatorIdentity {
  role: ProductionRole
  operatorId: string
  operatorName: string
}

export interface ProductionJobState {
  vehicleId: string
  phase: ProductionPhase
  priority: 'Normale' | 'Alta' | 'Urgente'
  assignedWorks: string[]
  operationalNotes: string
  promisedAt: string
  updatedAt: string
}

export interface ProductionPhaseHistoryEntry {
  id: string
  vehicleId: string
  operatorId: string
  operatorName: string
  previousPhase: ProductionPhase
  nextPhase: ProductionPhase
  createdAt: string
  note: string
}

export interface ProductionWorkLog {
  id: string
  vehicleId: string
  phase: ProductionPhase
  operatorId: string
  operatorName: string
  startedAt: string
  lastResumedAt?: string
  pausedAt?: string
  endedAt?: string
  totalMinutes: number
  status: 'running' | 'paused' | 'completed'
}

export type ProductionPaceLevel = 'IN ORARIO' | 'A RISCHIO' | 'IN RITARDO'
export type PlannerPhaseTrackingMetric = 'calendar' | 'man-hours'

export interface ProductionPaceState {
  id: string
  vehicleId: string
  jobId: string
  phaseId: string
  phaseName: string
  metric: PlannerPhaseTrackingMetric
  estimatedMinutes: number
  workedMinutes: number
  residualMinutes: number
  consumedPercent: number
  level: ProductionPaceLevel
  preAlertAt?: string
  delayedAt?: string
  finalDelayMinutes?: number
  operators: string[]
  updatedAt: string
}

export interface ProductionPaceHistoryEntry {
  id: string
  vehicleId: string
  jobId: string
  phaseId: string
  phaseName: string
  at: string
  event: 'pre-alert' | 'delay-start' | 'delay-final' | 'planner-recalculation' | 'auto-support-assigned' | 'auto-support-skipped'
  message: string
  delayMinutes?: number
  operators: string[]
}

export interface ProductionReport {
  id: string
  vehicleId: string
  type: ProductionReportType
  note: string
  photoDataUrl?: string
  operatorId: string
  operatorName: string
  createdAt: string
  resolvedAt?: string
}

export interface ProductionModule {
  jobs: ProductionJobState[]
  phaseHistory: ProductionPhaseHistoryEntry[]
  workLogs: ProductionWorkLog[]
  reports: ProductionReport[]
  identities: ProductionOperatorIdentity[]
  paceStates: ProductionPaceState[]
  paceHistory: ProductionPaceHistoryEntry[]
}

export interface DocumentLine {
  id: string
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
  discountRate: number
  taxableAmount: number
  vatAmount: number
  total: number
}

export interface QuoteDocument {
  id: string
  number: string
  customerId: string
  vehicleId: string
  acceptanceId?: string
  invoiceId?: string
  issueDate: string
  dueDate: string
  status: QuoteStatus
  lines: DocumentLine[]
  taxableAmount: number
  vatAmount: number
  total: number
  notes: string
  createdAt: string
  updatedAt: string
}

export interface CommunicationEntry {
  id: string
  channel: CommunicationChannel
  documentType: 'preventivo' | 'fattura'
  documentId: string
  customerId: string
  vehicleId?: string
  message: string
  target: string
  createdAt: string
}

export interface DocumentCounters {
  quote: number
  invoice: number
}

export interface CompanyProfile {
  name: string
  vatId: string
  taxCode: string
  address: string
  phone: string
  email: string
  logoText: string
}

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

export type VehicleCostCategory = 'ricambi' | 'materiale verniciatura' | 'manodopera esterna' | 'meccanica' | 'cristalli' | 'pneumatici' | 'lavaggio' | 'lucidatura' | 'trasporto' | 'noleggio' | 'smaltimento' | 'altro' | 'vernice' | 'trasparente' | 'fondo' | 'stucco' | 'carta abrasiva' | 'nastro e materiale da mascheratura' | 'minuteria' | 'materiali di lucidatura' | 'lavorazioni esterne'

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
  source?: 'manual' | 'automatic'
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
  statusMode?: 'manual' | 'automatic'
  suggestedStatus?: VehicleStatus | null
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
  skills?: string[]
  weeklySchedule?: WeeklyWorkDaySchedule[]
}

export interface WorkDayInterval {
  startTime: string
  endTime: string
}

export interface WeeklyWorkDaySchedule {
  dayOfWeek: number
  active: boolean
  intervals: WorkDayInterval[]
}

export type CompanyClosureType = 'festivita' | 'ferie' | 'chiusura-straordinaria' | 'mezza-giornata' | 'indisponibilita'

export interface CompanyClosureEntry {
  id: string
  type: CompanyClosureType
  startDate: string
  endDate: string
  startTime?: string
  endTime?: string
  note: string
}

export interface OperatorProgramTask {
  id: string
  operatorId: string
  operatorName: string
  vehicleId: string
  plate: string
  jobId: string
  jobNumber: string
  phaseId: string
  phaseName: string
  startAt: string
  endAt: string
  plannedMinutes: number
  priority: 'Normale' | 'Alta' | 'Urgente'
  reason: string
  panelNames?: string[]
  panelNotes?: string[]
  originalPlannedDate?: string
  scheduleDeltaMinutes?: number
  isAdvancedFromFuture?: boolean
  overtimeMinutes?: number
  revision: number
}

export interface OperatorDayProgram {
  date: string
  operatorId: string
  operatorName: string
  tasks: OperatorProgramTask[]
  generatedAt: string
  revision: number
  summary?: OperatorDayProgramSummary
}

export interface OperatorDayProgramSummary {
  plannedMinutes: number
  actualMinutes: number
  differenceMinutes: number
  overtimeMinutes: number
  advancedMinutes: number
  completedPlannedMinutes: number
  efficiencyPercent: number
}

export interface OperatorProgramHistoryEntry {
  id: string
  date: string
  generatedAt: string
  revision: number
  reason: string
  programs: OperatorDayProgram[]
  previousPrograms?: OperatorDayProgram[]
}

export interface PlannerAbsence {
  id: string
  operatorId: string
  startDate: string
  endDate: string
  hoursPerDay: number | null
  reason: string
}

export interface StandardWorkDefinition {
  id: string
  name: string
  calculationType: 'per-vehicle' | 'per-panel'
  standardMinutes: number
  technicalWaitMinutes?: number
  technicalWaitBlocksPhaseNames?: string[]
  categoryOrPhase?: string
  rules?: StandardWorkRule[]
  active: boolean
  requiredSkill?: string
  cycleOrder: number
}

export interface StandardWorkRuleCondition {
  vehicleSizeClass?: 'piccola' | 'media' | 'grande' | ''
  colorFamily?: string
  paintCycle?: string
  minPanels?: number | null
  maxPanels?: number | null
  attributes?: Record<string, string>
}

export interface StandardWorkRule {
  id: string
  name: string
  minutes: number
  priority: number
  active: boolean
  conditions?: StandardWorkRuleCondition
}

export interface StandardWorkRuleHistoryEntry {
  id: string
  at: string
  workId: string
  workName: string
  ruleId: string
  action: 'create' | 'update' | 'duplicate' | 'deactivate' | 'delete'
  snapshot: StandardWorkRule
}

export interface StandardWorkPriceListItem {
  id: string
  workId?: string
  panelName: string
  workName: string
  repairExtent?: 'intero' | 'mezzo' | ''
  variantCycle: string
  vatRate?: number
  unitPrice: number
  active: boolean
  note?: string
}

export interface StandardWorkPriceHistoryEntry {
  id: string
  at: string
  itemId: string
  operation?: 'create' | 'update' | 'activate' | 'deactivate' | 'delete'
  previousValue: StandardWorkPriceListItem
  newValue: StandardWorkPriceListItem
}

export interface StandardWorkTimePreset {
  id: string
  workId?: string
  workName: string
  panelName: string
  variantCycle: string
  minutes: number
  active: boolean
  note?: string
}

export type InternalMonthlyCostCategory =
  | 'personale'
  | 'affitto'
  | 'noleggi-leasing'
  | 'energia'
  | 'assicurazioni'
  | 'software'
  | 'consulenze-amministrazione'
  | 'utenze'
  | 'altri-costi-fissi'
  | 'altri-costi-generali'

export interface InternalMonthlyCostItem {
  id: string
  category: InternalMonthlyCostCategory
  description: string
  monthlyAmount: number
  active: boolean
}

export interface InternalProductiveCapacitySettings {
  productiveOperators: number
  hoursPerOperatorPerDay: number
  workingDaysPerMonth: number
  efficiencyPercent: number
}

export interface InternalCostSettings {
  internalHourlyRate: number
  minimumMarginPercent: number
  monthlyCostItems?: InternalMonthlyCostItem[]
  productiveCapacity?: InternalProductiveCapacitySettings
  useManualHourlyRate?: boolean
  manualHourlyRate?: number | null
  futureHourlyRateBySkill?: Record<string, number>
}

export interface EstimateProductionForecast {
  firstAvailabilityDate: string
  estimatedStartAt: string
  technicalCompletionAt: string
  advisedDeliveryDate: string
  productiveDurationMinutes: number
  calendarDurationMinutes?: number
  workshopLoadPercent: number
  reliability: 'Alta' | 'Media' | 'Bassa'
  calculatedAt: string
  requestedDeliveryDate?: string
  requestedDeliveryCompatible?: boolean
  plannerImpact?: {
    movedJobs: number
    delayedJobs: number
    delayedUrgentOrPromisedJobs: number
    summary: string
  }
}

export interface PlannerPriorityWeights {
  urgency: number
  promisedDate: number
  daysToDelivery: number
  accumulatedDelay: number
  startedWork: number
  technicalReady: number
  operatorAvailability: number
  marginPerHour: number
  totalMargin: number
  capacityOptimization: number
  fifo: number
  blockedPenalty: number
}

export interface MonthlyGoalRecord {
  id: string
  monthKey: string
  revenueGoal: number
  suggestedRevenueGoal?: number
  appliedRevenueGoal?: number
  goalMode?: 'automatic' | 'custom'
  customRevenueGoal?: number | null
  revenueActual: number
  baseNeed?: number
  safetyBuffer?: number
  ownerWithdrawalAmount?: number
  ownerWithdrawalPlannedDate?: string
  marginGoal: number | null
  marginActual: number
  residualNeed?: number
  realCosts?: number
  plannedCosts?: number
  revenueRealized?: number
  dailyRevenueNeed?: number
  weeklyRevenueNeed?: number
  forecastRevenue: number
  updatedAt: string
}

export interface PlannerSettings {
  operators: PlannerOperator[]
  standardWorks?: StandardWorkDefinition[]
  standardWorkRuleHistory?: StandardWorkRuleHistoryEntry[]
  standardWorkTimePresets?: StandardWorkTimePreset[]
  standardWorkPriceList?: StandardWorkPriceListItem[]
  standardWorkPriceHistory?: StandardWorkPriceHistoryEntry[]
  internalCostSettings?: InternalCostSettings
  workingDays: number[]
  weeklyWorkSchedule?: WeeklyWorkDaySchedule[]
  efficiencyPercent: number
  safetyMarginPercent: number
  holidays: string[]
  closures: string[]
  companyClosures?: CompanyClosureEntry[]
  absences: PlannerAbsence[]
  monthlyRevenueGoal: number
  monthlyRevenueGoalMode?: 'automatic' | 'custom'
  monthlyRevenueGoalSuggested?: number
  monthlyRevenueGoalManual?: number | null
  ownerWithdrawalAmount: number
  ownerWithdrawalPlannedDate: string
  ownerWithdrawalSettledMonthKey?: string | null
  ownerWithdrawalSettledAt?: string | null
  economicSafetyMarginPercent?: number
  monthlyMarginGoal: number | null
  monthlyGoalHistory?: MonthlyGoalRecord[]
  phaseTrackingMetric?: PlannerPhaseTrackingMetric
  deliveryBufferMode?: 'percent' | 'hours'
  deliveryBufferValue?: number
  plannerPriorityWeights?: Partial<PlannerPriorityWeights>
  vehicleStatuses?: VehicleStatusDefinition[]
  defaultVehicleStatus?: VehicleStatus
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
  vehicleId?: string
  acceptanceId?: string
  quoteId?: string
  number: string
  issueDate: string
  dueDate: string
  documentStatus?: InvoiceDocumentStatus
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
  type: 'Fattura emessa' | 'R.I.B.A. presentata' | 'Anticipo bancario' | 'Incasso definitivo' | 'Insoluto' | 'Storno' | 'Uscita prevista' | 'Pagamento uscita'
  date: string
  amount: number
  customerId?: string
  invoiceId?: string
  ribaBatchId?: string
  bankAccountId?: string
  payableId?: string
  payableInstallmentId?: string
  note: string
  createdAt: string
}

export type PayableKind = 'supplier-invoice' | 'f24' | 'planned-outflow'
export type PayableCategory = 'fornitori' | 'f24-imposte' | 'prelievo-titolare' | 'altre-uscite'
export type PayableStatus = 'Da pagare' | 'Pagato' | 'Scaduto'
export type VatDeductibilityMode = 'full' | 'partial' | 'none'
export type VatQuarterStatus = 'In corso' | 'Da verificare' | 'Confermata dal commercialista' | 'Pagata'

export interface PayableInstallment {
  id: string
  installmentNo: number
  amount: number
  dueDate: string
  status: PayableStatus
  paidAt?: string | null
  note?: string
}

export interface PayableEntry {
  id: string
  kind: PayableKind
  category: PayableCategory
  description: string
  supplierName?: string
  invoiceNumber?: string
  invoiceDate?: string
  taxableAmount?: number
  vatAmount?: number
  vatDeductibilityMode?: VatDeductibilityMode
  vatDeductibilityPercent?: number
  totalAmount: number
  paymentMethod: PaymentMethod | 'F24' | 'Addebito' | 'Altro'
  dueDate: string
  referencePeriod?: string
  accountantNote?: string
  notes?: string
  status: PayableStatus
  installments: PayableInstallment[]
  createdAt: string
  updatedAt: string
}

export interface VatQuarterAdjustment {
  id: string
  note: string
  amount: number
  createdAt: string
}

export interface VatQuarterRecord {
  quarterKey: string
  status: VatQuarterStatus
  confirmedAmount?: number | null
  confirmedAt?: string | null
  accountantNote?: string
  linkedPayableId?: string | null
  dueDate?: string
  adjustments: VatQuarterAdjustment[]
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
  source: 'azure' | 'ocr' | 'manual'
}

export type IdentityDocumentOcrDocumentType = 'identity_card' | 'driving_license' | 'unknown'

export interface IdentityDocumentOcrField {
  value: string
  confidence: number | null
  source: 'azure' | 'manual'
}

export interface IdentityDocumentOcrFields {
  firstName: IdentityDocumentOcrField
  lastName: IdentityDocumentOcrField
  taxCode: IdentityDocumentOcrField
  birthDate: IdentityDocumentOcrField
  birthPlace: IdentityDocumentOcrField
  residence: IdentityDocumentOcrField
  documentNumber: IdentityDocumentOcrField
  issueDate: IdentityDocumentOcrField
  expiryDate: IdentityDocumentOcrField
  issuingAuthority: IdentityDocumentOcrField
}

export interface IdentityDocumentOcrResponse {
  success: true
  documentType: IdentityDocumentOcrDocumentType
  fields: IdentityDocumentOcrFields
  warnings: string[]
}

export interface VehicleBookletOcrFields {
  plate: IdentityDocumentOcrField
  vin: IdentityDocumentOcrField
  make: IdentityDocumentOcrField
  model: IdentityDocumentOcrField
  firstRegistration: IdentityDocumentOcrField
  fuel: IdentityDocumentOcrField
  engineDisplacement: IdentityDocumentOcrField
  power: IdentityDocumentOcrField
  owner: IdentityDocumentOcrField
}

export interface VehicleBookletOcrResponse {
  success: true
  fields: VehicleBookletOcrFields
  warnings: string[]
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

export interface AcceptanceAccessoriesDraft {
  keyCount: string
  hasRegistrationCard: boolean
  hasSpareWheelKit: boolean
  hasTriangle: boolean
  hasSafetyVest: boolean
  hasFloorMats: boolean
  hasPersonalItems: boolean
  otherNotes: string
  confirmed: boolean
}

export interface AcceptanceIntakeData {
  mileage: string
  fuelLevel: string
  occurredAt: string
  operator: string
  damageDescription: string
  accessories: string[]
  accessoriesDraft?: AcceptanceAccessoriesDraft
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

export type EstimateStatus = 'Bozza' | 'Inviato' | 'In attesa conferma' | 'Approvato' | 'Rifiutato' | 'Scaduto'
export type JobStatus = 'Da pianificare' | 'Pianificata' | 'In lavorazione' | 'In attesa' | 'Controllo qualità' | 'Pronta consegna' | 'Consegnata' | 'Annullata'
export type JobPhaseStatus = 'Da fare' | 'In lavorazione' | 'Completata' | 'Bloccata'
export type JobPriority = 'Normale' | 'Alta' | 'Urgente'
export type WorkCategory = 'carrozzeria' | 'verniciatura' | 'ricambi' | 'materiali' | 'meccanica' | 'servizi esterni' | 'altre'

export interface EstimateLine {
  id: string
  description: string
  category: WorkCategory
  panelId?: string
  panelName?: string
  panelSide?: 'sx' | 'dx' | 'center' | ''
  repairExtent?: 'intero' | 'mezzo'
  panelWorkNote?: string
  vehicleSizeClass?: 'piccola' | 'media' | 'grande' | ''
  colorFamily?: string
  paintCycle?: string
  standardWorkId?: string
  standardWorkName?: string
  categoryOrPhase?: string
  calculationType?: 'per-vehicle' | 'per-panel'
  standardMinutes?: number
  estimatedMinutes?: number
  lineTotalMinutes?: number
  manualTimeOverride?: boolean
  appliedRuleId?: string
  appliedRuleName?: string
  appliedRuleSummary?: string
  requiredSkill?: string
  cycleOrder?: number
  technicalWaitMinutes?: number
  technicalWaitBlocksPhaseNames?: string[]
  quantity: number
  unitPrice: number
  discount: number
  taxableAmount: number
  vatRate: number
  vatAmount: number
  total: number
  internalHourlyRateUsed?: number
  productiveEfficiencyUsed?: number
  internalCostAmount?: number
  breakEvenPrice?: number
  theoreticalMarginAmount?: number
  theoreticalMarginPercent?: number
  marginStatus?: 'ok' | 'low' | 'loss' | 'zero-price'
  minimumMarginPercentUsed?: number
  minimumSuggestedPrice?: number
}

export interface EstimateHistoryEntry {
  id: string
  at: string
  actor: string
  message: string
}

export interface EstimateDocument {
  id: string
  number: string
  date: string
  customerId: string
  vehicleId?: string
  plate: string
  companyName: string
  contactName: string
  priority?: JobPriority
  requestedDeliveryDate?: string
  notes: string
  status: EstimateStatus
  lines: EstimateLine[]
  taxableAmount: number
  vatAmount: number
  total: number
  productionForecast?: EstimateProductionForecast
  dataStimataInizio?: string
  dataStimataConsegna?: string
  dataCalcoloStima?: string
  convertedJobId?: string | null
  history: EstimateHistoryEntry[]
  createdAt: string
  updatedAt: string
}

export interface JobPhase {
  id: string
  name: string
  status: JobPhaseStatus
  notRequired?: boolean
  cycleOrder?: number
  requiredSkill?: string
  operatorName?: string
  startedAt?: string
  endedAt?: string
  estimatedMinutes: number
  actualMinutes: number
  notes: string
  blockedReason: string
  technicalWaitMinutes?: number
  technicalWaitBlocksPhaseNames?: string[]
  operatorAssignments: JobPhaseOperatorAssignment[]
  timeAdjustments?: JobPhaseTimeAdjustment[]
}

export interface JobPhaseTimeAdjustment {
  id: string
  at: string
  reason: string
  fromMinutes: number
  toMinutes: number
}

export type JobPhaseOperatorActivityStatus = 'Attivo' | 'Concluso' | 'Rimosso'

export interface JobPhaseOperatorAssignment {
  id: string
  operatorName: string
  startedAt: string
  endedAt?: string
  workedMinutes: number
  activityStatus: JobPhaseOperatorActivityStatus
}

export interface QualityChecklistItem {
  id: string
  label: string
  checked: boolean
  checkedAt?: string
}

export interface JobHistoryEntry {
  id: string
  at: string
  actor: string
  message: string
}

export interface RepairJob {
  id: string
  number: string
  estimateId?: string | null
  customerId: string
  vehicleId?: string
  plate: string
  coneNumber: number | null
  entryDate: string
  expectedDeliveryDate: string
  deliveredAt?: string
  priority: JobPriority
  responsible: string
  status: JobStatus
  companyName: string
  contactName: string
  notes: string
  blocks: string[]
  lines: EstimateLine[]
  phases: JobPhase[]
  qualityChecklist: QualityChecklistItem[]
  taxableAmount: number
  vatAmount: number
  total: number
  progressPercent: number
  createdAt: string
  updatedAt: string
  history: JobHistoryEntry[]
}

export interface WorkflowCounters {
  estimate: number
  job: number
}

export interface JobWorkflowKpis {
  openJobs: number
  vehiclesInWork: number
  readyForDelivery: number
  deliveredThisMonth: number
  openValue: number
  completedValue: number
  delayedJobs: number
  averageWorkingHours: number
  onTimeCompletionRate: number
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
  payables?: PayableEntry[]
  financeSettings: FinanceSettings
  vatQuarterlyRecords?: VatQuarterRecord[]
  quotes?: QuoteDocument[]
  communications?: CommunicationEntry[]
  documentCounters?: DocumentCounters
  companyProfile?: CompanyProfile
  acceptances?: AcceptanceCase[]
  production?: ProductionModule
  estimates?: EstimateDocument[]
  jobs?: RepairJob[]
  workflowCounters?: WorkflowCounters
  qualityChecklistTemplates?: string[]
  operatorPrograms?: OperatorDayProgram[]
  operatorProgramHistory?: OperatorProgramHistoryEntry[]
  operatorProgramRevision?: number
  dbRevision?: number
  dbUpdatedAt?: string
}
