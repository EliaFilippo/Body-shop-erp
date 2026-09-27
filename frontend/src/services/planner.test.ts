import { afterEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import type { ErpData, PlannerSettings, RepairJob, Vehicle } from '../types'
import {
  buildPlannerQueue,
  calculateDayCapacity,
  calculatePlanner,
  capacityWithAssignments,
  generateOperatorPrograms,
  isWorkingDay,
  moveVehiclePlanningDate,
  moveVehicleWork,
  recalculateOperatorPrograms,
  simulateEstimateProductionForecast,
  todayKey,
} from './planner'
import { addWorkingMinutes, getCompanyWorkingIntervals, nextWorkingInstant } from './workCalendar'
import { buildIntegritySnapshot, loadDatabase, saveDatabase } from './database'
import { emptyData } from './erp'
import { syncOperationalStateFromJobs } from './workflow'

const settings: PlannerSettings = {
  operators: [{ id: 'op-1', name: 'Giorgio', dailyHours: 8, active: true }],
  workingDays: [1, 2, 3, 4, 5],
  efficiencyPercent: 100,
  safetyMarginPercent: 20,
  holidays: [],
  closures: [],
  absences: [],
  monthlyRevenueGoal: 40000,
  ownerWithdrawalAmount: 3000,
  ownerWithdrawalPlannedDate: '2026-07-31',
  monthlyMarginGoal: 12000,
}

const vehicle = (id: string, hours: number, requestedDeliveryDate = '2026-07-27'): Vehicle => ({
  id, customerId: 'c1', plate: `AA00${id}AA`, make: 'Fiat', model: '500', color: '',
  year: '', vin: '', mileage: '', status: 'Accettata', coneNumber: null, priority: 'Normale',
  deliveryDate: requestedDeliveryDate, estimatedHours: hours, workedHours: 0,
  plannedEntryDate: '2026-07-27', requestedDeliveryDate, calculatedDeliveryDate: '',
  expectedRevenue: 1000, expectedMargin: 300, partsStatus: 'Disponibili', blockReason: '',
  manualPlanningDate: '', createdAt: `2026-07-20T00:00:0${id}.000Z`,
})

describe('capacità produttiva', () => {
  it('applica efficienza e margine di sicurezza', () => {
    expect(calculateDayCapacity('2026-07-27', settings)).toMatchObject({
      nominal: 8, normal: 8, protected: 6.4, remaining: 6.4,
    })
  })

  it('esclude weekend, festività e chiusure', () => {
    expect(isWorkingDay('2026-08-01', settings)).toBe(false)
    expect(calculateDayCapacity('2026-07-27', { ...settings, holidays: ['2026-07-27'] }).protected).toBe(0)
    expect(calculateDayCapacity('2026-07-27', { ...settings, closures: ['2026-07-27'] }).protected).toBe(0)
  })

  it('sottrae ferie e assenze, anche parziali', () => {
    const absent = { ...settings, absences: [{ id: 'a', operatorId: 'op-1', startDate: '2026-07-27', endDate: '2026-07-27', hoursPerDay: 3, reason: 'Visita' }] }
    expect(calculateDayCapacity('2026-07-27', absent).nominal).toBe(5)
  })

  it('non restituisce ore disponibili negative e segnala l’eccedenza', () => {
    const capacity = capacityWithAssignments('2026-07-27', settings, [{ vehicleId: 'v', date: '2026-07-27', protectedHours: 9, normalHours: 9 }])
    expect(capacity.remaining).toBe(0)
    expect(capacity.overload).toBe(2.6)
  })
})

describe('consegne e semafori', () => {
  it('classifica verde quando basta la capacità protetta', () => {
    expect(calculatePlanner([vehicle('1', 6)], settings, '2026-07-26').vehicles[0].status).toBe('green')
  })

  it('classifica giallo quando serve consumare il margine di sicurezza', () => {
    expect(calculatePlanner([vehicle('2', 7)], settings, '2026-07-26').vehicles[0].status).toBe('yellow')
  })

  it('classifica rosso e indica ore, ritardo e prima data consigliata', () => {
    const result = calculatePlanner([vehicle('3', 9)], settings, '2026-07-26').vehicles[0]
    expect(result.status).toBe('red')
    expect(result.missingHours).toBe(1)
    expect(result.delayWorkingDays).toBe(1)
    expect(result.suggestedDate).toBe('2026-07-28')
  })

  it('ricalcola la consegna dopo l’inserimento di una nuova vettura prioritaria', () => {
    const normal = vehicle('4', 6, '2026-07-28')
    const before = calculatePlanner([normal], settings, '2026-07-26').vehicles.find((item) => item.vehicleId === normal.id)
    const urgent = { ...vehicle('5', 6, '2026-07-27'), priority: 'Urgente' as const }
    const after = calculatePlanner([normal, urgent], settings, '2026-07-26').vehicles.find((item) => item.vehicleId === normal.id)
    expect(before?.calculatedDeliveryDate).toBe('2026-07-27')
    expect(after?.calculatedDeliveryDate).toBe('2026-07-28')
  })

  it('mantiene visibile una vettura bloccata senza assegnare ore', () => {
    const blocked = { ...vehicle('6', 4), partsStatus: 'Mancanti' as const }
    const result = calculatePlanner([blocked], settings, '2026-07-26').vehicles[0]
    expect(result.blocked).toBe(true)
    expect(result.assignments).toEqual([])
  })

  it('sposta il carico su una nuova data mantenendo le ore assegnate', () => {
    const result = moveVehiclePlanningDate([{ vehicleId: 'v', date: '2026-07-28', protectedHours: 8, normalHours: 0 }], 'v', '2026-07-29', settings)
    expect(result.assignments[0]).toMatchObject({ vehicleId: 'v', date: '2026-07-29', protectedHours: 8 })
  })

  it('richiede conferma quando uno spostamento supera la capacità', () => {
    const result = moveVehicleWork([{ vehicleId: 'v', date: '2026-07-28', protectedHours: 8, normalHours: 0 }], 'v', '2026-07-27', settings)
    expect(result.requiresConfirmation).toBe(true)
    expect(result.excessHours).toBe(1.6)
  })
})

const programSettings: PlannerSettings = {
  ...settings,
  operators: [
    { id: 'op-1', name: 'Filippo', dailyHours: 8, active: true, skills: ['lattoneria', 'smontaggio', 'rimontaggio'] },
    { id: 'op-2', name: 'Giorgio', dailyHours: 8, active: true, skills: ['lattoneria', 'preparazione'] },
  ],
}

const baseJob = (id: string, number: string, vehicleId: string, plate: string, priority: 'Normale' | 'Alta' | 'Urgente', expectedDeliveryDate: string): RepairJob => ({
  id,
  number,
  estimateId: null,
  customerId: 'c1',
  vehicleId,
  plate,
  coneNumber: 1,
  entryDate: '2026-07-27',
  expectedDeliveryDate,
  priority,
  responsible: 'Capo',
  status: 'In lavorazione',
  companyName: '',
  contactName: '',
  notes: '',
  blocks: [],
  lines: [],
  phases: [
    {
      id: `p-${id}-1`,
      name: 'Smontaggio',
      status: 'Completata',
      operatorAssignments: [],
      estimatedMinutes: 60,
      actualMinutes: 60,
      notes: '',
      blockedReason: '',
    },
    {
      id: `p-${id}-2`,
      name: 'Lattoneria',
      status: 'In lavorazione',
      operatorAssignments: [],
      estimatedMinutes: 120,
      actualMinutes: 0,
      notes: '',
      blockedReason: '',
    },
  ],
  qualityChecklist: [],
  taxableAmount: 0,
  vatAmount: 0,
  total: 0,
  progressPercent: 50,
  createdAt: '2026-07-27T07:00:00.000Z',
  updatedAt: '2026-07-27T07:00:00.000Z',
  history: [],
})

const makeProgramData = (): ErpData => {
  const data = structuredClone(emptyData)
  data.plannerSettings = programSettings
  data.customers = [{ id: 'c1', type: 'Privato', name: 'Cliente', phone: '1', email: '', taxId: '', address: '', createdAt: '2026-07-20T00:00:00.000Z' }]
  data.vehicles = [
    { ...vehicle('11', 8, '2026-07-27'), id: 'v1', plate: 'AB548CG', priority: 'Urgente' },
    { ...vehicle('12', 8, '2026-07-28'), id: 'v2', plate: 'CD111EF', priority: 'Normale' },
  ]
  data.jobs = [
    baseJob('j1', 'COMM-00001', 'v1', 'AB548CG', 'Urgente', '2026-07-27'),
    baseJob('j2', 'COMM-00004', 'v2', 'CD111EF', 'Normale', '2026-07-28'),
  ]
  return data
}

describe('programma operatori autonomo', () => {
  it('genera automaticamente il piano operatori giornaliero', () => {
    const result = generateOperatorPrograms(makeProgramData(), '2026-07-27', 'Test')
    expect(result.programs).toHaveLength(2)
    expect(result.programs.some((program) => program.tasks.length > 0)).toBe(true)
  })

  it('consente piu operatori contemporanei sulla stessa fase', () => {
    const result = generateOperatorPrograms(makeProgramData(), '2026-07-27', 'Test')
    const filippoTask = result.programs.find((program) => program.operatorId === 'op-1')?.tasks[0]
    const giorgioTask = result.programs.find((program) => program.operatorId === 'op-2')?.tasks[0]
    expect(filippoTask?.jobNumber).toBe('COMM-00001')
    expect(giorgioTask?.jobNumber).toBe('COMM-00001')
    expect(filippoTask?.startAt).toBe(giorgioTask?.startAt)
    expect(filippoTask?.endAt).toBe(giorgioTask?.endAt)
  })

  it('ricalcola dopo completamento anticipato passando alla fase successiva', () => {
    const data = makeProgramData()
    const before = recalculateOperatorPrograms(data, '2026-07-27', 'Prima')
    const job = before.jobs?.find((item) => item.id === 'j1')
    if (!job) throw new Error('Job mancante')
    job.phases[1].status = 'Completata'
    job.phases.push({
      id: 'p-j1-3',
      name: 'Rimontaggio',
      status: 'Da fare',
      operatorAssignments: [],
      estimatedMinutes: 90,
      actualMinutes: 0,
      notes: '',
      blockedReason: '',
    })
    const after = recalculateOperatorPrograms(before, '2026-07-27', 'Completamento anticipato')
    const task = after.operatorPrograms?.find((program) => program.operatorId === 'op-1')?.tasks[0]
    expect(task?.phaseName).toBe('Rimontaggio')
  })

  it('ricalcola dopo ritardo aumentando la durata prevista', () => {
    const data = makeProgramData()
    const before = recalculateOperatorPrograms(data, '2026-07-27', 'Prima')
    const beforeEnd = before.operatorPrograms?.find((program) => program.operatorId === 'op-1')?.tasks[0]?.endAt ?? ''
    const delayed = structuredClone(before)
    const phase = delayed.jobs?.find((job) => job.id === 'j1')?.phases.find((item) => item.name === 'Lattoneria')
    if (!phase) throw new Error('Fase mancante')
    phase.estimatedMinutes = 240
    const after = recalculateOperatorPrograms(delayed, '2026-07-27', 'Ritardo')
    const afterEnd = after.operatorPrograms?.find((program) => program.operatorId === 'op-1')?.tasks[0]?.endAt ?? ''
    expect(afterEnd > beforeEnd).toBe(true)
  })

  it('ricalcola dopo blocco riassegnando operatori su altre attivita', () => {
    const data = makeProgramData()
    const blocked = structuredClone(data)
    const phase = blocked.jobs?.find((job) => job.id === 'j1')?.phases.find((item) => item.name === 'Lattoneria')
    if (!phase) throw new Error('Fase mancante')
    phase.status = 'Bloccata'
    phase.blockedReason = 'Ricambio mancante'
    const result = recalculateOperatorPrograms(blocked, '2026-07-27', 'Blocco')
    const filippoFirst = result.operatorPrograms?.find((program) => program.operatorId === 'op-1')?.tasks[0]
    expect(filippoFirst?.jobNumber).toBe('COMM-00004')
  })

  it('ricalcola su nuova urgenza senza perdere storico', () => {
    const data = recalculateOperatorPrograms(makeProgramData(), '2026-07-27', 'Prima')
    const urgentVehicle = { ...vehicle('13', 6, '2026-07-27'), id: 'v3', plate: 'ZZ999ZZ', priority: 'Urgente' as const }
    data.vehicles.push(urgentVehicle)
    data.jobs?.push(baseJob('j3', 'COMM-00007', 'v3', 'ZZ999ZZ', 'Urgente', '2026-07-27'))
    const recalculated = recalculateOperatorPrograms(data, '2026-07-27', 'Nuova urgenza')
    const firstTask = recalculated.operatorPrograms?.find((program) => program.operatorId === 'op-1')?.tasks[0]
    expect(firstTask?.priority).toBe('Urgente')
    expect((recalculated.operatorProgramHistory ?? []).length).toBeGreaterThan(0)
  })

  it('evita doppie assegnazioni incompatibili sullo stesso operatore', () => {
    const result = recalculateOperatorPrograms(makeProgramData(), '2026-07-27', 'Test')
    const tasks = result.operatorPrograms?.find((program) => program.operatorId === 'op-1')?.tasks ?? []
    for (let index = 1; index < tasks.length; index += 1) {
      expect(tasks[index - 1].endAt <= tasks[index].startAt).toBe(true)
    }
  })

  it('mantiene il piano dopo refresh tramite persistenza', async () => {
    const data = recalculateOperatorPrograms(makeProgramData(), '2026-07-27', 'Persistenza')
    await saveDatabase(data)
    const loaded = await loadDatabase()
    expect((loaded.operatorPrograms ?? []).some((program) => program.date === '2026-07-27')).toBe(true)
  })

  it('propaga pannelli e note pannello nel programma operatore', () => {
    const seeded = makeProgramData()
    const job = seeded.jobs?.find((item) => item.id === 'j1')
    if (!job) throw new Error('Job mancante')
    job.lines = [
      {
        id: 'line-1',
        description: 'Lattoneria porta sx',
        panelId: 'porta-ant-sx',
        panelName: 'Porta anteriore SX',
        panelSide: 'sx',
        repairExtent: 'mezzo',
        panelWorkNote: 'Ruggine su bordo inferiore',
        category: 'carrozzeria',
        standardWorkId: 'std-1',
        standardWorkName: 'Lattoneria',
        categoryOrPhase: 'Lattoneria',
        calculationType: 'per-panel',
        standardMinutes: 60,
        estimatedMinutes: 60,
        lineTotalMinutes: 60,
        manualTimeOverride: false,
        appliedRuleId: '',
        appliedRuleName: '',
        appliedRuleSummary: '',
        requiredSkill: 'lattoneria',
        cycleOrder: 20,
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        taxableAmount: 100,
        vatRate: 22,
        vatAmount: 22,
        total: 122,
      },
    ]

    const result = generateOperatorPrograms(seeded, '2026-07-27', 'Test note pannello')
    const task = result.programs.find((program) => program.operatorId === 'op-1')?.tasks[0]
    expect(task?.panelNames).toContain('Porta anteriore SX')
    expect(task?.panelNotes).toContain('Ruggine su bordo inferiore')
  })
})

describe('visibilita commesse nel planner', () => {
  const queueSettings: PlannerSettings = {
    ...settings,
    operators: [{ id: 'op-a', name: 'Operatore A', dailyHours: 8, active: true, skills: ['smontaggio', 'lattoneria', 'preparazione', 'verniciatura', 'rimontaggio', 'lucidatura', 'lavaggio', 'controllo'] }],
  }

  const makeQueueData = () => {
    const data = structuredClone(emptyData)
    data.plannerSettings = structuredClone(queueSettings)
    data.customers = [{ id: 'c1', type: 'Privato', name: 'Cliente', phone: '1', email: '', taxId: '', address: '', createdAt: '2026-08-10T00:00:00.000Z' }]
    data.vehicles = [{
      ...vehicle('q1', 2, '2026-08-14'),
      id: 'vq1',
      plate: 'QW123ER',
      status: 'Confermata',
      workedHours: 9,
      estimatedHours: 1,
      plannedEntryDate: '2026-08-14',
      manualPlanningDate: '2026-08-14',
    }]
    data.jobs = [{
      id: 'jq1',
      number: 'COMM-01001',
      estimateId: 'est-1',
      customerId: 'c1',
      vehicleId: 'vq1',
      plate: 'QW123ER',
      coneNumber: null,
      entryDate: '2026-08-14',
      expectedDeliveryDate: '2026-08-15',
      priority: 'Normale',
      responsible: '',
      status: 'Da pianificare',
      companyName: '',
      contactName: '',
      notes: '',
      blocks: [],
      lines: [{
        id: 'line-q1',
        description: 'Smontaggio',
        panelId: '',
        panelName: '',
        panelSide: '',
        repairExtent: 'intero',
        panelWorkNote: '',
        vehicleSizeClass: '',
        colorFamily: '',
        paintCycle: '',
        standardWorkId: '',
        category: 'carrozzeria',
        standardWorkName: 'Smontaggio',
        categoryOrPhase: 'Smontaggio',
        calculationType: 'per-vehicle',
        standardMinutes: 120,
        estimatedMinutes: 120,
        lineTotalMinutes: 120,
        manualTimeOverride: false,
        appliedRuleId: '',
        appliedRuleName: '',
        appliedRuleSummary: '',
        requiredSkill: 'smontaggio',
        cycleOrder: 10,
        technicalWaitMinutes: 0,
        technicalWaitBlocksPhaseNames: [],
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        taxableAmount: 100,
        vatRate: 22,
        vatAmount: 22,
        total: 122,
      }],
      phases: [{ id: 'phase-q1', name: 'Smontaggio', status: 'Da fare', operatorAssignments: [], estimatedMinutes: 120, actualMinutes: 0, notes: '', blockedReason: '', requiredSkill: 'smontaggio', cycleOrder: 10, notRequired: false, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], timeAdjustments: [] }],
      qualityChecklist: [],
      taxableAmount: 100,
      vatAmount: 22,
      total: 122,
      progressPercent: 0,
      createdAt: '2026-08-14T08:00:00.000Z',
      updatedAt: '2026-08-14T08:00:00.000Z',
      history: [],
    }]
    return data
  }

  it('commessa confermata rimane visibile nel planner dopo sync', () => {
    const source = makeQueueData()
    const synced = syncOperationalStateFromJobs(source)
    const queue = buildPlannerQueue(synced, '2026-08-14')
    expect(queue.some((item) => item.jobId === 'jq1')).toBe(true)
    expect(synced.vehicles.find((item) => item.id === 'vq1')?.workedHours).toBe(0)
  })

  it('commessa schedulabile viene pianificata automaticamente', () => {
    const synced = syncOperationalStateFromJobs(makeQueueData())
    const plan = calculatePlanner(synced.vehicles, synced.plannerSettings, '2026-08-14')
    expect(plan.assignments.some((item) => item.vehicleId === 'vq1')).toBe(true)
    expect(buildPlannerQueue(synced, '2026-08-14').find((item) => item.jobId === 'jq1')?.schedulable).toBe(true)
  })

  it('commessa non schedulabile resta visibile con motivo esplicito', () => {
    const data = makeQueueData()
    data.plannerSettings.operators = []
    const queue = buildPlannerQueue(data, '2026-08-14')
    const item = queue.find((entry) => entry.jobId === 'jq1')
    expect(item).toBeTruthy()
    expect(item?.schedulable).toBe(false)
    expect(item?.reason).toMatch(/operatore compatibile|competenza/i)
  })

  it('operatore disponibile domani ma non oggi viene considerato su orizzonte planner', () => {
    const data = makeQueueData()
    data.plannerSettings.absences = [{ id: 'abs-1', operatorId: 'op-a', startDate: '2026-08-14', endDate: '2026-08-14', hoursPerDay: 8, reason: 'Assenza' }]
    const queue = buildPlannerQueue(data, '2026-08-14')
    const item = queue.find((entry) => entry.jobId === 'jq1')
    expect(item?.schedulable).toBe(false)
    expect(item?.reason).toMatch(/In attesa fino al|prima disponibilita/i)

    const recalculated = recalculateOperatorPrograms(data, '2026-08-14', 'Test orizzonte domani')
    const futureProgram = (recalculated.operatorPrograms ?? []).find((program) => program.date > '2026-08-14' && program.tasks.some((task) => task.jobId === 'jq1'))
    expect(futureProgram).toBeTruthy()
  })

  it('commessa con data futura resta in coda con attesa esplicita', () => {
    const data = makeQueueData()
    const job = data.jobs?.find((item) => item.id === 'jq1')
    if (!job) throw new Error('Commessa mancante')
    job.entryDate = '2026-08-16'
    const queue = buildPlannerQueue(data, '2026-08-14')
    expect(queue.find((item) => item.jobId === 'jq1')?.reason).toMatch(/In attesa fino al/i)
  })

  it('tempo tecnico blocca solo le fasi dipendenti dichiarate', () => {
    const data = makeQueueData()
    const job = data.jobs?.find((item) => item.id === 'jq1')
    if (!job) throw new Error('Commessa mancante')
    job.phases = [
      { id: 'p1', name: 'Verniciatura', status: 'Completata', operatorAssignments: [{ id: 'a1', operatorName: 'Operatore A', startedAt: '2026-08-14T08:00:00.000Z', endedAt: '2026-08-14T09:00:00.000Z', workedMinutes: 60, activityStatus: 'Concluso' }], estimatedMinutes: 60, actualMinutes: 60, notes: '', blockedReason: '', requiredSkill: 'verniciatura', cycleOrder: 10, notRequired: false, technicalWaitMinutes: 1440, technicalWaitBlocksPhaseNames: ['Rimontaggio'], timeAdjustments: [] },
      { id: 'p2', name: 'Rimontaggio', status: 'Da fare', operatorAssignments: [], estimatedMinutes: 60, actualMinutes: 0, notes: '', blockedReason: '', requiredSkill: 'rimontaggio', cycleOrder: 20, notRequired: false, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], timeAdjustments: [] },
      { id: 'p3', name: 'Lavaggio', status: 'Da fare', operatorAssignments: [], estimatedMinutes: 30, actualMinutes: 0, notes: '', blockedReason: '', requiredSkill: 'lavaggio', cycleOrder: 30, notRequired: true, technicalWaitMinutes: 0, technicalWaitBlocksPhaseNames: [], timeAdjustments: [] },
    ]
    const queueBlocked = buildPlannerQueue(data, '2026-08-14')
    expect(queueBlocked.find((item) => item.jobId === 'jq1')?.reason).toMatch(/Tempo tecnico in corso|In attesa fino al/i)

    job.phases[0].technicalWaitBlocksPhaseNames = ['Lavaggio']
    const queueUnblocked = buildPlannerQueue(data, '2026-08-14')
    expect(queueUnblocked.find((item) => item.jobId === 'jq1')?.schedulable).toBe(true)
  })

  it('assenza di vehicleId e gestita senza sparizione silenziosa', () => {
    const data = makeQueueData()
    const job = data.jobs?.find((item) => item.id === 'jq1')
    if (!job) throw new Error('Commessa mancante')
    job.vehicleId = undefined
    const queue = buildPlannerQueue(data, '2026-08-14')
    const item = queue.find((entry) => entry.jobId === 'jq1')
    expect(item?.schedulable).toBe(false)
    expect(item?.reason).toMatch(/vehicleId/i)
  })

  it('aggiorna il programma operatori dopo pianificazione', () => {
    const data = syncOperationalStateFromJobs(makeQueueData())
    const recalculated = recalculateOperatorPrograms(data, '2026-08-14', 'Pianificazione post conferma')
    const hasTask = (recalculated.operatorPrograms ?? []).some((program) => program.tasks.some((task) => task.jobId === 'jq1'))
    expect(hasTask).toBe(true)
  })
})

describe('simulazione previsione produzione preventivo', () => {
  const forecastLines = (phases: Array<{ name: string; minutes: number; skill?: string }>) => phases.map((phase, index) => ({
    id: `line-${index}`,
    description: phase.name,
    category: 'carrozzeria' as const,
    standardWorkName: phase.name,
    categoryOrPhase: phase.name,
    standardMinutes: phase.minutes,
    estimatedMinutes: phase.minutes,
    lineTotalMinutes: phase.minutes,
    calculationType: 'per-vehicle' as const,
    manualTimeOverride: false,
    appliedRuleSummary: '',
    requiredSkill: phase.skill ?? phase.name.toLowerCase(),
    cycleOrder: index * 10,
    quantity: 1,
    unitPrice: 100,
    discount: 0,
    taxableAmount: 100,
    vatRate: 22,
    vatAmount: 22,
    total: 122,
  }))

  const makeForecastData = () => {
    const data = structuredClone(emptyData)
    data.plannerSettings = {
      ...structuredClone(emptyData.plannerSettings),
      operators: [
        { id: 'op-1', name: 'Mario', dailyHours: 8, active: true, skills: ['smontaggio', 'lattoneria', 'preparazione', 'verniciatura', 'rimontaggio', 'lucidatura', 'lavaggio', 'controllo'] },
        { id: 'op-2', name: 'Luca', dailyHours: 8, active: true, skills: ['smontaggio', 'lattoneria', 'preparazione', 'verniciatura'] },
      ],
      workingDays: [1, 2, 3, 4, 5],
      efficiencyPercent: 100,
      safetyMarginPercent: 0,
      holidays: [],
      closures: [],
      absences: [],
      monthlyRevenueGoal: 0,
      ownerWithdrawalAmount: 0,
      ownerWithdrawalPlannedDate: '2026-07-31',
      monthlyMarginGoal: null,
      deliveryBufferMode: 'percent',
      deliveryBufferValue: 10,
    }
    data.vehicles = []
    data.jobs = []
    data.operatorPrograms = []
    return data
  }

  it('calcola previsione in officina libera senza occupare capacita reale', () => {
    const data = makeForecastData()
    const simulation = simulateEstimateProductionForecast(data, {
      plate: 'AB123CD',
      priority: 'Normale',
      lines: forecastLines([{ name: 'Smontaggio', minutes: 120 }]),
      referenceDate: '2026-07-27',
    })

    expect(simulation.firstAvailabilityDate).toBe('2026-07-27')
    expect(simulation.estimatedStartAt).toBe('2026-07-27T08:00:00.000Z')
    expect(simulation.technicalCompletionAt).toBe('2026-07-27T10:00:00.000Z')
    expect(simulation.advisedDeliveryDate).toBe('2026-07-27')
    expect((data.operatorPrograms ?? []).length).toBe(0)
    expect(calculatePlanner(data.vehicles, data.plannerSettings, '2026-07-27').assignments).toEqual([])
  })

  it('considera il programma operatori esistente senza occupare operatori gia impegnati', () => {
    const data = makeForecastData()
    data.operatorPrograms = [{
      date: '2026-07-27',
      operatorId: 'op-1',
      operatorName: 'Mario',
      generatedAt: '2026-07-27T07:00:00.000Z',
      revision: 1,
      tasks: [{
        id: 'task-1',
        operatorId: 'op-1',
        operatorName: 'Mario',
        vehicleId: 'busy',
        plate: 'ZZ999ZZ',
        jobId: 'j-busy',
        jobNumber: 'COMM-00999',
        phaseId: 'p-busy',
        phaseName: 'Lattoneria',
        startAt: '2026-07-27T08:00:00.000Z',
        endAt: '2026-07-27T09:30:00.000Z',
        plannedMinutes: 90,
        priority: 'Normale',
        reason: 'Test',
        revision: 1,
      }],
    }]

    const simulation = simulateEstimateProductionForecast(data, {
      plate: 'AB123CD',
      priority: 'Normale',
      lines: forecastLines([{ name: 'Smontaggio', minutes: 60 }]),
      referenceDate: '2026-07-27',
    })

    expect(simulation.estimatedStartAt).toBe('2026-07-27T08:00:00.000Z')
    expect(simulation.phasePlans[0].operatorNames).toContain('Luca')
  })

  it('mantiene la prima disponibilita sullo stesso giorno quando esiste ancora capacita residua', () => {
    const data = makeForecastData()
    data.vehicles = [{ ...vehicle('20', 8, '2026-07-27'), id: 'v-busy', plate: 'BUSY01', plannedEntryDate: '2026-07-27', manualPlanningDate: '2026-07-27' }]

    const simulation = simulateEstimateProductionForecast(data, {
      plate: 'AB123CD',
      priority: 'Normale',
      lines: forecastLines([{ name: 'Smontaggio', minutes: 120 }]),
      referenceDate: '2026-07-27',
    })

    expect(simulation.firstAvailabilityDate).toBe('2026-07-27')
    expect(simulation.estimatedStartAt.slice(0, 10)).toBe('2026-07-27')
  })

  it('rispetta lavorazione su un solo operatore e piu operatori su priorita urgente', () => {
    const data = makeForecastData()
    const single = simulateEstimateProductionForecast(data, {
      plate: 'AB123CD',
      priority: 'Normale',
      lines: forecastLines([{ name: 'Smontaggio', minutes: 60 }]),
      referenceDate: '2026-07-27',
    })
    const multiple = simulateEstimateProductionForecast(data, {
      plate: 'AB123CD',
      priority: 'Urgente',
      lines: forecastLines([{ name: 'Smontaggio', minutes: 60 }]),
      referenceDate: '2026-07-27',
    })

    expect(single.phasePlans[0].operatorNames).toHaveLength(1)
    expect(multiple.phasePlans[0].operatorNames).toHaveLength(2)
  })

  it('rispetta le dipendenze tra fasi e puo attraversare piu giorni lavorativi', () => {
    const data = makeForecastData()
    const simulation = simulateEstimateProductionForecast(data, {
      plate: 'AB123CD',
      priority: 'Normale',
      lines: forecastLines([
        { name: 'Smontaggio', minutes: 300 },
        { name: 'Lattoneria', minutes: 300 },
      ]),
      referenceDate: '2026-07-25',
    })

    expect(simulation.phasePlans[1].startAt >= simulation.phasePlans[0].endAt).toBe(true)
    expect(simulation.technicalCompletionAt.slice(0, 10)).toBe('2026-07-28')
  })

  it('salta weekend e giorni non lavorativi nel completamento', () => {
    const data = makeForecastData()
    const simulation = simulateEstimateProductionForecast(data, {
      plate: 'AB123CD',
      priority: 'Normale',
      lines: forecastLines([{ name: 'Smontaggio', minutes: 600 }]),
      referenceDate: '2026-07-31',
    })

    expect(simulation.technicalCompletionAt.slice(0, 10)).toBe('2026-08-03')
  })

  it('valuta la compatibilita della data cliente e applica il buffer', () => {
    const data = makeForecastData()
    data.plannerSettings.deliveryBufferMode = 'hours'
    data.plannerSettings.deliveryBufferValue = 2
    const compatible = simulateEstimateProductionForecast(data, {
      plate: 'AB123CD',
      priority: 'Normale',
      requestedDeliveryDate: '2026-07-28',
      lines: forecastLines([{ name: 'Smontaggio', minutes: 120 }]),
      referenceDate: '2026-07-27',
    })
    const impossible = simulateEstimateProductionForecast(data, {
      plate: 'AB123CD',
      priority: 'Normale',
      requestedDeliveryDate: '2026-07-27',
      lines: forecastLines([{ name: 'Smontaggio', minutes: 600 }]),
      referenceDate: '2026-07-27',
    })

    expect(compatible.requestedDeliveryCompatible).toBe(true)
    expect(compatible.advisedDeliveryDate).toBe('2026-07-27')
    expect(impossible.requestedDeliveryCompatible).toBe(false)
  })
})

describe('12 scenari priorita planner', () => {
  const prioritySettings: PlannerSettings = {
    ...settings,
    operators: [
      { id: 'op-p1', name: 'Operatore 1', dailyHours: 8, active: true, skills: ['smontaggio', 'lattoneria', 'preparazione', 'verniciatura', 'rimontaggio', 'lucidatura', 'lavaggio', 'controllo'] },
      { id: 'op-p2', name: 'Operatore 2', dailyHours: 8, active: true, skills: ['smontaggio', 'lattoneria', 'preparazione', 'verniciatura', 'rimontaggio', 'lucidatura', 'lavaggio', 'controllo'] },
    ],
    safetyMarginPercent: 0,
    plannerPriorityWeights: {
      urgency: 150,
      promisedDate: 140,
      daysToDelivery: 120,
      accumulatedDelay: 110,
      startedWork: 100,
      marginPerHour: 40,
      totalMargin: 30,
      operatorAvailability: 20,
      technicalReady: 20,
      capacityOptimization: 10,
      fifo: 5,
      blockedPenalty: 200,
    },
  }

  const estimateLine = (description: string, minutes: number, taxableAmount: number) => ({
    id: `line-${description}`,
    description,
    category: 'carrozzeria' as const,
    standardWorkName: description,
    categoryOrPhase: description,
    standardMinutes: minutes,
    estimatedMinutes: minutes,
    lineTotalMinutes: minutes,
    calculationType: 'per-vehicle' as const,
    manualTimeOverride: false,
    appliedRuleSummary: '',
    requiredSkill: description.toLowerCase(),
    cycleOrder: 10,
    quantity: 1,
    unitPrice: taxableAmount,
    discount: 0,
    taxableAmount,
    vatRate: 22,
    vatAmount: Math.round(taxableAmount * 0.22 * 100) / 100,
    total: Math.round(taxableAmount * 1.22 * 100) / 100,
  })

  const priorityVehicle = (id: string, plate: string, priority: 'Normale' | 'Alta' | 'Urgente', requestedDeliveryDate = ''): Vehicle => ({
    ...vehicle(id, 6, requestedDeliveryDate || '2026-08-20'),
    id,
    plate,
    priority,
    requestedDeliveryDate,
    plannedEntryDate: '2026-08-14',
    manualPlanningDate: '2026-08-14',
    status: 'in-lavorazione',
  })

  const priorityJob = (input: {
    id: string
    number: string
    vehicleId: string
    plate: string
    priority: 'Normale' | 'Alta' | 'Urgente'
    expectedDeliveryDate?: string
    phaseStatus?: 'Da fare' | 'In lavorazione'
    minutes: number
    taxableAmount: number
  }): RepairJob => ({
    id: input.id,
    number: input.number,
    estimateId: null,
    customerId: 'c1',
    vehicleId: input.vehicleId,
    plate: input.plate,
    coneNumber: null,
    entryDate: '2026-08-14',
    expectedDeliveryDate: input.expectedDeliveryDate ?? '',
    priority: input.priority,
    responsible: '',
    status: 'In lavorazione',
    companyName: '',
    contactName: '',
    notes: '',
    blocks: [],
    lines: [estimateLine('Lattoneria', input.minutes, input.taxableAmount)],
    phases: [{
      id: `phase-${input.id}`,
      name: 'Lattoneria',
      status: input.phaseStatus ?? 'Da fare',
      operatorAssignments: [],
      estimatedMinutes: input.minutes,
      actualMinutes: 0,
      notes: '',
      blockedReason: '',
      requiredSkill: 'lattoneria',
      cycleOrder: 20,
      notRequired: false,
      technicalWaitMinutes: 0,
      technicalWaitBlocksPhaseNames: [],
      timeAdjustments: [],
    }],
    qualityChecklist: [],
    taxableAmount: input.taxableAmount,
    vatAmount: Math.round(input.taxableAmount * 0.22 * 100) / 100,
    total: Math.round(input.taxableAmount * 1.22 * 100) / 100,
    progressPercent: 0,
    createdAt: `2026-08-14T08:00:0${input.id.slice(-1)}.000Z`,
    updatedAt: `2026-08-14T08:00:0${input.id.slice(-1)}.000Z`,
    history: [],
  })

  const makePriorityData = () => {
    const data = structuredClone(emptyData)
    data.plannerSettings = structuredClone(prioritySettings)
    data.customers = [{ id: 'c1', type: 'Privato', name: 'Cliente', phone: '1', email: '', taxId: '', address: '', createdAt: '2026-08-14T00:00:00.000Z' }]
    return data
  }

  it('1) preventivo senza data -> data automatica', () => {
    const data = makePriorityData()
    const simulation = simulateEstimateProductionForecast(data, {
      plate: 'AA111AA',
      priority: 'Normale',
      lines: [estimateLine('Smontaggio', 120, 300)],
      referenceDate: '2026-08-14',
    })
    expect(simulation.advisedDeliveryDate).toBeTruthy()
    expect(simulation.requestedDeliveryDate).toBeUndefined()
  })

  it('2) data manuale -> vincolo di consegna', () => {
    const data = makePriorityData()
    const simulation = simulateEstimateProductionForecast(data, {
      plate: 'AA222AA',
      priority: 'Normale',
      requestedDeliveryDate: '2026-08-14',
      lines: [estimateLine('Smontaggio', 600, 300)],
      referenceDate: '2026-08-14',
    })
    expect(simulation.requestedDeliveryCompatible).toBe(false)
  })

  it('3) urgente con data', () => {
    const data = makePriorityData()
    const urgentVehicle = priorityVehicle('v-u', 'URG001', 'Urgente', '2026-08-14')
    const normalVehicle = priorityVehicle('v-n', 'NOR001', 'Normale', '2026-08-16')
    data.vehicles = [urgentVehicle, normalVehicle]
    data.jobs = [
      priorityJob({ id: 'j-u', number: 'COMM-U', vehicleId: 'v-u', plate: 'URG001', priority: 'Urgente', expectedDeliveryDate: '2026-08-14', minutes: 120, taxableAmount: 500 }),
      priorityJob({ id: 'j-n', number: 'COMM-N', vehicleId: 'v-n', plate: 'NOR001', priority: 'Normale', expectedDeliveryDate: '2026-08-16', minutes: 120, taxableAmount: 500 }),
    ]
    const generated = generateOperatorPrograms(data, '2026-08-14', 'Scenario 3')
    const firstTask = generated.programs.find((program) => program.operatorId === 'op-p1')?.tasks[0]
    expect(firstTask?.jobNumber).toBe('COMM-U')
  })

  it('4) urgente senza data', () => {
    const data = makePriorityData()
    data.vehicles = [priorityVehicle('v-u', 'URG002', 'Urgente', ''), priorityVehicle('v-n', 'NOR002', 'Normale', '')]
    data.jobs = [
      priorityJob({ id: 'j-u', number: 'COMM-U2', vehicleId: 'v-u', plate: 'URG002', priority: 'Urgente', minutes: 120, taxableAmount: 500 }),
      priorityJob({ id: 'j-n', number: 'COMM-N2', vehicleId: 'v-n', plate: 'NOR002', priority: 'Normale', minutes: 120, taxableAmount: 500 }),
    ]
    const generated = generateOperatorPrograms(data, '2026-08-14', 'Scenario 4')
    const firstTask = generated.programs.find((program) => program.operatorId === 'op-p1')?.tasks[0]
    expect(firstTask?.jobNumber).toBe('COMM-U2')
  })

  it('5) vettura normale ripianificata per fare spazio a urgente', () => {
    const constrainedSettings: PlannerSettings = {
      ...prioritySettings,
      operators: [{ id: 'op-only', name: 'Solo', dailyHours: 8, active: true, skills: ['lattoneria'] }],
    }
    const normal = { ...priorityVehicle('v-norm', 'NOR003', 'Normale', '2026-08-15'), estimatedHours: 10 }
    const urgent = { ...priorityVehicle('v-urg', 'URG003', 'Urgente', '2026-08-14'), estimatedHours: 10 }
    const before = calculatePlanner([normal], constrainedSettings, '2026-08-14').vehicles.find((item) => item.vehicleId === 'v-norm')
    const after = calculatePlanner([normal, urgent], constrainedSettings, '2026-08-14').vehicles.find((item) => item.vehicleId === 'v-norm')
    if (!before || !after) throw new Error('Pianificazione mancante per scenario 5')
    expect(before.calculatedDeliveryDate < after.calculatedDeliveryDate).toBe(true)
  })

  it('6) vettura con lavorazione gia iniziata non spostata', () => {
    const data = makePriorityData()
    const startedVehicle = priorityVehicle('v-start', 'STA001', 'Normale', '2026-08-14')
    const urgentNoDateVehicle = priorityVehicle('v-urg', 'URG004', 'Urgente', '')
    data.vehicles = [startedVehicle, urgentNoDateVehicle]
    const startedJob = priorityJob({ id: 'j-start', number: 'COMM-START', vehicleId: 'v-start', plate: 'STA001', priority: 'Normale', expectedDeliveryDate: '2026-08-14', phaseStatus: 'In lavorazione', minutes: 180, taxableAmount: 600 })
    startedJob.phases[0].operatorAssignments = [{ id: 'as-1', operatorName: 'Operatore 1', startedAt: '2026-08-14T08:00:00.000Z', workedMinutes: 30, activityStatus: 'Attivo' }]
    const urgentJob = priorityJob({ id: 'j-urg', number: 'COMM-URG4', vehicleId: 'v-urg', plate: 'URG004', priority: 'Urgente', minutes: 120, taxableAmount: 700 })
    data.jobs = [startedJob, urgentJob]
    const generated = generateOperatorPrograms(data, '2026-08-14', 'Scenario 6')
    const firstTask = generated.programs.find((program) => program.operatorId === 'op-p1')?.tasks[0]
    expect(firstTask?.jobNumber).toBe('COMM-START')
  })

  it('7) data promessa prevale sul margine', () => {
    const data = makePriorityData()
    data.vehicles = [priorityVehicle('v-low', 'LOW001', 'Normale', '2026-08-14'), priorityVehicle('v-high', 'HIG001', 'Normale', '')]
    data.jobs = [
      priorityJob({ id: 'j-low', number: 'COMM-LOW', vehicleId: 'v-low', plate: 'LOW001', priority: 'Normale', expectedDeliveryDate: '2026-08-14', minutes: 120, taxableAmount: 400 }),
      priorityJob({ id: 'j-high', number: 'COMM-HIGH', vehicleId: 'v-high', plate: 'HIG001', priority: 'Normale', minutes: 120, taxableAmount: 5000 }),
    ]
    const generated = generateOperatorPrograms(data, '2026-08-14', 'Scenario 7')
    const firstTask = generated.programs.find((program) => program.operatorId === 'op-p1')?.tasks[0]
    expect(firstTask?.jobNumber).toBe('COMM-LOW')
  })

  it('8) margine/ora maggiore usato solo a parita di vincoli superiori', () => {
    const data = makePriorityData()
    data.vehicles = [priorityVehicle('v-mh1', 'MH1001', 'Normale', ''), priorityVehicle('v-mh2', 'MH2001', 'Normale', '')]
    data.jobs = [
      priorityJob({ id: 'j-mh1', number: 'COMM-MH1', vehicleId: 'v-mh1', plate: 'MH1001', priority: 'Normale', minutes: 240, taxableAmount: 800 }),
      priorityJob({ id: 'j-mh2', number: 'COMM-MH2', vehicleId: 'v-mh2', plate: 'MH2001', priority: 'Normale', minutes: 120, taxableAmount: 900 }),
    ]
    const generated = generateOperatorPrograms(data, '2026-08-14', 'Scenario 8')
    const firstTask = generated.programs.find((program) => program.operatorId === 'op-p1')?.tasks[0]
    expect(firstTask?.jobNumber).toBe('COMM-MH2')
  })

  it('9) anticipo lavorazione -> ricalcolo', () => {
    const data = makeProgramData()
    const before = recalculateOperatorPrograms(data, '2026-07-27', 'Prima')
    const job = before.jobs?.find((item) => item.id === 'j1')
    if (!job) throw new Error('Job mancante')
    job.phases[1].status = 'Completata'
    job.phases.push({
      id: 'p-j1-next',
      name: 'Rimontaggio',
      status: 'Da fare',
      operatorAssignments: [],
      estimatedMinutes: 60,
      actualMinutes: 0,
      notes: '',
      blockedReason: '',
      requiredSkill: 'rimontaggio',
      cycleOrder: 40,
      notRequired: false,
      technicalWaitMinutes: 0,
      technicalWaitBlocksPhaseNames: [],
      timeAdjustments: [],
    })
    const after = recalculateOperatorPrograms(before, '2026-07-27', 'Anticipo')
    expect(after.operatorPrograms?.find((program) => program.operatorId === 'op-1')?.tasks[0]?.phaseName).toBe('Rimontaggio')
  })

  it('10) ritardo lavorazione -> ricalcolo', () => {
    const data = makeProgramData()
    const before = recalculateOperatorPrograms(data, '2026-07-27', 'Prima')
    const beforeEnd = before.operatorPrograms?.find((program) => program.operatorId === 'op-1')?.tasks[0]?.endAt ?? ''
    const delayed = structuredClone(before)
    const phase = delayed.jobs?.find((job) => job.id === 'j1')?.phases.find((item) => item.name === 'Lattoneria')
    if (!phase) throw new Error('Fase mancante')
    phase.estimatedMinutes = 300
    const after = recalculateOperatorPrograms(delayed, '2026-07-27', 'Ritardo')
    const afterEnd = after.operatorPrograms?.find((program) => program.operatorId === 'op-1')?.tasks[0]?.endAt ?? ''
    expect(afterEnd > beforeEnd).toBe(true)
  })

  it('11) storico degli spostamenti con motivazione', () => {
    const data = recalculateOperatorPrograms(makeProgramData(), '2026-07-27', 'Prima')
    const urgentVehicle = { ...vehicle('90', 8, '2026-07-27'), id: 'v90', plate: 'AA990AA', priority: 'Urgente' as const }
    data.vehicles.push(urgentVehicle)
    data.jobs?.push(baseJob('j90', 'COMM-00990', 'v90', 'AA990AA', 'Urgente', '2026-07-27'))
    const after = recalculateOperatorPrograms(data, '2026-07-27', 'Inserimento vettura urgente')
    expect((after.operatorProgramHistory ?? [])[0]?.reason).toMatch(/Inserimento vettura urgente/)
    expect((after.operatorProgramHistory ?? [])[0]?.reason).toMatch(/ripianificate/i)
  })

  it('12) simulazione impatto prima della conferma', () => {
    const data = makePriorityData()
    data.vehicles = [{ ...priorityVehicle('v-base', 'BAS001', 'Normale', '2026-08-14'), estimatedHours: 10 }]
    const simulation = simulateEstimateProductionForecast(data, {
      plate: 'NEW001',
      priority: 'Urgente',
      requestedDeliveryDate: '2026-08-14',
      lines: [estimateLine('Lattoneria', 240, 1200)],
      referenceDate: '2026-08-14',
    })
    expect(simulation.plannerImpact).toBeTruthy()
    expect(typeof simulation.plannerImpact?.summary).toBe('string')
  })
})

describe('calendario orari di lavoro', () => {
  const calendarSettings: PlannerSettings = {
    ...settings,
    weeklyWorkSchedule: [
      { dayOfWeek: 1, active: true, intervals: [{ startTime: '08:00', endTime: '12:30' }, { startTime: '13:30', endTime: '18:00' }] },
      { dayOfWeek: 2, active: true, intervals: [{ startTime: '08:00', endTime: '12:30' }, { startTime: '13:30', endTime: '18:00' }] },
      { dayOfWeek: 3, active: true, intervals: [{ startTime: '08:00', endTime: '12:30' }, { startTime: '13:30', endTime: '18:00' }] },
      { dayOfWeek: 4, active: true, intervals: [{ startTime: '08:00', endTime: '12:30' }, { startTime: '13:30', endTime: '18:00' }] },
      { dayOfWeek: 5, active: true, intervals: [{ startTime: '08:00', endTime: '12:30' }, { startTime: '13:30', endTime: '18:00' }] },
      { dayOfWeek: 6, active: false, intervals: [] },
      { dayOfWeek: 0, active: false, intervals: [] },
    ],
    companyClosures: [],
  }

  it('gestisce lavoro interamente al mattino', () => {
    expect(addWorkingMinutes('2026-07-27T08:00:00.000Z', 120, calendarSettings)).toBe('2026-07-27T10:00:00.000Z')
  })

  it('gestisce attraversamento pausa pranzo', () => {
    expect(addWorkingMinutes('2026-07-27T11:30:00.000Z', 180, calendarSettings)).toBe('2026-07-27T15:30:00.000Z')
  })

  it('prosegue il giorno successivo oltre orario di chiusura', () => {
    expect(addWorkingMinutes('2026-07-27T17:00:00.000Z', 120, calendarSettings)).toBe('2026-07-28T10:00:00.000Z')
  })

  it('salta il weekend da venerdi a lunedi', () => {
    expect(addWorkingMinutes('2026-07-31T17:00:00.000Z', 120, calendarSettings)).toBe('2026-08-03T10:00:00.000Z')
  })

  it('salta festivita e chiusure aziendali', () => {
    const closed = { ...calendarSettings, holidays: ['2026-07-28'], companyClosures: [{ id: 'c1', type: 'chiusura-straordinaria' as const, startDate: '2026-07-29', endDate: '2026-07-29', note: 'Chiuso' }] }
    expect(nextWorkingInstant('2026-07-28T08:00:00.000Z', closed)).toBe('2026-07-30T08:00:00.000Z')
  })

  it('supporta mezze giornate aziendali', () => {
    const halfDay = { ...calendarSettings, companyClosures: [{ id: 'c2', type: 'mezza-giornata' as const, startDate: '2026-07-27', endDate: '2026-07-27', startTime: '13:30', endTime: '18:00', note: 'Pomeriggio chiuso' }] }
    expect(getCompanyWorkingIntervals('2026-07-27', halfDay)).toHaveLength(1)
    expect(addWorkingMinutes('2026-07-27T11:30:00.000Z', 180, halfDay)).toBe('2026-07-28T10:00:00.000Z')
  })
})

describe('no past scheduling', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const makeNoPastData = () => {
    const data = structuredClone(emptyData)
    data.plannerSettings = {
      ...structuredClone(emptyData.plannerSettings),
      operators: [{ id: 'op-np', name: 'Operatore NP', dailyHours: 8, active: true, skills: ['lattoneria', 'smontaggio', 'preparazione'] }],
      workingDays: [1, 2, 3, 4, 5],
      efficiencyPercent: 100,
      safetyMarginPercent: 0,
      holidays: [],
      closures: [],
      absences: [],
      monthlyRevenueGoal: 0,
      ownerWithdrawalAmount: 0,
      ownerWithdrawalPlannedDate: '2026-08-31',
      monthlyMarginGoal: null,
    }
    data.customers = [{ id: 'c-np', type: 'Privato', name: 'Cliente', phone: '1', email: '', taxId: '', address: '', createdAt: '2026-08-10T00:00:00.000Z' }]
    data.vehicles = [{ ...vehicle('np1', 8, '2026-08-14'), id: 'v-np1', plate: 'NP001AA', priority: 'Normale', status: 'in-lavorazione', plannedEntryDate: '2026-08-13', manualPlanningDate: '2026-08-13' }]
    data.jobs = [{
      ...baseJob('j-np1', 'COMM-NP1', 'v-np1', 'NP001AA', 'Normale', '2026-08-14'),
      phases: [{ ...baseJob('j-np1', 'COMM-NP1', 'v-np1', 'NP001AA', 'Normale', '2026-08-14').phases[1], status: 'Da fare' }],
    }]
    return data
  }

  it('oggi 14/08 -> mai pianificare 13/08', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T10:30:00.000Z'))
    const data = makeNoPastData()
    const generated = generateOperatorPrograms(data, '2026-08-13', 'No past day test', '2026-08-14T10:30:00.000Z')
    const starts = generated.programs.flatMap((program) => program.tasks.map((task) => task.startAt.slice(0, 10)))
    expect(starts.every((date) => date >= '2026-08-14')).toBe(true)
  })

  it('oggi ore 10:30 -> mai pianificare prima delle 10:30', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T10:30:00.000Z'))
    const data = makeNoPastData()
    const generated = generateOperatorPrograms(data, '2026-08-14', 'No past time test', '2026-08-14T10:30:00.000Z')
    const first = generated.programs.find((program) => program.tasks.length)?.tasks[0]
    expect(first && first.startAt >= '2026-08-14T10:30:00.000Z').toBe(true)
  })

  it('dopo chiusura -> prossimo intervallo lavorativo', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T19:30:00.000Z'))
    const data = makeNoPastData()
    const generated = generateOperatorPrograms(data, '2026-08-13', 'After close test', '2026-08-13T19:30:00.000Z')
    const first = generated.programs.find((program) => program.tasks.length)?.tasks[0]
    expect(first?.startAt.slice(0, 10)).toBe('2026-08-14')
  })

  it('weekend chiuso -> lunedi', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T10:00:00.000Z'))
    const data = makeNoPastData()
    const generated = generateOperatorPrograms(data, '2026-08-15', 'Weekend test', '2026-08-15T10:00:00.000Z')
    const first = generated.programs.find((program) => program.tasks.length)?.tasks[0]
    expect(first?.startAt.slice(0, 10)).toBe('2026-08-17')
  })

  it('data promessa scaduta -> prima data realistica futura e motivo esplicito', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T10:30:00.000Z'))
    const data = makeNoPastData()
    const job = data.jobs?.find((item) => item.id === 'j-np1')
    if (!job) throw new Error('Job mancante')
    job.expectedDeliveryDate = '2026-08-13'
    const queue = buildPlannerQueue(data, '2026-08-13', 30, '2026-08-14T10:30:00.000Z')
    const item = queue.find((entry) => entry.jobId === 'j-np1')
    expect(item?.reason).toBe('Data richiesta scaduta')
    const plan = calculatePlanner(data.vehicles, data.plannerSettings, '2026-08-13', '2026-08-14T10:30:00.000Z').vehicles.find((entry) => entry.vehicleId === 'v-np1')
    expect((plan?.suggestedDate ?? '') >= '2026-08-14').toBe(true)
  })

  it('urgente -> mai nel passato', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T10:30:00.000Z'))
    const data = makeNoPastData()
    const job = data.jobs?.find((item) => item.id === 'j-np1')
    const vehicleData = data.vehicles.find((item) => item.id === 'v-np1')
    if (!job || !vehicleData) throw new Error('Dati mancanti')
    job.priority = 'Urgente'
    vehicleData.priority = 'Urgente'
    const generated = generateOperatorPrograms(data, '2026-08-13', 'Urgent floor test', '2026-08-14T10:30:00.000Z')
    const first = generated.programs.find((program) => program.tasks.length)?.tasks[0]
    expect(first && first.startAt >= '2026-08-14T10:30:00.000Z').toBe(true)
  })

  it('ripianificazione -> solo da now in avanti', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T10:30:00.000Z'))
    const data = makeNoPastData()
    const seeded = recalculateOperatorPrograms(data, '2026-08-13', 'Before now replan', '2026-08-14T10:30:00.000Z')
    const starts = (seeded.operatorPrograms ?? []).flatMap((program) => program.tasks.map((task) => task.startAt))
    expect(starts.every((start) => start >= '2026-08-14T10:30:00.000Z')).toBe(true)
  })

  it('attivita storiche passate rimangono inalterate e visibili', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T10:30:00.000Z'))
    const data = makeNoPastData()
    data.jobs = [{
      ...baseJob('j-old-active', 'COMM-OLD-ACTIVE', 'v-np1', 'NP001AA', 'Normale', '2026-08-16'),
      status: 'In lavorazione',
      phases: [{
        id: 'phase-old-active',
        name: 'Lattoneria',
        status: 'Da fare',
        operatorAssignments: [],
        estimatedMinutes: 60,
        actualMinutes: 0,
        notes: '',
        blockedReason: '',
      }],
    }]
    data.operatorPrograms = [{
      date: '2026-08-13',
      operatorId: 'op-np',
      operatorName: 'Operatore NP',
      generatedAt: '2026-08-13T12:00:00.000Z',
      revision: 1,
      tasks: [{
        id: 'hist-task',
        operatorId: 'op-np',
        operatorName: 'Operatore NP',
        vehicleId: 'v-np1',
        plate: 'NP001AA',
        jobId: 'j-old-active',
        jobNumber: 'COMM-OLD-ACTIVE',
        phaseId: 'phase-old-active',
        phaseName: 'Lattoneria',
        startAt: '2026-08-13T09:00:00.000Z',
        endAt: '2026-08-13T10:00:00.000Z',
        plannedMinutes: 60,
        priority: 'Normale',
        reason: 'Storico reale',
        revision: 1,
      }],
    }]
    const next = recalculateOperatorPrograms(data, '2026-08-15', 'Preserve history', '2026-08-15T10:30:00.000Z')
    const activeTasks = (next.operatorPrograms ?? []).flatMap((program) => program.tasks.filter((task) => task.jobId === 'j-old-active').map((task) => ({ date: program.date, startAt: task.startAt })))
    expect(activeTasks.every((task) => task.date >= '2026-08-15' && task.startAt >= '2026-08-15T10:30:00.000Z')).toBe(true)
    expect(activeTasks.some((task) => task.date === '2026-08-17')).toBe(true)
    const hasPastInCurrent = (next.operatorPrograms ?? []).some((program) => program.date < '2026-08-15' && program.tasks.some((task) => task.jobId === 'j-old-active'))
    expect(hasPastInCurrent).toBe(false)
    const hasPastInHistory = (next.operatorProgramHistory ?? []).some((entry) => (entry.previousPrograms ?? []).some((program) => program.tasks.some((task) => task.id === 'hist-task')))
    expect(hasPastInHistory).toBe(true)
  })

  it('timezone locale -> nessuno slittamento di giornata', () => {
    vi.useFakeTimers()
    const now = new Date('2026-08-13T22:30:00.000Z')
    vi.setSystemTime(now)
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(todayKey()).toBe(expected)
  })

  it('attivita ieri non completata -> ripianificata al primo slot utile', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T10:30:00.000Z'))
    const data = makeNoPastData()
    const recalculated = recalculateOperatorPrograms(data, '2026-08-15', 'Arretrato da ieri', '2026-08-15T10:30:00.000Z')
    const task = (recalculated.operatorPrograms ?? []).flatMap((program) => program.tasks).find((item) => item.jobId === 'j-np1')
    expect(task).toBeTruthy()
    expect(task && task.startAt >= '2026-08-15T10:30:00.000Z').toBe(true)
    expect(task?.startAt.slice(0, 10)).toBe('2026-08-17')
  })
})

describe('commesse attive restano operative fino a consegna', () => {
  const buildActiveData = () => {
    const data = makeProgramData()
    data.vehicles = [{ ...vehicle('41', 6, '2026-08-16'), id: 'v-active', plate: 'CD123SN', status: 'Pronta', coneNumber: 5, priority: 'Normale', plannedEntryDate: '2026-08-13', manualPlanningDate: '2026-08-13' }]
    data.jobs = [{
      ...baseJob('j-active', 'COMM-ACTIVE', 'v-active', 'CD123SN', 'Normale', '2026-08-16'),
      status: 'Pronta consegna',
      phases: [{
        id: 'phase-active-1',
        name: 'Controllo qualità',
        status: 'Da fare',
        operatorAssignments: [],
        estimatedMinutes: 60,
        actualMinutes: 0,
        notes: '',
        blockedReason: '',
      }],
    }]
    return data
  }

  it('commessa attiva -> sempre presente nel Planner', () => {
    const data = buildActiveData()
    const queue = buildPlannerQueue(data, '2026-08-15', 30, '2026-08-15T10:00:00.000Z')
    expect(queue.some((item) => item.jobId === 'j-active')).toBe(true)
  })

  it('Pronta -> rimane nel Planner/presente', () => {
    const data = buildActiveData()
    data.vehicles[0].status = 'Pronta'
    const queue = buildPlannerQueue(data, '2026-08-15', 30, '2026-08-15T10:00:00.000Z')
    expect(queue.some((item) => item.jobId === 'j-active')).toBe(true)
  })

  it('In attesa ricambi -> rimane presente', () => {
    const data = buildActiveData()
    data.vehicles[0].partsStatus = 'Mancanti'
    data.vehicles[0].blockReason = 'Attesa ricambi paraurti'
    const queue = buildPlannerQueue(data, '2026-08-15', 30, '2026-08-15T10:00:00.000Z')
    const item = queue.find((entry) => entry.jobId === 'j-active')
    expect(item).toBeTruthy()
    expect(item?.schedulable).toBe(false)
    expect(item?.reason).toMatch(/Attesa ricambi/i)
  })

  it('Bloccata -> rimane presente', () => {
    const data = buildActiveData()
    if (!data.jobs?.[0]) throw new Error('Job mancante')
    data.jobs[0].status = 'In attesa'
    const queue = buildPlannerQueue(data, '2026-08-15', 30, '2026-08-15T10:00:00.000Z')
    const item = queue.find((entry) => entry.jobId === 'j-active')
    expect(item).toBeTruthy()
    expect(item?.schedulable).toBe(false)
    expect(item?.reason).toMatch(/Bloccata/i)
  })

  it('nessuno slot -> Da pianificare, non scompare', () => {
    const data = buildActiveData()
    data.plannerSettings.operators = []
    const queue = buildPlannerQueue(data, '2026-08-15', 30, '2026-08-15T10:00:00.000Z')
    const item = queue.find((entry) => entry.jobId === 'j-active')
    expect(item).toBeTruthy()
    expect(item?.schedulable).toBe(false)
  })

  it('Consegnata -> esce dal Planner futuro', () => {
    const data = buildActiveData()
    const seeded = recalculateOperatorPrograms(data, '2026-08-15', 'Piano iniziale', '2026-08-15T10:00:00.000Z')
    if (!seeded.jobs || !seeded.vehicles.length) throw new Error('Dati mancanti')
    seeded.jobs[0].status = 'Consegnata'
    seeded.vehicles[0].status = 'Consegnata'
    const afterDelivery = recalculateOperatorPrograms(seeded, '2026-08-16', 'Consegna', '2026-08-16T10:00:00.000Z')
    const stillPlanned = (afterDelivery.operatorPrograms ?? []).some((program) => program.date >= '2026-08-16' && program.tasks.some((task) => task.jobId === 'j-active'))
    expect(stillPlanned).toBe(false)
  })

  it('Consegnata -> storico conservato', () => {
    const seeded = buildActiveData()
    seeded.operatorPrograms = [{
      date: '2026-08-16',
      operatorId: 'op-1',
      operatorName: 'Filippo',
      generatedAt: '2026-08-15T12:00:00.000Z',
      revision: 1,
      tasks: [{
        id: 'task-active-history',
        operatorId: 'op-1',
        operatorName: 'Filippo',
        vehicleId: 'v-active',
        plate: 'CD123SN',
        jobId: 'j-active',
        jobNumber: 'COMM-ACTIVE',
        phaseId: 'phase-active-1',
        phaseName: 'Controllo qualità',
        startAt: '2026-08-16T08:00:00.000Z',
        endAt: '2026-08-16T09:00:00.000Z',
        plannedMinutes: 60,
        priority: 'Normale',
        reason: 'Pianificazione iniziale',
        revision: 1,
      }],
      summary: {
        plannedMinutes: 60,
        actualMinutes: 0,
        differenceMinutes: -60,
        overtimeMinutes: 0,
        advancedMinutes: 0,
        completedPlannedMinutes: 0,
        efficiencyPercent: 0,
      },
    }]
    if (!seeded.jobs || !seeded.vehicles.length) throw new Error('Dati mancanti')
    seeded.jobs[0].status = 'Consegnata'
    seeded.vehicles[0].status = 'consegnata'
    const afterDelivery = recalculateOperatorPrograms(seeded, '2026-08-16', 'Consegna', '2026-08-16T10:00:00.000Z')
    const preservedInHistory = (afterDelivery.operatorProgramHistory ?? []).some((entry) => (entry.previousPrograms ?? []).some((program) => program.tasks.some((task) => task.jobId === 'j-active')))
    expect(preservedInHistory).toBe(true)
  })

  it('Consegnata -> cono liberato', () => {
    const data = buildActiveData()
    if (!data.jobs?.[0]) throw new Error('Job mancante')
    data.jobs[0].status = 'Consegnata'
    data.vehicles[0].status = 'consegnata'
    const synced = syncOperationalStateFromJobs(data)
    expect(synced.vehicles.find((item) => item.id === 'v-active')?.coneNumber).toBe(null)
  })

  it('ricalcolo ripetuto -> nessuna commessa attiva persa', () => {
    let data = buildActiveData()
    for (let index = 0; index < 5; index += 1) {
      const date = `2026-08-${String(15 + index).padStart(2, '0')}`
      data = recalculateOperatorPrograms(data, date, `Loop ${index + 1}`, `${date}T10:00:00.000Z`)
      const activeJobIds = new Set((data.jobs ?? []).filter((job) => job.status !== 'Consegnata' && job.status !== 'Annullata').map((job) => job.id))
      const queueIds = new Set(buildPlannerQueue(data, date, 30, `${date}T10:00:00.000Z`).map((item) => item.jobId))
      const plannedIds = new Set((data.operatorPrograms ?? []).flatMap((program) => program.tasks.map((task) => task.jobId)))
      for (const jobId of activeJobIds) {
        expect(queueIds.has(jobId) || plannedIds.has(jobId)).toBe(true)
      }
    }
  })
})

describe('invarianti anagrafiche su ricalcolo planner', () => {
  it('Planner recalculation -> conteggi anagrafici invariati', () => {
    const base = structuredClone(emptyData)
    base.customers = [{ id: 'c1', type: 'Privato', name: 'Cliente test', phone: '123', email: '', taxId: '', address: '', createdAt: '2026-08-15T08:00:00.000Z' }]
    base.vehicles = [{ ...vehicle('51', 6, '2026-08-20'), id: 'v1', customerId: 'c1', plate: 'PLN123', status: 'in-lavorazione', plannedEntryDate: '2026-08-15', manualPlanningDate: '2026-08-15' }]
    base.estimates = [{
      id: 'est-1',
      number: 'PREV-001',
      date: '2026-08-15',
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'PLN123',
      companyName: '',
      contactName: '',
      notes: '',
      status: 'Bozza',
      lines: [],
      taxableAmount: 0,
      vatAmount: 0,
      total: 0,
      convertedJobId: null,
      history: [],
      createdAt: '2026-08-15T08:00:00.000Z',
      updatedAt: '2026-08-15T08:00:00.000Z',
    }]
    base.jobs = [{
      ...baseJob('j1', 'COMM-001', 'v1', 'PLN123', 'Normale', '2026-08-20'),
      status: 'In lavorazione',
    }]

    const before = buildIntegritySnapshot(base)
    const recalculated = recalculateOperatorPrograms(base, '2026-08-15', 'Test integrazione conteggi')
    const after = buildIntegritySnapshot(recalculated)

    expect(after).toEqual(before)
  })
})
