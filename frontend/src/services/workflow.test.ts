import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { ErpData, StandardWorkDefinition, Vehicle } from '../types'
import { calculateCashFlowSnapshot } from './cashflow'
import { buildTodayInShopSnapshot } from '../features/production/production'
import { loadDatabase, saveDatabase } from './database'
import { changeVehicleStatus, emptyData, TOTAL_CONES } from './erp'
import { calculatePlanner, recalculateOperatorPrograms, simulateEstimateProductionForecast } from './planner'
import {
  approveEstimateAndCreateJob,
  confirmEstimateAndCreateJobTransactional,
  createDirectJob,
  createEstimate,
  estimatePhaseTotals,
  estimateVehicleTotalMinutes,
  updateJobPhaseEstimatedMinutes,
  updateJobPhaseOperators,
  workflowOperationalSnapshot,
  workTypeTimeComparison,
  updateEstimateStatus,
  updateEstimate,
  updateJobMeta,
  updateJobPhase,
  updateJobStatus,
  resolveInternalHourlyRate,
} from './workflow'

const baseVehicle = (customerId: string): Vehicle => ({
  id: 'v1',
  customerId,
  plate: 'AB123CD',
  make: 'Fiat',
  model: '500',
  color: 'Nero',
  year: '2022',
  vin: 'VIN-1',
  mileage: '12000',
  status: 'Confermata',
  coneNumber: 4,
  estimatedHours: 8,
  workedHours: 0,
  plannedEntryDate: '2026-08-10',
  requestedDeliveryDate: '2026-08-20',
  calculatedDeliveryDate: '',
  expectedRevenue: 1000,
  expectedMargin: 250,
  partsStatus: 'Disponibili',
  blockReason: '',
  manualPlanningDate: '2026-08-10',
  createdAt: '2026-08-01T00:00:00.000Z',
})

const makeData = (): ErpData => ({
  ...structuredClone(emptyData),
  customers: [{
    id: 'c1',
    type: 'Privato',
    name: 'Mario Rossi',
    phone: '333',
    email: '',
    taxId: '',
    address: '',
    createdAt: '2026-08-01T00:00:00.000Z',
  }],
  vehicles: [baseVehicle('c1')],
  qualityChecklistTemplates: ['Lavorazioni completate', 'Controllo finale'],
})

describe('workflow preventivi e commesse', () => {
  it('consente creazione autonoma di una nuova regola tempo', () => {
    const data = makeData()
    const lucidatura: StandardWorkDefinition = {
      id: 'std-lucidatura',
      name: 'Lucidatura',
      calculationType: 'per-vehicle' as const,
      standardMinutes: 80,
      categoryOrPhase: 'Lucidatura',
      active: true,
      requiredSkill: 'lucidatura',
      cycleOrder: 70,
      rules: [{
        id: 'rule-lucidatura-grande-nera',
        name: 'Lucidatura vettura grande nera',
        minutes: 150,
        priority: 10,
        active: true,
        conditions: { vehicleSizeClass: 'grande', colorFamily: 'nera', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} },
      }],
    }
    data.plannerSettings.standardWorks = [...(data.plannerSettings.standardWorks ?? []), lucidatura]

    const created = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelName: '',
        vehicleSizeClass: 'grande',
        colorFamily: 'nera',
        paintCycle: '',
        description: 'Lucidatura',
        standardWorkName: 'Lucidatura',
        category: 'carrozzeria',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        vatRate: 22,
      }],
    })

    const line = created.estimates?.[0].lines[0]
    expect(line?.estimatedMinutes).toBe(150)
    expect(line?.appliedRuleName).toBe('Lucidatura vettura grande nera')
  })

  it('applica modifica regola e duplicazione scegliendo priorita/specificita corretta', () => {
    const data = makeData()
    const custom: StandardWorkDefinition = {
      id: 'std-lucidatura-2',
      name: 'Lucidatura',
      calculationType: 'per-vehicle' as const,
      standardMinutes: 90,
      categoryOrPhase: 'Lucidatura',
      active: true,
      requiredSkill: 'lucidatura',
      cycleOrder: 70,
      rules: [{
        id: 'r1',
        name: 'Lucidatura media chiara',
        minutes: 100,
        priority: 1,
        active: true,
        conditions: { vehicleSizeClass: 'media', colorFamily: 'chiara', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} },
      }],
    }
    const customRules = custom.rules ?? []
    customRules[0].minutes = 110
    customRules.push({
      ...customRules[0],
      id: 'r2',
      name: 'Lucidatura media chiara premium',
      minutes: 130,
      priority: 5,
    })
    custom.rules = customRules
    data.plannerSettings.standardWorks = [...(data.plannerSettings.standardWorks ?? []), custom]

    const created = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        vehicleSizeClass: 'media',
        colorFamily: 'chiara',
        description: 'Lucidatura',
        standardWorkName: 'Lucidatura',
        category: 'carrozzeria',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        vatRate: 22,
      }],
    })
    const line = created.estimates?.[0].lines[0]
    expect(line?.estimatedMinutes).toBe(130)
    expect(line?.appliedRuleName).toBe('Lucidatura media chiara premium')
  })

  it('seleziona regole per dimensione, colore e combinazione dimensione+colore', () => {
    const data = makeData()
    const custom: StandardWorkDefinition = {
      id: 'std-lucidatura-3',
      name: 'Lucidatura',
      calculationType: 'per-vehicle' as const,
      standardMinutes: 95,
      categoryOrPhase: 'Lucidatura',
      active: true,
      requiredSkill: 'lucidatura',
      cycleOrder: 70,
      rules: [
        { id: 'dim', name: 'Per dimensione grande', minutes: 120, priority: 1, active: true, conditions: { vehicleSizeClass: 'grande', colorFamily: '', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} } },
        { id: 'col', name: 'Per colore nero', minutes: 125, priority: 1, active: true, conditions: { vehicleSizeClass: '', colorFamily: 'nero', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} } },
        { id: 'both', name: 'Grande + nero', minutes: 150, priority: 2, active: true, conditions: { vehicleSizeClass: 'grande', colorFamily: 'nero', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} } },
      ],
    }
    data.plannerSettings.standardWorks = [...(data.plannerSettings.standardWorks ?? []), custom]

    const combination = createEstimate(data, {
      customerId: 'c1', vehicleId: 'v1', plate: 'AB123CD', companyName: '', contactName: '', date: '2026-08-09', notes: '',
      lines: [{ vehicleSizeClass: 'grande', colorFamily: 'nero', description: 'Lucidatura', standardWorkName: 'Lucidatura', category: 'carrozzeria', quantity: 1, unitPrice: 1, discount: 0, vatRate: 22 }],
    })
    expect(combination.estimates?.[0].lines[0].estimatedMinutes).toBe(150)

    const onlySize = createEstimate(data, {
      customerId: 'c1', vehicleId: 'v1', plate: 'AB123CD', companyName: '', contactName: '', date: '2026-08-09', notes: '',
      lines: [{ vehicleSizeClass: 'grande', colorFamily: 'chiaro', description: 'Lucidatura', standardWorkName: 'Lucidatura', category: 'carrozzeria', quantity: 1, unitPrice: 1, discount: 0, vatRate: 22 }],
    })
    expect(onlySize.estimates?.[0].lines[0].estimatedMinutes).toBe(120)

    const onlyColor = createEstimate(data, {
      customerId: 'c1', vehicleId: 'v1', plate: 'AB123CD', companyName: '', contactName: '', date: '2026-08-09', notes: '',
      lines: [{ vehicleSizeClass: 'media', colorFamily: 'nero', description: 'Lucidatura', standardWorkName: 'Lucidatura', category: 'carrozzeria', quantity: 1, unitPrice: 1, discount: 0, vatRate: 22 }],
    })
    expect(onlyColor.estimates?.[0].lines[0].estimatedMinutes).toBe(125)
  })

  it('usa fallback al tempo base se nessuna regola specifica corrisponde', () => {
    const data = makeData()
    data.plannerSettings.standardWorks = [
      ...(data.plannerSettings.standardWorks ?? []),
      {
        id: 'std-fallback',
        name: 'Lucidatura',
        calculationType: 'per-vehicle' as const,
        standardMinutes: 90,
        categoryOrPhase: 'Lucidatura',
        active: true,
        requiredSkill: 'lucidatura',
        cycleOrder: 70,
        rules: [{ id: 'rule-specific', name: 'Solo grande nera', minutes: 150, priority: 5, active: true, conditions: { vehicleSizeClass: 'grande', colorFamily: 'nera', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} } }],
      },
    ]
    const created = createEstimate(data, {
      customerId: 'c1', vehicleId: 'v1', plate: 'AB123CD', companyName: '', contactName: '', date: '2026-08-09', notes: '',
      lines: [{ vehicleSizeClass: 'piccola', colorFamily: 'blu', description: 'Lucidatura', standardWorkName: 'Lucidatura', category: 'carrozzeria', quantity: 1, unitPrice: 1, discount: 0, vatRate: 22 }],
    })
    expect(created.estimates?.[0].lines[0].estimatedMinutes).toBe(90)
    expect(Boolean(created.estimates?.[0].lines[0].appliedRuleName)).toBe(false)
  })
  it('crea preventivo con calcoli imponibile, IVA e totale', () => {
    const data = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: 'Concessionaria Uno',
      contactName: 'Luca',
      date: '2026-08-09',
      notes: 'Note',
      lines: [{
        description: 'Verniciatura cofano',
        category: 'verniciatura',
        quantity: 2,
        unitPrice: 100,
        discount: 10,
        vatRate: 22,
      }],
    })

    expect(data.estimates).toHaveLength(1)
    expect(data.estimates?.[0].taxableAmount).toBe(190)
    expect(data.estimates?.[0].vatAmount).toBe(41.8)
    expect(data.estimates?.[0].total).toBe(231.8)
  })

  it('applica automaticamente i tempi standard in preventivo mantenendo invariato lo standard globale', () => {
    const source = makeData()
    const globalStandard = (source.plannerSettings.standardWorks ?? []).find((item) => item.name === 'Smontaggio')
    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Smontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 }],
    })

    const line = data.estimates?.[0].lines[0]
    expect(line?.standardWorkName).toBe('Smontaggio')
    expect(line?.standardMinutes).toBe(globalStandard?.standardMinutes)
    expect(line?.estimatedMinutes).toBe(globalStandard?.standardMinutes)
    expect((data.plannerSettings.standardWorks ?? []).find((item) => item.name === 'Smontaggio')?.standardMinutes).toBe(globalStandard?.standardMinutes)
  })

  it('consente override del tempo preventivato per vettura senza alterare il tempo standard', () => {
    const data = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        description: 'Smontaggio',
        standardWorkName: 'Smontaggio',
        estimatedMinutes: 90,
        category: 'carrozzeria',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        vatRate: 22,
      }],
    })

    const line = data.estimates?.[0].lines[0]
    expect(line?.standardMinutes).toBe(60)
    expect(line?.estimatedMinutes).toBe(90)
  })

  it('calcola il tempo per pannello e aggrega 3 pannelli sulla stessa fase', () => {
    const data = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [
        { panelName: 'Parafango ant. DX', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Porta ant. DX', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Paraurti post.', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
      ],
    })
    const lines = data.estimates?.[0].lines ?? []
    const phaseTotals = estimatePhaseTotals(lines)
    expect(lines.every((line) => line.calculationType === 'per-panel')).toBe(true)
    expect(lines.every((line) => line.estimatedMinutes === 60)).toBe(true)
    expect(phaseTotals.get('Preparazione')).toBe(180)
    expect(estimateVehicleTotalMinutes(lines)).toBe(180)
  })

  it('consente override manuale su singolo pannello senza alterare gli altri', () => {
    const data = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [
        { panelName: 'Porta DX', description: 'Lattoneria', standardWorkName: 'Lattoneria', estimatedMinutes: 75, category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Porta SX', description: 'Lattoneria', standardWorkName: 'Lattoneria', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
      ],
    })
    const lines = data.estimates?.[0].lines ?? []
    expect(lines[0].manualTimeOverride).toBe(true)
    expect(lines[0].estimatedMinutes).toBe(75)
    expect(lines[1].manualTimeOverride).toBe(false)
    expect(lines[1].estimatedMinutes).toBe(30)
  })

  it('gestisce un pannello con una sola lavorazione', () => {
    const data = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ panelName: 'Porta anteriore SX', description: 'Smontaggio', standardWorkName: 'Smontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 }],
    })
    const lines = data.estimates?.[0].lines ?? []
    expect(lines).toHaveLength(1)
    expect(lines[0].panelName).toBe('Porta anteriore SX')
    expect(lines[0].estimatedMinutes).toBe(60)
  })

  it('gestisce un pannello con 8 lavorazioni contemporanee', () => {
    const source = makeData()
    source.plannerSettings.standardWorks = (source.plannerSettings.standardWorks ?? []).map((work) =>
      work.name === 'Stuccatura'
        ? { ...work, standardMinutes: 35, active: true }
        : work,
    )
    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [
        { panelName: 'Porta anteriore SX', description: 'Smontaggio', standardWorkName: 'Smontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Porta anteriore SX', description: 'Lattoneria', standardWorkName: 'Lattoneria', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Porta anteriore SX', description: 'Stuccatura', standardWorkName: 'Stuccatura', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Porta anteriore SX', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Porta anteriore SX', description: 'Incartatura', standardWorkName: 'Incartatura', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Porta anteriore SX', description: 'Verniciatura standard', standardWorkName: 'Verniciatura standard', category: 'verniciatura', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Porta anteriore SX', description: 'Scartatura', standardWorkName: 'Scartatura', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Porta anteriore SX', description: 'Rimontaggio', standardWorkName: 'Rimontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
      ],
    })
    const lines = data.estimates?.[0].lines ?? []
    expect(lines.filter((line) => line.panelName === 'Porta anteriore SX')).toHaveLength(8)
    expect(estimateVehicleTotalMinutes(lines)).toBe(355)
  })

  it('gestisce piu pannelli con lavorazioni differenti e aggrega per vettura', () => {
    const data = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [
        { panelName: 'Porta SX', description: 'Smontaggio', standardWorkName: 'Smontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 10, discount: 0, vatRate: 22 },
        { panelName: 'Porta SX', description: 'Verniciatura standard', standardWorkName: 'Verniciatura standard', category: 'verniciatura', quantity: 1, unitPrice: 10, discount: 0, vatRate: 22 },
        { panelName: 'Parafango DX', description: 'Lattoneria', standardWorkName: 'Lattoneria', category: 'carrozzeria', quantity: 1, unitPrice: 10, discount: 0, vatRate: 22 },
        { panelName: 'Parafango DX', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 10, discount: 0, vatRate: 22 },
      ],
    })
    const lines = data.estimates?.[0].lines ?? []
    expect(lines.filter((line) => line.panelName === 'Porta SX')).toHaveLength(2)
    expect(lines.filter((line) => line.panelName === 'Parafango DX')).toHaveLength(2)
    expect(estimateVehicleTotalMinutes(lines)).toBe(180)
  })

  it('modifica il tempo di una sola lavorazione su pannello mantenendo le altre invariate', () => {
    const data = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [
        { panelName: 'Porta SX', description: 'Smontaggio', standardWorkName: 'Smontaggio', estimatedMinutes: 61, category: 'carrozzeria', quantity: 1, unitPrice: 10, discount: 0, vatRate: 22 },
        { panelName: 'Porta SX', description: 'Lattoneria', standardWorkName: 'Lattoneria', category: 'carrozzeria', quantity: 1, unitPrice: 10, discount: 0, vatRate: 22 },
      ],
    })
    const lines = data.estimates?.[0].lines ?? []
    const smontaggio = lines.find((line) => line.standardWorkName === 'Smontaggio')
    const lattoneria = lines.find((line) => line.standardWorkName === 'Lattoneria')
    expect(smontaggio?.estimatedMinutes).toBe(61)
    expect(smontaggio?.manualTimeOverride).toBe(true)
    expect(lattoneria?.estimatedMinutes).toBe(30)
    expect(lattoneria?.manualTimeOverride).toBe(false)
  })

  it('converte Preventivo -> Commessa conservando dettaglio pannello-lavorazioni e aggregando fasi', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [
        { panelName: 'Porta SX', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 30, discount: 0, vatRate: 22 },
        { panelName: 'Porta DX', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 30, discount: 0, vatRate: 22 },
        { panelName: 'Parafango SX', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 30, discount: 0, vatRate: 22 },
      ],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const job = converted.jobs?.[0]
    expect(job?.lines).toHaveLength(3)
    expect(job?.lines.map((line) => line.panelName)).toEqual(['Porta SX', 'Porta DX', 'Parafango SX'])
    const preparazione = job?.phases.find((phase) => phase.name === 'Preparazione')
    expect(preparazione?.estimatedMinutes).toBe(180)
  })

  it('mantiene separata verniciatura standard da verniciatura perlato', () => {
    const data = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [
        { panelName: 'Cofano', description: 'Verniciatura standard', standardWorkName: 'Verniciatura standard', category: 'verniciatura', quantity: 1, unitPrice: 80, discount: 0, vatRate: 22 },
        { panelName: 'Parafango', description: 'Verniciatura perlato', standardWorkName: 'Verniciatura perlato', category: 'verniciatura', quantity: 1, unitPrice: 95, discount: 0, vatRate: 22 },
      ],
    })
    const lines = data.estimates?.[0].lines ?? []
    const standard = lines.find((line) => line.standardWorkName === 'Verniciatura standard')
    const perlato = lines.find((line) => line.standardWorkName === 'Verniciatura perlato')
    expect(standard?.estimatedMinutes).toBe(30)
    expect(perlato?.estimatedMinutes).toBe(45)
    expect(standard?.estimatedMinutes).not.toBe(perlato?.estimatedMinutes)
  })

  it('applica listino specifico quando il variant cycle corrisponde a intero-mezzo', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [
      {
        id: 'pl-mezzo',
        panelName: 'Porta anteriore SX',
        workName: 'Smontaggio',
        variantCycle: 'mezzo',
        unitPrice: 80,
        active: true,
      },
      {
        id: 'pl-intero',
        panelName: 'Porta anteriore SX',
        workName: 'Smontaggio',
        variantCycle: 'intero',
        unitPrice: 150,
        active: true,
      },
    ]

    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelName: 'Porta anteriore SX',
        repairExtent: 'mezzo',
        description: 'Smontaggio',
        standardWorkName: 'Smontaggio',
        category: 'carrozzeria',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    expect(data.estimates?.[0].lines[0].unitPrice).toBe(80)
  })

  it('recupera il prezzo del listino anche quando l\'estensione e modellata come campo dedicato', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [{
      id: 'pl-repair-extent',
      panelName: 'Porta posteriore SX',
      workName: 'Preparazione',
      repairExtent: 'intero',
      variantCycle: '',
      unitPrice: 220,
      active: true,
    }]

    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelName: 'Porta posteriore SX',
        repairExtent: 'intero',
        description: 'Preparazione',
        standardWorkName: 'Preparazione',
        category: 'carrozzeria',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    expect(data.estimates?.[0].lines[0].unitPrice).toBe(220)
  })

  it('cofano + verniciatura + doppiostrato recupera prezzo listino e tempo standard', () => {
    const source = makeData()
    source.plannerSettings.standardWorks = [{
      id: 'std-verniciatura',
      name: 'Verniciatura',
      calculationType: 'per-panel',
      standardMinutes: 30,
      categoryOrPhase: 'Verniciatura',
      rules: [],
      active: true,
      requiredSkill: 'verniciatura',
      cycleOrder: 50,
    }]
    source.plannerSettings.standardWorkPriceList = [{
      id: 'pl-cofano-doppio',
      panelName: 'Cofano',
      workName: 'Verniciatura',
      repairExtent: 'intero',
      variantCycle: 'doppiostrato',
      unitPrice: 250,
      vatRate: 22,
      active: true,
      note: '',
    }]

    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelId: 'cofano',
        panelName: 'Cofano',
        repairExtent: 'intero',
        paintCycle: 'doppiostrato',
        description: 'Verniciatura',
        standardWorkName: 'Verniciatura',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    const line = data.estimates?.[0].lines[0]
    expect(line?.standardMinutes).toBe(30)
    expect(line?.estimatedMinutes).toBe(30)
    expect(line?.unitPrice).toBe(250)
  })

  it('quando la variante non corrisponde non applica il prezzo del listino', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [{
      id: 'pl-variante-match',
      panelName: 'Cofano',
      workName: 'Verniciatura',
      repairExtent: 'intero',
      variantCycle: 'doppiostrato',
      unitPrice: 250,
      active: true,
    }]

    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelId: 'cofano',
        panelName: 'Cofano',
        repairExtent: 'intero',
        paintCycle: 'monostrato',
        description: 'Verniciatura',
        standardWorkName: 'Verniciatura',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    expect(data.estimates?.[0].lines[0].unitPrice).toBe(0)
  })

  it('riconosce il pannello anche tramite panelId normalizzato', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [{
      id: 'pl-panel-id',
      panelName: 'cofano',
      workName: 'Verniciatura',
      repairExtent: 'intero',
      variantCycle: 'doppiostrato',
      unitPrice: 250,
      active: true,
    }]

    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelId: 'cofano',
        panelName: 'Cofano',
        repairExtent: 'intero',
        paintCycle: 'doppiostrato',
        description: 'Verniciatura',
        standardWorkName: 'Verniciatura standard',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    expect(data.estimates?.[0].lines[0].unitPrice).toBe(250)
  })

  it('usa la voce con estensione Tutti quando non esiste una voce specifica', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [{
      id: 'pl-tutti',
      panelName: 'Cofano',
      workName: 'Verniciatura',
      repairExtent: '',
      variantCycle: '',
      unitPrice: 190,
      active: true,
    }]

    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelName: 'Cofano',
        repairExtent: 'mezzo',
        description: 'Verniciatura',
        standardWorkName: 'Verniciatura',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    expect(data.estimates?.[0].lines[0].unitPrice).toBe(190)
  })

  it('prioritizza la voce specifica intero/mezzo rispetto a Tutti', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [
      {
        id: 'pl-tutti',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: '',
        variantCycle: '',
        unitPrice: 190,
        active: true,
      },
      {
        id: 'pl-intero',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: 'intero',
        variantCycle: '',
        unitPrice: 250,
        active: true,
      },
      {
        id: 'pl-mezzo',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: 'mezzo',
        variantCycle: '',
        unitPrice: 140,
        active: true,
      },
    ]

    const intero = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelName: 'Cofano',
        repairExtent: 'intero',
        description: 'Verniciatura',
        standardWorkName: 'Verniciatura',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })
    const mezzo = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelName: 'Cofano',
        repairExtent: 'mezzo',
        description: 'Verniciatura',
        standardWorkName: 'Verniciatura',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    expect(intero.estimates?.[0].lines[0].unitPrice).toBe(250)
    expect(mezzo.estimates?.[0].lines[0].unitPrice).toBe(140)
  })

  it('quando la variante listino e vuota usa comunque il prezzo generico', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [{
      id: 'pl-var-generic',
      panelName: 'Cofano',
      workName: 'Verniciatura',
      repairExtent: 'intero',
      variantCycle: '',
      unitPrice: 175,
      active: true,
    }]

    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelName: 'Cofano',
        repairExtent: 'intero',
        paintCycle: '',
        description: 'Verniciatura',
        standardWorkName: 'Verniciatura',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    expect(data.estimates?.[0].lines[0].unitPrice).toBe(175)
  })

  it('quando esistono voce variante specifica e voce generica usa la specifica', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [
      {
        id: 'pl-generic',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: 'intero',
        variantCycle: '',
        unitPrice: 180,
        active: true,
      },
      {
        id: 'pl-specific',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: 'intero',
        variantCycle: 'doppiostrato',
        unitPrice: 250,
        active: true,
      },
    ]

    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelName: 'Cofano',
        repairExtent: 'intero',
        paintCycle: 'doppiostrato',
        description: 'Verniciatura',
        standardWorkName: 'Verniciatura',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    expect(data.estimates?.[0].lines[0].unitPrice).toBe(250)
  })

  it('se il prezzo non e configurato mantiene prezzo applicato a zero senza inventare match', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = []
    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelName: 'Cofano',
        repairExtent: 'intero',
        paintCycle: 'doppiostrato',
        description: 'Verniciatura',
        standardWorkName: 'Verniciatura',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })
    expect(data.estimates?.[0].lines[0].unitPrice).toBe(0)
  })

  it('cofano+verniciatura+doppiostrato propaga prezzo 250 nei totali preventivo', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [{
      id: 'pl-totals',
      panelName: 'Cofano',
      workName: 'Verniciatura',
      repairExtent: 'intero',
      variantCycle: 'doppiostrato',
      unitPrice: 250,
      vatRate: 22,
      active: true,
    }]

    const created = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelId: 'cofano',
        panelName: 'Cofano',
        repairExtent: 'intero',
        paintCycle: 'doppiostrato',
        description: 'Verniciatura',
        standardWorkName: 'Verniciatura',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    const estimate = created.estimates?.[0]
    const line = estimate?.lines[0]
    if (!estimate || !line) throw new Error('Preventivo non creato')

    const expectedPrice = source.plannerSettings.standardWorkPriceList[0].unitPrice
    const expectedVat = Math.round((expectedPrice * 0.22 + Number.EPSILON) * 100) / 100
    const expectedTotal = Math.round((expectedPrice + expectedVat + Number.EPSILON) * 100) / 100

    expect(line.unitPrice).toBe(expectedPrice)
    expect(estimate.taxableAmount).toBe(expectedPrice)
    expect(estimate.vatAmount).toBe(expectedVat)
    expect(estimate.total).toBe(expectedTotal)
  })

  it('non modifica il listino generale quando il preventivo usa un override manuale sul prezzo applicato', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [{
      id: 'pl-override',
      panelName: 'Parafango anteriore',
      workName: 'Preparazione',
      repairExtent: 'intero',
      variantCycle: '',
      unitPrice: 180,
      active: true,
    }]

    const data = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelName: 'Parafango anteriore',
        repairExtent: 'intero',
        description: 'Preparazione',
        standardWorkName: 'Preparazione',
        category: 'carrozzeria',
        quantity: 1,
        unitPrice: 180,
        discount: 0,
        vatRate: 22,
      }],
    })

    const estimate = data.estimates?.[0]
    const line = estimate?.lines[0]
    if (!line) throw new Error('At least one estimate line is required.')

    line.unitPrice = 210
    expect(source.plannerSettings.standardWorkPriceList[0].unitPrice).toBe(180)
    expect(line.unitPrice).toBe(210)
  })

  it('trasferisce note pannello e estensione da preventivo a commessa', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        panelId: 'porta-ant-sx',
        panelName: 'Porta anteriore SX',
        panelSide: 'sx',
        repairExtent: 'mezzo',
        panelWorkNote: 'Controllare bordo inferiore',
        description: 'Lattoneria',
        standardWorkName: 'Lattoneria',
        category: 'carrozzeria',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        vatRate: 22,
      }],
    })

    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const line = converted.jobs?.[0].lines[0]
    expect(line?.panelId).toBe('porta-ant-sx')
    expect(line?.panelSide).toBe('sx')
    expect(line?.repairExtent).toBe('mezzo')
    expect(line?.panelWorkNote).toBe('Controllare bordo inferiore')
  })

  it('approva preventivo e converte in commessa con collegamento bidirezionale', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: 'Trasferire tutto',
      lines: [{ description: 'Lattoneria', category: 'carrozzeria', quantity: 1, unitPrice: 300, discount: 0, vatRate: 22 }],
    })

    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const estimate = converted.estimates?.[0]
    const job = converted.jobs?.[0]

    expect(estimate?.status).toBe('Approvato')
    expect(estimate?.convertedJobId).toBe(job?.id)
    expect(job?.estimateId).toBe(estimate?.id)
    expect(job?.lines[0].description).toContain('Lattoneria')
  })

  it('trasferisce i tempi preventivati del preventivo nelle fasi della commessa', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{
        description: 'Smontaggio',
        standardWorkName: 'Smontaggio',
        estimatedMinutes: 95,
        category: 'carrozzeria',
        quantity: 1,
        unitPrice: 200,
        discount: 0,
        vatRate: 22,
      }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const smontaggio = converted.jobs?.[0].phases.find((phase) => phase.name === 'Smontaggio')
    expect(smontaggio?.estimatedMinutes).toBe(95)
  })

  it('impedisce la doppia conversione dallo stesso preventivo', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Ricambio', category: 'ricambi', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    expect(() => approveEstimateAndCreateJob(converted, converted.estimates?.[0].id ?? '')).toThrow('Esiste già una commessa')
  })

  it('crea commessa diretta senza preventivo', () => {
    const data = createDirectJob(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      entryDate: '2026-08-09',
      expectedDeliveryDate: '2026-08-20',
      priority: 'Alta',
      responsible: 'Capo reparto',
      notes: 'Diretta',
      lines: [{ description: 'Meccanica leggera', category: 'meccanica', quantity: 1, unitPrice: 200, discount: 0, vatRate: 22 }],
    })
    expect(data.jobs?.[0].estimateId).toBeNull()
    expect(data.jobs?.[0].number.startsWith('COMM-')).toBe(true)
  })

  it('applica transizioni di stato valide e blocca quelle non valide', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Test', category: 'altre', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 }],
    })
    const approved = updateEstimateStatus(withEstimate, withEstimate.estimates?.[0].id ?? '', 'Inviato')
    const inWaiting = updateEstimateStatus(approved, approved.estimates?.[0].id ?? '', 'In attesa conferma')
    const converted = approveEstimateAndCreateJob(inWaiting, inWaiting.estimates?.[0].id ?? '')

    const planned = updateJobStatus(converted, converted.jobs?.[0].id ?? '', 'Pianificata')
    const inWork = updateJobStatus(planned, planned.jobs?.[0].id ?? '', 'In lavorazione')
    expect(inWork.jobs?.[0].status).toBe('In lavorazione')
    expect(() => updateJobStatus(inWork, inWork.jobs?.[0].id ?? '', 'Da pianificare')).toThrow('Transizione non consentita')
  })

  it('aggiorna fasi operative e avanzamento', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Fase', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const job = converted.jobs?.[0]
    const phaseId = job?.phases[0].id ?? ''
    const started = updateJobPhase(converted, job?.id ?? '', phaseId, { status: 'In lavorazione', activeOperators: ['Operatore 1'] })
    const completed = updateJobPhase(started, job?.id ?? '', phaseId, { status: 'Completata', activeOperators: ['Operatore 1'] })

    expect(completed.jobs?.[0].phases[0].status).toBe('Completata')
    expect(completed.jobs?.[0].progressPercent).toBeGreaterThan(0)
    expect(completed.jobs?.[0].phases[0].startedAt).toBeTruthy()
    expect(completed.jobs?.[0].phases[0].endedAt).toBeTruthy()
  })

  it('blocca il completamento del controllo qualità se le fasi precedenti non sono chiuse o non necessarie', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'QC', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const job = converted.jobs?.[0]
    const quality = job?.phases.find((phase) => phase.name === 'Controllo qualità')
    expect(() => updateJobPhase(converted, job?.id ?? '', quality?.id ?? '', { status: 'Completata' }))
      .toThrow('Completa le fasi precedenti')
  })

  it('integra planner tramite dati reali della commessa', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Planner', category: 'carrozzeria', quantity: 1, unitPrice: 120, discount: 0, vatRate: 22 }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const updated = updateJobMeta(converted, converted.jobs?.[0].id ?? '', {
      expectedDeliveryDate: '2026-08-12',
      priority: 'Urgente',
      responsible: 'Planner',
      notes: '',
    })

    const vehicle = updated.vehicles[0]
    expect(vehicle.requestedDeliveryDate).toBe('2026-08-12')
    expect(vehicle.priority).toBe('Urgente')

    const planner = calculatePlanner(updated.vehicles, updated.plannerSettings, '2026-08-09')
    expect(planner.vehicles.some((entry) => entry.vehicleId === vehicle.id)).toBe(true)
  })

  it('trasferisce tempi preventivo verso commessa e planner intelligente', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [
        { panelName: 'Parafango ant. DX', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Porta ant. DX', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
        { panelName: 'Paraurti post.', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 50, discount: 0, vatRate: 22 },
      ],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const job = converted.jobs?.[0]
    const preparazione = job?.phases.find((phase) => phase.name === 'Preparazione')
    expect(preparazione?.estimatedMinutes).toBe(180)
    const vehicle = converted.vehicles.find((item) => item.id === 'v1')
    expect((vehicle?.estimatedHours ?? 0) >= 3).toBe(true)
    const planner = calculatePlanner(converted.vehicles, converted.plannerSettings, '2026-08-09')
    expect(planner.vehicles.some((entry) => entry.vehicleId === 'v1')).toBe(true)
  })

  it('consegna commessa, registra data e libera il cono del veicolo', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Consegna', category: 'carrozzeria', quantity: 1, unitPrice: 120, discount: 0, vatRate: 22 }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const planned = updateJobStatus(converted, converted.jobs?.[0].id ?? '', 'Pianificata')
    const inWork = updateJobStatus(planned, planned.jobs?.[0].id ?? '', 'In lavorazione')
    const quality = {
      ...inWork,
      jobs: inWork.jobs?.map((job) => ({
        ...job,
        qualityChecklist: job.qualityChecklist.map((item) => ({ ...item, checked: true })),
      })),
    }
    const ready = updateJobStatus(quality, quality.jobs?.[0].id ?? '', 'Pronta consegna')
    const delivered = updateJobStatus(ready, ready.jobs?.[0].id ?? '', 'Consegnata')

    expect(delivered.jobs?.[0].deliveredAt).toBeTruthy()
    expect(delivered.vehicles[0].coneNumber).toBeNull()
  })

  it('assegna automaticamente un cono quando la commessa diventa In lavorazione', () => {
    const data = makeData()
    data.vehicles = [{ ...data.vehicles[0], coneNumber: null, status: 'Accettata' }]
    const withEstimate = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Start', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const planned = updateJobStatus(converted, converted.jobs?.[0].id ?? '', 'Pianificata')
    const inWork = updateJobStatus(planned, planned.jobs?.[0].id ?? '', 'In lavorazione')

    expect(inWork.vehicles[0].coneNumber).toBe(1)
    expect(inWork.jobs?.[0].coneNumber).toBe(1)
  })

  it('mantiene commessa in attesa cono e la sblocca appena un cono si libera', () => {
    const data = makeData()
    const occupiedVehicles: Vehicle[] = Array.from({ length: TOTAL_CONES }, (_, index) => ({
        ...baseVehicle('c1'),
        id: `occupied-${index}`,
        plate: `ZZ${String(index).padStart(3, '0')}ZZ`,
        coneNumber: index + 1,
        status: 'in lavorazione' as const,
        createdAt: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      }))
    data.vehicles = [
      ...occupiedVehicles,
      { ...baseVehicle('c1'), id: 'v1', plate: 'AB123CD', coneNumber: null, status: 'Accettata' as const, createdAt: '2026-08-30T00:00:00.000Z' },
    ]

    const withEstimate = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Queue', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const planned = updateJobStatus(converted, converted.jobs?.[0].id ?? '', 'Pianificata')
    const inWork = updateJobStatus(planned, planned.jobs?.[0].id ?? '', 'In lavorazione')
    expect(inWork.vehicles.find((vehicle) => vehicle.id === 'v1')?.coneNumber).toBeNull()

    const freed = changeVehicleStatus(inWork, 'occupied-0', 'Consegnata')
    expect(freed.vehicles.find((vehicle) => vehicle.id === 'v1')?.coneNumber).toBe(1)
  })

  it('mantiene il valore commessa separato dal cash flow per evitare doppio conteggio', () => {
    const withJob = createDirectJob(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      entryDate: '2026-08-09',
      expectedDeliveryDate: '2026-08-20',
      priority: 'Normale',
      responsible: '',
      notes: '',
      lines: [{ description: 'Nessun incasso automatico', category: 'altre', quantity: 1, unitPrice: 500, discount: 0, vatRate: 22 }],
    })

    const baseline = calculateCashFlowSnapshot(makeData(), '2026-08-09')
    const withJobCash = calculateCashFlowSnapshot(withJob, '2026-08-09')
    expect(withJobCash.windows[0].inflow).toBe(baseline.windows[0].inflow)
    expect(withJobCash.windows[0].outflow).toBe(baseline.windows[0].outflow)
  })

  it('stato manuale senza alterare le lavorazioni', () => {
    const withJob = createDirectJob(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      entryDate: '2026-08-09',
      expectedDeliveryDate: '2026-08-20',
      priority: 'Normale',
      responsible: '',
      notes: '',
      lines: [{ description: 'Lavorazione', category: 'carrozzeria', quantity: 1, unitPrice: 500, discount: 0, vatRate: 22 }],
    })

    const beforeJob = structuredClone(withJob.jobs?.[0])
    const updated = changeVehicleStatus(withJob, 'v1', 'pronta', {
      source: 'manual',
      note: 'Cambio stato da operatore',
    })
    const afterJob = updated.jobs?.[0]

    expect(afterJob?.phases).toEqual(beforeJob?.phases)
    expect(afterJob?.status).toBe(beforeJob?.status)
    expect(afterJob?.progressPercent).toBe(beforeJob?.progressPercent)
  })

  it('sincronizza approvazione preventivo, stato operativo, planner e oggi in carrozzeria', () => {
    const data = makeData()
    data.customers[0].name = 'Nicolas Elia'
    data.vehicles[0].plate = 'AB548CG'

    const withEstimate = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB548CG',
      companyName: '',
      contactName: 'Filippo',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Riparazione completa', category: 'carrozzeria', quantity: 1, unitPrice: 900, discount: 0, vatRate: 22 }],
    })

    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const commessa = converted.jobs?.find((job) => job.number === 'COMM-00001')
    expect(commessa?.plate).toBe('AB548CG')

    const smontaggio = commessa?.phases.find((phase) => phase.name === 'Smontaggio')
    const started = updateJobPhase(converted, commessa?.id ?? '', smontaggio?.id ?? '', { status: 'In lavorazione', activeOperators: ['Filippo'] })
    const completed = updateJobPhase(started, commessa?.id ?? '', smontaggio?.id ?? '', { status: 'Completata', activeOperators: ['Filippo'] })

    const updatedJob = completed.jobs?.find((job) => job.id === commessa?.id)
    const snapshot = updatedJob ? workflowOperationalSnapshot(updatedJob) : null

    expect(updatedJob?.progressPercent).toBe(13)
    expect(snapshot?.lastCompletedPhase).toBe('Smontaggio')
    expect(snapshot?.nextPhase).toBe('Lattoneria')
    expect(snapshot?.lastOperator).toBe('Filippo')
    expect(snapshot?.activeOperators).toEqual([])

    const planner = calculatePlanner(completed.vehicles, completed.plannerSettings, '2026-08-09')
    expect(planner.vehicles.some((entry) => entry.vehicleId === 'v1')).toBe(true)

    const today = buildTodayInShopSnapshot(completed)
    expect(today.phaseCards.some((card) => card.phase === 'Lattoneria' && card.jobs.some((job) => job.vehicleId === 'v1'))).toBe(true)
    expect(completed.production?.jobs.some((job) => job.vehicleId === 'v1' && job.phase === 'Lattoneria')).toBe(true)
    expect(completed.vehicles.filter((vehicle) => vehicle.id === 'v1')).toHaveLength(1)
  })

  it('mantiene la sincronizzazione operativa dopo salvataggio e ricarica', async () => {
    const data = makeData()
    data.customers[0].name = 'Nicolas Elia'
    data.vehicles[0].plate = 'AB548CG'

    const withEstimate = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB548CG',
      companyName: '',
      contactName: 'Filippo',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Riparazione completa', category: 'carrozzeria', quantity: 1, unitPrice: 900, discount: 0, vatRate: 22 }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const job = converted.jobs?.find((entry) => entry.number === 'COMM-00001')
    const phase = job?.phases.find((entry) => entry.name === 'Smontaggio')
    const started = updateJobPhase(converted, job?.id ?? '', phase?.id ?? '', { status: 'In lavorazione', activeOperators: ['Filippo'] })
    const completed = updateJobPhase(started, job?.id ?? '', phase?.id ?? '', { status: 'Completata', activeOperators: ['Filippo'] })

    await saveDatabase(completed)
    const reloaded = await loadDatabase()
    const reloadedJob = reloaded.jobs?.find((entry) => entry.number === 'COMM-00001')
    const reloadedSnapshot = reloadedJob ? workflowOperationalSnapshot(reloadedJob) : null

    expect(reloadedJob?.progressPercent).toBe(13)
    expect(reloadedSnapshot?.lastCompletedPhase).toBe('Smontaggio')
    expect(reloadedSnapshot?.nextPhase).toBe('Lattoneria')
    expect(reloadedSnapshot?.lastOperator).toBe('Filippo')
    expect(reloaded.production?.jobs.some((entry) => entry.vehicleId === 'v1' && entry.phase === 'Lattoneria')).toBe(true)
  })

  it('nuova vettura dal preventivo -> presente in Veicoli', async () => {
    const data = makeData()
    const confirmed = await confirmEstimateAndCreateJobTransactional(data, {
      customerId: 'c1',
      plate: 'ZZ123YY',
      companyName: '',
      contactName: 'Cliente Test',
      date: '2026-08-14',
      priority: 'Normale',
      requestedDeliveryDate: '2026-08-20',
      notes: 'Nuova vettura da preventivo',
      lines: [{ description: 'Riparazione', category: 'carrozzeria', quantity: 1, unitPrice: 500, discount: 0, vatRate: 22 }],
    }, {
      save: saveDatabase,
      load: loadDatabase,
    })
    expect(confirmed.vehicles.some((vehicle) => vehicle.plate === 'ZZ123YY')).toBe(true)
  })

  it('reload pagina -> vettura ancora presente', async () => {
    const data = makeData()
    const confirmed = await confirmEstimateAndCreateJobTransactional(data, {
      customerId: 'c1',
      plate: 'QQ123WW',
      companyName: '',
      contactName: 'Cliente Test',
      date: '2026-08-14',
      priority: 'Normale',
      requestedDeliveryDate: '2026-08-20',
      notes: '',
      lines: [{ description: 'Riparazione', category: 'carrozzeria', quantity: 1, unitPrice: 450, discount: 0, vatRate: 22 }],
    }, {
      save: saveDatabase,
      load: loadDatabase,
    })
    await saveDatabase(confirmed)
    const reloaded = await loadDatabase()
    expect(reloaded.vehicles.some((vehicle) => vehicle.plate === 'QQ123WW')).toBe(true)
  })

  it('conferma preventivo -> vettura ancora presente', async () => {
    const data = makeData()
    const confirmed = await confirmEstimateAndCreateJobTransactional(data, {
      customerId: 'c1',
      plate: 'PP123RR',
      companyName: '',
      contactName: 'Cliente Test',
      date: '2026-08-14',
      priority: 'Alta',
      requestedDeliveryDate: '2026-08-19',
      notes: '',
      lines: [{ description: 'Riparazione', category: 'carrozzeria', quantity: 1, unitPrice: 650, discount: 0, vatRate: 22 }],
    }, {
      save: saveDatabase,
      load: loadDatabase,
    })
    const createdJob = confirmed.jobs?.find((job) => job.plate === 'PP123RR')
    expect(createdJob).toBeDefined()
    expect(confirmed.vehicles.some((vehicle) => vehicle.plate === 'PP123RR')).toBe(true)
  })

  it('creazione commessa -> vehicleId valido', async () => {
    const data = makeData()
    const confirmed = await confirmEstimateAndCreateJobTransactional(data, {
      customerId: 'c1',
      plate: 'MM123NN',
      companyName: '',
      contactName: 'Cliente Test',
      date: '2026-08-14',
      priority: 'Normale',
      requestedDeliveryDate: '2026-08-22',
      notes: '',
      lines: [{ description: 'Riparazione', category: 'carrozzeria', quantity: 1, unitPrice: 550, discount: 0, vatRate: 22 }],
    }, {
      save: saveDatabase,
      load: loadDatabase,
    })
    const createdJob = confirmed.jobs?.find((job) => job.plate === 'MM123NN')
    expect(createdJob?.vehicleId).toBeTruthy()
    expect(Boolean(createdJob?.vehicleId && confirmed.vehicles.some((vehicle) => vehicle.id === createdJob.vehicleId))).toBe(true)
  })

  it('ricalcolo Planner -> vettura ancora presente', async () => {
    const data = makeData()
    const confirmed = await confirmEstimateAndCreateJobTransactional(data, {
      customerId: 'c1',
      plate: 'LL123KK',
      companyName: '',
      contactName: 'Cliente Test',
      date: '2026-08-14',
      priority: 'Urgente',
      requestedDeliveryDate: '2026-08-18',
      notes: '',
      lines: [{ description: 'Riparazione', category: 'carrozzeria', quantity: 1, unitPrice: 700, discount: 0, vatRate: 22 }],
    }, {
      save: saveDatabase,
      load: loadDatabase,
    })
    const beforeCount = confirmed.vehicles.length
    const replanned = recalculateOperatorPrograms(confirmed, '2026-08-14', 'Integrita vehicles')
    expect(replanned.vehicles.length).toBe(beforeCount)
    expect(replanned.vehicles.some((vehicle) => vehicle.plate === 'LL123KK')).toBe(true)
  })

  it('errore salvataggio vettura -> nessuna commessa orfana', async () => {
    const data = makeData()
    const beforeJobs = data.jobs?.length ?? 0
    await expect(confirmEstimateAndCreateJobTransactional(data, {
      customerId: 'c1',
      plate: 'EE123FF',
      companyName: '',
      contactName: 'Cliente Test',
      date: '2026-08-14',
      priority: 'Normale',
      requestedDeliveryDate: '2026-08-20',
      notes: '',
      lines: [{ description: 'Riparazione', category: 'carrozzeria', quantity: 1, unitPrice: 500, discount: 0, vatRate: 22 }],
    }, {
      save: async () => { throw new Error('Storage pieno') },
      load: loadDatabase,
    })).rejects.toThrow('Impossibile salvare la vettura. Riprova.')
    expect(data.jobs?.length ?? 0).toBe(beforeJobs)
    expect((data.jobs ?? []).some((job) => job.plate === 'EE123FF')).toBe(false)
  })

  it('mantiene dettaglio pannello e tempi dopo refresh', async () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [
        { panelName: 'Parafango ant. DX', description: 'Lattoneria', standardWorkName: 'Lattoneria', estimatedMinutes: 75, category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 },
      ],
    })
    await saveDatabase(withEstimate)
    const reloaded = await loadDatabase()
    const line = reloaded.estimates?.[0].lines?.[0]
    expect(line?.panelName).toBe('Parafango ant. DX')
    expect(line?.standardWorkName).toBe('Lattoneria')
    expect(line?.estimatedMinutes).toBe(75)
    expect(line?.manualTimeOverride).toBe(true)
    expect(line?.calculationType).toBe('per-panel')
  })

  it('mantiene dopo refresh un pannello con piu lavorazioni selezionate', async () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [
        { panelName: 'Porta anteriore SX', description: 'Smontaggio', standardWorkName: 'Smontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 },
        { panelName: 'Porta anteriore SX', description: 'Lattoneria', standardWorkName: 'Lattoneria', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 },
        { panelName: 'Porta anteriore SX', description: 'Preparazione', standardWorkName: 'Preparazione', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 },
      ],
    })
    await saveDatabase(withEstimate)
    const reloaded = await loadDatabase()
    const panelLines = (reloaded.estimates?.[0].lines ?? []).filter((line) => line.panelName === 'Porta anteriore SX')
    expect(panelLines).toHaveLength(3)
    expect(panelLines.map((line) => line.standardWorkName)).toEqual(['Smontaggio', 'Lattoneria', 'Preparazione'])
  })

  it('gestisce operatori multipli sulla stessa fase con ingressi e uscite differenti', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Smontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const job = converted.jobs?.[0]
    const phase = job?.phases.find((entry) => entry.name === 'Smontaggio')

    const started = updateJobPhase(converted, job?.id ?? '', phase?.id ?? '', {
      status: 'In lavorazione',
      activeOperators: ['Filippo'],
      at: '2026-08-09T08:00:00.000Z',
    })
    const joined = updateJobPhaseOperators(started, job?.id ?? '', phase?.id ?? '', ['Filippo', 'Giorgio'], '2026-08-09T08:30:00.000Z')
    const leftEarly = updateJobPhaseOperators(joined, job?.id ?? '', phase?.id ?? '', ['Filippo'], '2026-08-09T09:30:00.000Z')
    const completed = updateJobPhase(leftEarly, job?.id ?? '', phase?.id ?? '', {
      status: 'Completata',
      activeOperators: ['Filippo'],
      at: '2026-08-09T10:00:00.000Z',
    })

    const updated = completed.jobs?.find((entry) => entry.id === job?.id)?.phases.find((entry) => entry.id === phase?.id)
    expect(updated?.actualMinutes).toBe(120)
    expect(updated?.operatorAssignments).toHaveLength(2)

    const filippo = updated?.operatorAssignments.find((entry) => entry.operatorName === 'Filippo')
    const giorgio = updated?.operatorAssignments.find((entry) => entry.operatorName === 'Giorgio')
    expect(filippo?.startedAt).toBe('2026-08-09T08:00:00.000Z')
    expect(filippo?.endedAt).toBe('2026-08-09T10:00:00.000Z')
    expect(filippo?.workedMinutes).toBe(120)
    expect(giorgio?.startedAt).toBe('2026-08-09T08:30:00.000Z')
    expect(giorgio?.endedAt).toBe('2026-08-09T09:30:00.000Z')
    expect(giorgio?.workedMinutes).toBe(60)

    const manMinutes = (updated?.operatorAssignments ?? []).reduce((sum, entry) => sum + entry.workedMinutes, 0)
    expect(manMinutes).toBe(180)
  })

  it('aggiorna il tempo fase con storico variazioni e supporta confronto previsto/consuntivo', () => {
    const withEstimate = createEstimate(makeData(), {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ description: 'Smontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 }],
    })
    const converted = approveEstimateAndCreateJob(withEstimate, withEstimate.estimates?.[0].id ?? '')
    const job = converted.jobs?.[0]
    const phase = job?.phases.find((entry) => entry.name === 'Smontaggio')
    const updated = updateJobPhaseEstimatedMinutes(converted, job?.id ?? '', phase?.id ?? '', 120, 'Nuovo danno nascosto')
    const adjusted = updated.jobs?.[0].phases.find((entry) => entry.id === phase?.id)

    expect(adjusted?.estimatedMinutes).toBe(120)
    expect(adjusted?.timeAdjustments?.[0].fromMinutes).toBe(60)
    expect(adjusted?.timeAdjustments?.[0].toMinutes).toBe(120)
    expect(adjusted?.timeAdjustments?.[0].reason).toBe('Nuovo danno nascosto')

    const comparison = workTypeTimeComparison(updated)
    const smontaggio = comparison.find((item) => item.workType === 'Smontaggio')
    expect(smontaggio?.plannedMinutes).toBeGreaterThan(0)
    expect(smontaggio?.samples).toBeGreaterThan(0)
  })

  it('applica prezzo listino alle nuove righe quando il prezzo non e impostato', () => {
    const data = makeData()
    data.plannerSettings.standardWorkPriceList = [{
      id: 'pl-1',
      panelName: 'Porta anteriore SX',
      workName: 'Smontaggio',
      variantCycle: '',
      unitPrice: 175,
      active: true,
    }]

    const withEstimate = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ panelName: 'Porta anteriore SX', description: 'Smontaggio', standardWorkName: 'Smontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 0, discount: 0, vatRate: 22 }],
    })

    expect(withEstimate.estimates?.[0].lines[0].unitPrice).toBe(175)
  })

  it('mantiene il prezzo snapshot delle righe esistenti anche dopo cambio listino', () => {
    const source = makeData()
    source.plannerSettings.standardWorkPriceList = [{
      id: 'pl-2',
      panelName: 'Porta anteriore SX',
      workName: 'Smontaggio',
      variantCycle: '',
      unitPrice: 100,
      active: true,
    }]
    const first = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      notes: '',
      lines: [{ panelName: 'Porta anteriore SX', description: 'Smontaggio', standardWorkName: 'Smontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 0, discount: 0, vatRate: 22 }],
    })
    expect(first.estimates?.[0].lines[0].unitPrice).toBe(100)

    first.plannerSettings.standardWorkPriceList = [{
      id: 'pl-2',
      panelName: 'Porta anteriore SX',
      workName: 'Smontaggio',
      variantCycle: '',
      unitPrice: 190,
      active: true,
    }]

    const second = createEstimate(first, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-10',
      notes: '',
      lines: [{ panelName: 'Porta anteriore SX', description: 'Smontaggio', standardWorkName: 'Smontaggio', category: 'carrozzeria', quantity: 1, unitPrice: 0, discount: 0, vatRate: 22 }],
    })

    const newest = (second.estimates ?? []).find((estimate) => estimate.date === '2026-08-10')

    expect(first.estimates?.[0].lines[0].unitPrice).toBe(100)
    expect(newest?.lines[0].unitPrice).toBe(190)
  })

  it('usa workId del listino per mantenere il prezzo anche se il nome lavorazione cambia', () => {
    const data = makeData()
    data.plannerSettings.standardWorkPriceList = [{
      id: 'pl-workid-1',
      workId: 'std-preparazione',
      panelName: 'Porta anteriore SX',
      workName: 'Preparazione (storico)',
      variantCycle: '',
      unitPrice: 245,
      active: true,
    }]

    const created = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-10',
      notes: '',
      lines: [{
        panelName: 'Porta anteriore SX',
        description: 'Preparazione nuova',
        standardWorkId: 'std-preparazione',
        standardWorkName: 'Preparazione nuova',
        category: 'carrozzeria',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        vatRate: 22,
      }],
    })

    expect(created.estimates?.[0].lines[0].unitPrice).toBe(245)
  })

  it('applica il tempo preset per pannello+lavorazione+variante prima delle regole standard', () => {
    const data = makeData()
    data.plannerSettings.standardWorkTimePresets = [{
      id: 'tp-1',
      workId: '',
      workName: 'Verniciatura standard',
      panelName: 'Cofano',
      variantCycle: 'doppiostrato',
      minutes: 95,
      active: true,
      note: '',
    }]

    const created = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-11',
      notes: '',
      lines: [{
        panelName: 'Cofano',
        paintCycle: 'doppiostrato',
        description: 'Verniciatura standard',
        standardWorkName: 'Verniciatura standard',
        category: 'verniciatura',
        quantity: 1,
        unitPrice: 200,
        discount: 0,
        vatRate: 22,
      }],
    })

    expect(created.estimates?.[0].lines[0].standardMinutes).toBe(95)
    expect(created.estimates?.[0].lines[0].estimatedMinutes).toBe(95)
  })

  it('calcola costo orario automatico da costi mensili / ore produttive effettive', () => {
    const data = makeData()
    data.plannerSettings.internalCostSettings = {
      ...data.plannerSettings.internalCostSettings,
      minimumMarginPercent: 20,
      monthlyCostItems: [
        { id: 'a', category: 'personale', description: 'Personale', monthlyAmount: 6000, active: true },
        { id: 'b', category: 'affitto', description: 'Affitto', monthlyAmount: 2000, active: true },
      ],
      productiveCapacity: {
        productiveOperators: 5,
        hoursPerOperatorPerDay: 8,
        workingDaysPerMonth: 20,
        efficiencyPercent: 80,
      },
      useManualHourlyRate: false,
      manualHourlyRate: null,
      futureHourlyRateBySkill: {},
      internalHourlyRate: 0,
    }

    const rate = resolveInternalHourlyRate(data.plannerSettings)
    expect(rate.consideredMonthlyCosts).toBe(8000)
    expect(rate.theoreticalHours).toBe(800)
    expect(rate.productiveHours).toBe(640)
    expect(rate.automaticHourlyRate).toBe(12.5)
  })

  it('gestisce efficienza 100% e 80% nel calcolo ore produttive', () => {
    const data = makeData()
    data.plannerSettings.internalCostSettings = {
      ...data.plannerSettings.internalCostSettings,
      monthlyCostItems: [{ id: 'a', category: 'personale', description: 'Personale', monthlyAmount: 1000, active: true }],
      productiveCapacity: { productiveOperators: 2, hoursPerOperatorPerDay: 8, workingDaysPerMonth: 20, efficiencyPercent: 100 },
      useManualHourlyRate: false,
      manualHourlyRate: null,
      futureHourlyRateBySkill: {},
      internalHourlyRate: 0,
      minimumMarginPercent: 20,
    }
    const at100 = resolveInternalHourlyRate(data.plannerSettings)
    expect(at100.theoreticalHours).toBe(320)
    expect(at100.productiveHours).toBe(320)

    data.plannerSettings.internalCostSettings = {
      ...data.plannerSettings.internalCostSettings,
      productiveCapacity: {
        ...(data.plannerSettings.internalCostSettings.productiveCapacity ?? { productiveOperators: 0, hoursPerOperatorPerDay: 0, workingDaysPerMonth: 0, efficiencyPercent: 0 }),
        efficiencyPercent: 80,
      },
    }
    const at80 = resolveInternalHourlyRate(data.plannerSettings)
    expect(at80.productiveHours).toBe(256)
  })

  it('gestisce zero ore e zero costi senza divisioni errate', () => {
    const data = makeData()
    data.plannerSettings.internalCostSettings = {
      ...data.plannerSettings.internalCostSettings,
      monthlyCostItems: [{ id: 'a', category: 'personale', description: 'Personale', monthlyAmount: 0, active: true }],
      productiveCapacity: { productiveOperators: 0, hoursPerOperatorPerDay: 8, workingDaysPerMonth: 20, efficiencyPercent: 80 },
      useManualHourlyRate: false,
      manualHourlyRate: null,
      futureHourlyRateBySkill: {},
      internalHourlyRate: 0,
      minimumMarginPercent: 20,
    }
    const rate = resolveInternalHourlyRate(data.plannerSettings)
    expect(rate.consideredMonthlyCosts).toBe(0)
    expect(rate.productiveHours).toBe(0)
    expect(rate.automaticHourlyRate).toBe(0)
    expect(rate.effectiveHourlyRate).toBe(0)
  })

  it('usa override tariffa manuale quando attivo', () => {
    const data = makeData()
    data.plannerSettings.internalCostSettings = {
      ...data.plannerSettings.internalCostSettings,
      monthlyCostItems: [{ id: 'a', category: 'personale', description: 'Personale', monthlyAmount: 8000, active: true }],
      productiveCapacity: { productiveOperators: 5, hoursPerOperatorPerDay: 8, workingDaysPerMonth: 20, efficiencyPercent: 80 },
      useManualHourlyRate: true,
      manualHourlyRate: 70,
      futureHourlyRateBySkill: {},
      internalHourlyRate: 0,
      minimumMarginPercent: 20,
    }

    const rate = resolveInternalHourlyRate(data.plannerSettings)
    expect(rate.automaticHourlyRate).toBe(12.5)
    expect(rate.effectiveHourlyRate).toBe(70)
  })

  it('calcola costo interno, margine e prezzo minimo suggerito sulla riga', () => {
    const data = makeData()
    data.plannerSettings.internalCostSettings = {
      internalHourlyRate: 60,
      minimumMarginPercent: 20,
      futureHourlyRateBySkill: {},
    }

    const created = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-11',
      notes: '',
      lines: [{
        description: 'Smontaggio',
        standardWorkName: 'Smontaggio',
        estimatedMinutes: 120,
        category: 'carrozzeria',
        quantity: 1,
        unitPrice: 180,
        discount: 0,
        vatRate: 22,
      }],
    })

    const line = created.estimates?.[0].lines[0]
    expect(line?.internalCostAmount).toBe(120)
    expect(line?.theoreticalMarginAmount).toBe(60)
    expect(line?.theoreticalMarginPercent).toBe(33.33)
    expect(line?.minimumSuggestedPrice).toBe(150)
    expect(line?.marginStatus).toBe('ok')
  })

  it('classifica low, loss e zero-price secondo soglia e prezzo applicato', () => {
    const data = makeData()
    data.plannerSettings.internalCostSettings = {
      internalHourlyRate: 60,
      minimumMarginPercent: 25,
      futureHourlyRateBySkill: {},
    }

    const created = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-11',
      notes: '',
      lines: [
        { description: 'Low margin', estimatedMinutes: 120, category: 'carrozzeria', quantity: 1, unitPrice: 150, discount: 0, vatRate: 22 },
        { description: 'Loss', estimatedMinutes: 120, category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 },
        { description: 'Zero price', estimatedMinutes: 120, category: 'carrozzeria', quantity: 1, unitPrice: 0, discount: 0, vatRate: 22 },
      ],
    })

    const lines = created.estimates?.[0].lines ?? []
    expect(lines[0].marginStatus).toBe('low')
    expect(lines[1].marginStatus).toBe('loss')
    expect(lines[2].marginStatus).toBe('zero-price')
  })

  it('ricalcola snapshot margine dopo update manuale tempo/prezzo e aggrega correttamente su multi-riga', () => {
    const data = makeData()
    data.plannerSettings.internalCostSettings = {
      internalHourlyRate: 50,
      minimumMarginPercent: 20,
      futureHourlyRateBySkill: {},
    }

    const created = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-11',
      notes: '',
      lines: [
        { description: 'R1', estimatedMinutes: 60, category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 },
        { description: 'R2', estimatedMinutes: 120, category: 'carrozzeria', quantity: 1, unitPrice: 220, discount: 0, vatRate: 22 },
      ],
    })

    const estimate = created.estimates?.[0]
    if (!estimate) throw new Error('Preventivo non creato')
    const updated = updateEstimate(created, estimate.id, {
      customerId: estimate.customerId,
      vehicleId: estimate.vehicleId,
      plate: estimate.plate,
      companyName: estimate.companyName,
      contactName: estimate.contactName,
      date: estimate.date,
      notes: estimate.notes,
      lines: estimate.lines.map((line, index) => index === 0
        ? { ...line, estimatedMinutes: 180, unitPrice: 210 }
        : { ...line }),
    })

    const next = updated.estimates?.find((item) => item.id === estimate.id)
    const nextLines = next?.lines ?? []
    expect(nextLines[0].internalCostAmount).toBe(150)
    expect(nextLines[0].theoreticalMarginAmount).toBe(60)
    const totalInternalCost = nextLines.reduce((sum, line) => sum + Number(line.internalCostAmount ?? 0), 0)
    const totalMargin = nextLines.reduce((sum, line) => sum + Number(line.theoreticalMarginAmount ?? 0), 0)
    expect(totalInternalCost).toBe(250)
    expect(totalMargin).toBe(180)
  })

  it('gestisce edge case con tariffa interna zero mantenendo margine ok su prezzo positivo', () => {
    const data = makeData()
    data.plannerSettings.internalCostSettings = {
      internalHourlyRate: 0,
      minimumMarginPercent: 20,
      futureHourlyRateBySkill: {},
    }
    const created = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-11',
      notes: '',
      lines: [{ description: 'Tariffa zero', estimatedMinutes: 120, category: 'carrozzeria', quantity: 1, unitPrice: 10, discount: 0, vatRate: 22 }],
    })
    const line = created.estimates?.[0].lines[0]
    expect(line?.internalCostAmount).toBe(0)
    expect(line?.theoreticalMarginAmount).toBe(10)
    expect(line?.marginStatus).toBe('ok')
  })

  it('mantiene snapshot marginalita dopo salvataggio e ricarica', async () => {
    const data = makeData()
    data.plannerSettings.internalCostSettings = {
      internalHourlyRate: 45,
      minimumMarginPercent: 20,
      monthlyCostItems: [{ id: 'a', category: 'personale', description: 'Personale', monthlyAmount: 7200, active: true }],
      productiveCapacity: { productiveOperators: 5, hoursPerOperatorPerDay: 8, workingDaysPerMonth: 20, efficiencyPercent: 80 },
      useManualHourlyRate: false,
      manualHourlyRate: null,
      futureHourlyRateBySkill: {},
    }
    const created = createEstimate(data, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-11',
      notes: '',
      lines: [{ description: 'Snapshot', estimatedMinutes: 120, category: 'carrozzeria', quantity: 1, unitPrice: 100, discount: 0, vatRate: 22 }],
    })
    await saveDatabase(created)
    const reloaded = await loadDatabase()
    const line = reloaded.estimates?.[0]?.lines?.[0]
    expect(line?.internalHourlyRateUsed).toBe(11.25)
    expect(line?.productiveEfficiencyUsed).toBe(80)
    expect(line?.internalCostAmount).toBe(22.5)
    expect(line?.marginStatus).toBe('ok')
  })

  it('conferma preventivo e conserva la previsione produzione nel passaggio a pianificazione reale', () => {
    const source = makeData()
    const lines = [{
      description: 'Smontaggio',
      standardWorkName: 'Smontaggio',
      categoryOrPhase: 'Smontaggio',
      estimatedMinutes: 120,
      category: 'carrozzeria' as const,
      quantity: 1,
      unitPrice: 200,
      discount: 0,
      vatRate: 22,
    }]
    const previewForecast = simulateEstimateProductionForecast(source, {
      vehicleId: 'v1',
      plate: 'AB123CD',
      priority: 'Alta',
      requestedDeliveryDate: '2026-08-20',
      lines: lines as never,
      referenceDate: '2026-08-09',
    })

    const created = createEstimate(source, {
      customerId: 'c1',
      vehicleId: 'v1',
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-09',
      priority: 'Alta',
      requestedDeliveryDate: '2026-08-20',
      notes: '',
      productionForecast: previewForecast,
      lines,
    })
    const estimateId = created.estimates?.[0].id ?? ''
    const confirmed = approveEstimateAndCreateJob(created, estimateId)
    const estimate = confirmed.estimates?.find((item) => item.id === estimateId)
    const job = confirmed.jobs?.find((item) => item.estimateId === estimateId)
    const plan = calculatePlanner(confirmed.vehicles, confirmed.plannerSettings, '2026-08-09').vehicles.find((item) => item.vehicleId === 'v1')

    expect(estimate?.productionForecast?.estimatedStartAt).toBe(previewForecast.estimatedStartAt)
    expect(estimate?.dataStimataInizio).toBe(previewForecast.estimatedStartAt)
    expect(estimate?.dataStimataConsegna).toBe(previewForecast.advisedDeliveryDate)
    expect(job?.entryDate).toBe(previewForecast.firstAvailabilityDate)
    expect(job?.expectedDeliveryDate).toBe('2026-08-20')
    expect(job?.priority).toBe('Alta')
    expect(plan?.assignments[0]?.date ?? plan?.calculatedDeliveryDate).toBeTruthy()
  })
})
