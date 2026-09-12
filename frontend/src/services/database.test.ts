import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ErpData } from '../types'
import { analyzeDatabaseIntegrity, loadDatabase, prepareDuplicateResolution, resolveDuplicatePlate, saveDatabase } from './database'
import { defaultPlannerSettings, emptyData, STORAGE_KEY } from './erp'
import { EXPECTED_APP_ORIGIN } from './originGuard'

const data: ErpData = {
  customers: [{
    id: 'customer-1', type: 'Privato', name: 'Cliente reale', phone: '123',
    email: '', taxId: '', address: '', createdAt: '2026-07-26T00:00:00.000Z',
  }],
  vehicles: [],
  coneHistory: [],
  plannerSettings: { ...structuredClone(defaultPlannerSettings), monthlyRevenueGoal: 45000 },
  plannerAssignments: [],
  invoices: [],
  bankAccounts: [],
  ribaBatches: [],
  financialEvents: [],
  payables: [],
  quotes: [],
  communications: [],
  documentCounters: { quote: 0, invoice: 0 },
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
    identities: [{ role: 'production', operatorId: 'tablet-operator', operatorName: 'Operatore Produzione' }],
  },
  financeSettings: structuredClone(emptyData.financeSettings),
}

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('carrozzeria-elias-erp')
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
  })
  localStorage.removeItem(STORAGE_KEY)
  ;(globalThis as { __ERP_ORIGIN_OVERRIDE__?: string }).__ERP_ORIGIN_OVERRIDE__ = EXPECTED_APP_ORIGIN
})

describe('database persistente', () => {
  it('salva e ricarica lo stato completo da IndexedDB', async () => {
    await saveDatabase(data)
    await expect(loadDatabase()).resolves.toMatchObject({
      ...data,
      plannerSettings: {
        ...data.plannerSettings,
        vehicleStatuses: expect.any(Array),
      },
    })
    await expect(loadDatabase()).resolves.toMatchObject({
      estimates: [],
      jobs: [],
      workflowCounters: { estimate: 0, job: 0 },
      qualityChecklistTemplates: [],
    })
  })

  it('inizializza un database vuoto senza dati dimostrativi', async () => {
    await expect(loadDatabase()).resolves.toMatchObject({
      ...emptyData,
      plannerSettings: {
        ...emptyData.plannerSettings,
        vehicleStatuses: expect.any(Array),
      },
    })
  })

  it('migra i dati Sprint 1 aggiungendo impostazioni e campi Planner senza perdere anagrafiche', async () => {
    const legacy = { customers: data.customers, vehicles: [], coneHistory: [] }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('carrozzeria-elias-erp', 2)
      request.onupgradeneeded = () => request.result.createObjectStore('erp-state')
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('erp-state', 'readwrite')
        transaction.objectStore('erp-state').put(legacy, 'current')
        transaction.oncomplete = () => { database.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
      request.onerror = () => reject(request.error)
    })
    const migrated = await loadDatabase()
    expect(migrated.customers[0].name).toBe('Cliente reale')
    expect(migrated.plannerSettings.workingDays).toEqual([1, 2, 3, 4, 5])
    expect(migrated.plannerAssignments).toEqual([])
    expect(migrated.estimates).toEqual([])
    expect(migrated.jobs).toEqual([])
    expect(migrated.workflowCounters).toEqual({ estimate: 0, job: 0 })
    expect(migrated.qualityChecklistTemplates).toEqual([])
  })

  it('mantiene metadati pannello (id/lato/intero-mezzo/note) dopo refresh', async () => {
    const custom = structuredClone(data)
    custom.estimates = [{
      id: 'est-1',
      number: 'PREV-00001',
      customerId: 'customer-1',
      vehicleId: undefined,
      plate: 'AB123CD',
      companyName: '',
      contactName: '',
      date: '2026-08-12',
      notes: '',
      status: 'Bozza',
      lines: [{
        id: 'line-1',
        description: 'Lattoneria porta',
        panelId: 'porta-ant-sx',
        panelName: 'Porta anteriore SX',
        panelSide: 'sx',
        repairExtent: 'mezzo',
        panelWorkNote: 'Raddrizzare lamiera e rifinire bordo',
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
      }],
      taxableAmount: 100,
      vatAmount: 22,
      total: 122,
      convertedJobId: null,
      history: [],
      createdAt: '2026-08-12T10:00:00.000Z',
      updatedAt: '2026-08-12T10:00:00.000Z',
    }]

    await saveDatabase(custom)
    const loaded = await loadDatabase()
    const line = loaded.estimates?.[0].lines[0]
    expect(line?.panelId).toBe('porta-ant-sx')
    expect(line?.panelSide).toBe('sx')
    expect(line?.repairExtent).toBe('mezzo')
    expect(line?.panelWorkNote).toBe('Raddrizzare lamiera e rifinire bordo')
  })

  it('mantiene regole tempi configurabili e storico regole dopo refresh', async () => {
    const custom = structuredClone(data)
    custom.plannerSettings.standardWorks = [
      ...(custom.plannerSettings.standardWorks ?? []),
      {
        id: 'std-lucidatura-persist',
        name: 'Lucidatura',
        calculationType: 'per-vehicle',
        standardMinutes: 90,
        categoryOrPhase: 'Lucidatura',
        rules: [{
          id: 'rule-lucidatura-grande-nera',
          name: 'Lucidatura vettura grande nera',
          minutes: 150,
          priority: 10,
          active: true,
          conditions: { vehicleSizeClass: 'grande', colorFamily: 'nera', paintCycle: '', minPanels: null, maxPanels: null, attributes: { finitura: 'lucida' } },
        }],
        active: true,
        requiredSkill: 'lucidatura',
        cycleOrder: 70,
      },
    ]
    custom.plannerSettings.standardWorkRuleHistory = [{
      id: 'h1',
      at: '2026-08-09T00:00:00.000Z',
      workId: 'std-lucidatura-persist',
      workName: 'Lucidatura',
      ruleId: 'rule-lucidatura-grande-nera',
      action: 'create',
      snapshot: {
        id: 'rule-lucidatura-grande-nera',
        name: 'Lucidatura vettura grande nera',
        minutes: 150,
        priority: 10,
        active: true,
        conditions: { vehicleSizeClass: 'grande', colorFamily: 'nera', paintCycle: '', minPanels: null, maxPanels: null, attributes: { finitura: 'lucida' } },
      },
    }]
    await saveDatabase(custom)
    const reloaded = await loadDatabase()
    const work = reloaded.plannerSettings.standardWorks?.find((item) => item.id === 'std-lucidatura-persist')
    expect(work?.rules?.[0].name).toBe('Lucidatura vettura grande nera')
    expect(work?.rules?.[0].conditions?.attributes?.finitura).toBe('lucida')
    expect(reloaded.plannerSettings.standardWorkRuleHistory?.[0].workName).toBe('Lucidatura')
  })

  it('lavorazione presente -> crea regola -> refresh -> lavorazione ancora presente', async () => {
    const custom = structuredClone(data)
    custom.plannerSettings.standardWorks = [{
      id: 'work-lucidatura',
      name: 'Lucidatura',
      calculationType: 'per-vehicle',
      standardMinutes: 95,
      categoryOrPhase: 'Lucidatura',
      rules: [],
      active: true,
      requiredSkill: 'lucidatura',
      cycleOrder: 70,
    }]
    custom.plannerSettings.standardWorks[0].rules = [{
      id: 'rule-created',
      name: 'Lucidatura base',
      minutes: 100,
      priority: 1,
      active: true,
      conditions: { vehicleSizeClass: '', colorFamily: '', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} },
    }]
    await saveDatabase(custom)
    const reloaded = await loadDatabase()
    expect(reloaded.plannerSettings.standardWorks?.some((work) => work.name === 'Lucidatura')).toBe(true)
  })

  it('migra listino legacy associando workId da workName senza perdere le voci storiche', async () => {
    const custom = structuredClone(data)
    custom.plannerSettings.standardWorks = [{
      id: 'work-preparazione',
      name: 'Preparazione',
      calculationType: 'per-panel',
      standardMinutes: 60,
      categoryOrPhase: 'Carrozzeria',
      active: true,
      requiredSkill: 'carrozzeria',
      cycleOrder: 10,
    }]
    custom.plannerSettings.standardWorkPriceList = [{
      id: 'pl-legacy',
      panelName: 'Porta anteriore SX',
      workName: 'Preparazione',
      repairExtent: '',
      variantCycle: '',
      vatRate: 22,
      unitPrice: 160,
      active: true,
      note: 'legacy senza workId',
    }]

    await saveDatabase(custom)
    const reloaded = await loadDatabase()
    const item = reloaded.plannerSettings.standardWorkPriceList?.find((entry) => entry.id === 'pl-legacy')

    expect(item).toBeDefined()
    expect(item?.workName).toBe('Preparazione')
    expect(item?.workId).toBe('work-preparazione')
    expect(item?.unitPrice).toBe(160)
  })

  it('regola salvata -> refresh -> regola ancora presente', async () => {
    const custom = structuredClone(data)
    custom.plannerSettings.standardWorks = [{
      id: 'work-lucidatura-2',
      name: 'Lucidatura',
      calculationType: 'per-vehicle',
      standardMinutes: 90,
      categoryOrPhase: 'Lucidatura',
      rules: [{
        id: 'rule-saved',
        name: 'Lucidatura premium',
        minutes: 140,
        priority: 5,
        active: true,
        conditions: { vehicleSizeClass: 'grande', colorFamily: 'scura', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} },
      }],
      active: true,
      requiredSkill: 'lucidatura',
      cycleOrder: 70,
    }]
    await saveDatabase(custom)
    const reloaded = await loadDatabase()
    const work = reloaded.plannerSettings.standardWorks?.find((item) => item.id === 'work-lucidatura-2')
    expect(work?.rules?.some((rule) => rule.id === 'rule-saved' && rule.name === 'Lucidatura premium')).toBe(true)
  })

  it('modifica regola -> lavorazione principale invariata', async () => {
    const custom = structuredClone(data)
    custom.plannerSettings.standardWorks = [{
      id: 'work-lucidatura-3',
      name: 'Lucidatura',
      calculationType: 'per-vehicle',
      standardMinutes: 88,
      categoryOrPhase: 'Lucidatura',
      rules: [{
        id: 'rule-edit',
        name: 'Lucidatura media',
        minutes: 120,
        priority: 2,
        active: true,
        conditions: { vehicleSizeClass: 'media', colorFamily: '', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} },
      }],
      active: true,
      requiredSkill: 'lucidatura',
      cycleOrder: 70,
    }]
    await saveDatabase(custom)
    const loaded = await loadDatabase()
    const work = loaded.plannerSettings.standardWorks?.find((item) => item.id === 'work-lucidatura-3')
    if (!work) throw new Error('work missing')
    work.rules = (work.rules ?? []).map((rule) => rule.id === 'rule-edit' ? { ...rule, minutes: 150, name: 'Lucidatura media aggiornata' } : rule)
    await saveDatabase(loaded)
    const reloaded = await loadDatabase()
    const updatedWork = reloaded.plannerSettings.standardWorks?.find((item) => item.id === 'work-lucidatura-3')
    expect(updatedWork?.name).toBe('Lucidatura')
    expect(updatedWork?.standardMinutes).toBe(88)
    expect(updatedWork?.requiredSkill).toBe('lucidatura')
  })

  it('elimina regola -> lavorazione principale invariata', async () => {
    const custom = structuredClone(data)
    custom.plannerSettings.standardWorks = [{
      id: 'work-lucidatura-4',
      name: 'Lucidatura',
      calculationType: 'per-vehicle',
      standardMinutes: 92,
      categoryOrPhase: 'Lucidatura',
      rules: [{
        id: 'rule-delete',
        name: 'Regola da eliminare',
        minutes: 110,
        priority: 1,
        active: true,
        conditions: { vehicleSizeClass: '', colorFamily: '', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} },
      }],
      active: true,
      requiredSkill: 'lucidatura',
      cycleOrder: 70,
    }]
    await saveDatabase(custom)
    const loaded = await loadDatabase()
    const work = loaded.plannerSettings.standardWorks?.find((item) => item.id === 'work-lucidatura-4')
    if (!work) throw new Error('work missing')
    work.rules = []
    await saveDatabase(loaded)
    const reloaded = await loadDatabase()
    const updatedWork = reloaded.plannerSettings.standardWorks?.find((item) => item.id === 'work-lucidatura-4')
    expect(updatedWork?.name).toBe('Lucidatura')
    expect(updatedWork?.rules).toEqual([])
  })

  it('duplica regola -> nessun duplicato della lavorazione principale', async () => {
    const custom = structuredClone(data)
    custom.plannerSettings.standardWorks = [{
      id: 'work-lucidatura-5',
      name: 'Lucidatura',
      calculationType: 'per-vehicle',
      standardMinutes: 90,
      categoryOrPhase: 'Lucidatura',
      rules: [{
        id: 'rule-dup-1',
        name: 'Regola originale',
        minutes: 100,
        priority: 1,
        active: true,
        conditions: { vehicleSizeClass: '', colorFamily: '', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} },
      }],
      active: true,
      requiredSkill: 'lucidatura',
      cycleOrder: 70,
    }]
    await saveDatabase(custom)
    const loaded = await loadDatabase()
    const work = loaded.plannerSettings.standardWorks?.find((item) => item.id === 'work-lucidatura-5')
    if (!work) throw new Error('work missing')
    work.rules = [...(work.rules ?? []), { ...(work.rules?.[0] ?? { id: 'fallback', name: 'Fallback', minutes: 1, priority: 0, active: true, conditions: { vehicleSizeClass: '', colorFamily: '', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} } }), id: 'rule-dup-2', name: 'Regola originale copia' }]
    await saveDatabase(loaded)
    const reloaded = await loadDatabase()
    const lucidaturaWorks = (reloaded.plannerSettings.standardWorks ?? []).filter((item) => item.name === 'Lucidatura')
    expect(lucidaturaWorks).toHaveLength(1)
    expect(lucidaturaWorks[0].rules?.length).toBe(2)
  })

  it('ripristina Lucidatura da storico se il nome lavorazione e vuoto nei dati persistenti', async () => {
    const legacy = structuredClone(data)
    legacy.plannerSettings.standardWorks = [{
      id: 'work-lucidatura-hidden',
      name: '',
      calculationType: 'per-vehicle',
      standardMinutes: 100,
      categoryOrPhase: 'Lucidatura',
      rules: [{
        id: 'rule-hidden',
        name: 'Regola nascosta',
        minutes: 130,
        priority: 3,
        active: true,
        conditions: { vehicleSizeClass: 'media', colorFamily: '', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} },
      }],
      active: true,
      requiredSkill: 'lucidatura',
      cycleOrder: 70,
    }]
    legacy.plannerSettings.standardWorkRuleHistory = [{
      id: 'hist-luc-1',
      at: '2026-08-10T08:00:00.000Z',
      workId: 'work-lucidatura-hidden',
      workName: 'Lucidatura',
      ruleId: 'rule-hidden',
      action: 'update',
      snapshot: {
        id: 'rule-hidden',
        name: 'Regola nascosta',
        minutes: 130,
        priority: 3,
        active: true,
        conditions: { vehicleSizeClass: 'media', colorFamily: '', paintCycle: '', minPanels: null, maxPanels: null, attributes: {} },
      },
    }]
    await saveDatabase(legacy)
    const reloaded = await loadDatabase()
    const works = reloaded.plannerSettings.standardWorks ?? []
    expect(works.filter((work) => work.name === 'Lucidatura')).toHaveLength(1)
    expect(works.find((work) => work.id === 'work-lucidatura-hidden')?.rules?.[0].id).toBe('rule-hidden')
  })

  it('modifica Smontaggio da 60 a 61 -> salva -> reload dati -> risulta 61', async () => {
    const custom = structuredClone(data)
    await saveDatabase(custom)

    const loaded = await loadDatabase()
    loaded.plannerSettings.standardWorks = (loaded.plannerSettings.standardWorks ?? []).map((work) =>
      work.name === 'Smontaggio' ? { ...work, standardMinutes: 61 } : work,
    )
    await saveDatabase(loaded)

    const reloaded = await loadDatabase()
    const smontaggio = (reloaded.plannerSettings.standardWorks ?? []).find((work) => work.name === 'Smontaggio')
    expect(smontaggio?.standardMinutes).toBe(61)
  })

  it('ripristina Smontaggio a 60 -> salva -> reload -> risulta 60', async () => {
    const custom = structuredClone(data)
    await saveDatabase(custom)

    const loaded = await loadDatabase()
    loaded.plannerSettings.standardWorks = (loaded.plannerSettings.standardWorks ?? []).map((work) =>
      work.name === 'Smontaggio' ? { ...work, standardMinutes: 61 } : work,
    )
    await saveDatabase(loaded)

    const changed = await loadDatabase()
    changed.plannerSettings.standardWorks = (changed.plannerSettings.standardWorks ?? []).map((work) =>
      work.name === 'Smontaggio' ? { ...work, standardMinutes: 60 } : work,
    )
    await saveDatabase(changed)

    const reloaded = await loadDatabase()
    const smontaggio = (reloaded.plannerSettings.standardWorks ?? []).find((work) => work.name === 'Smontaggio')
    expect(smontaggio?.standardMinutes).toBe(60)
  })

  it('crea nuova lavorazione -> reload -> esiste', async () => {
    const custom = structuredClone(data)
    await saveDatabase(custom)

    const loaded = await loadDatabase()
    loaded.plannerSettings.standardWorks = [
      ...(loaded.plannerSettings.standardWorks ?? []),
      {
        id: 'work-new-persist',
        name: 'Nuova lavorazione persistente',
        calculationType: 'per-panel',
        standardMinutes: 75,
        categoryOrPhase: 'Preparazione',
        rules: [],
        active: true,
        requiredSkill: 'preparazione',
        cycleOrder: 45,
      },
    ]
    await saveDatabase(loaded)

    const reloaded = await loadDatabase()
    const added = (reloaded.plannerSettings.standardWorks ?? []).find((work) => work.id === 'work-new-persist')
    expect(added?.name).toBe('Nuova lavorazione persistente')
  })

  it('modifica lavorazione esistente -> reload -> mantiene nuovi valori', async () => {
    const custom = structuredClone(data)
    await saveDatabase(custom)

    const loaded = await loadDatabase()
    loaded.plannerSettings.standardWorks = (loaded.plannerSettings.standardWorks ?? []).map((work) =>
      work.name === 'Preparazione'
        ? {
            ...work,
            calculationType: 'per-vehicle',
            standardMinutes: 66,
            categoryOrPhase: 'Preparazione premium',
            requiredSkill: 'prep-speciale',
            cycleOrder: 44,
            active: false,
          }
        : work,
    )
    await saveDatabase(loaded)

    const reloaded = await loadDatabase()
    const preparazione = (reloaded.plannerSettings.standardWorks ?? []).find((work) => work.name === 'Preparazione')
    expect(preparazione?.calculationType).toBe('per-vehicle')
    expect(preparazione?.standardMinutes).toBe(66)
    expect(preparazione?.categoryOrPhase).toBe('Preparazione premium')
    expect(preparazione?.requiredSkill).toBe('prep-speciale')
    expect(preparazione?.cycleOrder).toBe(44)
    expect(preparazione?.active).toBe(false)
  })

  it('riavvio simulato repository/service -> dati lavorazioni ancora presenti', async () => {
    const custom = structuredClone(data)
    custom.plannerSettings.standardWorks = [
      {
        id: 'work-restart-check',
        name: 'Restart Check',
        calculationType: 'per-vehicle',
        standardMinutes: 77,
        categoryOrPhase: 'Test',
        rules: [],
        active: true,
        requiredSkill: 'test',
        cycleOrder: 99,
      },
    ]
    await saveDatabase(custom)

    vi.resetModules()
    const restartedModule = await import('./database')
    const reloaded = await restartedModule.loadDatabase()
    const restored = (reloaded.plannerSettings.standardWorks ?? []).find((work) => work.id === 'work-restart-check')
    expect(restored?.standardMinutes).toBe(77)
    expect(restored?.name).toBe('Restart Check')
  })

  it('mantiene listino prezzi lavorazioni e storico modifiche dopo refresh', async () => {
    const custom = structuredClone(data)
    custom.plannerSettings.standardWorkPriceList = [{
      id: 'price-1',
      panelName: 'Porta anteriore SX',
      workName: 'Verniciatura standard',
      variantCycle: 'standard',
      unitPrice: 145,
      active: true,
    }]
    custom.plannerSettings.standardWorkPriceHistory = [{
      id: 'ph-1',
      at: '2026-08-10T10:00:00.000Z',
      itemId: 'price-1',
      previousValue: {
        id: 'price-1',
        panelName: 'Porta anteriore SX',
        workName: 'Verniciatura standard',
        variantCycle: 'standard',
        unitPrice: 120,
        active: true,
      },
      newValue: {
        id: 'price-1',
        panelName: 'Porta anteriore SX',
        workName: 'Verniciatura standard',
        variantCycle: 'standard',
        unitPrice: 145,
        active: true,
      },
    }]
    await saveDatabase(custom)
    const reloaded = await loadDatabase()
    expect(reloaded.plannerSettings.standardWorkPriceList?.[0].unitPrice).toBe(145)
    expect(reloaded.plannerSettings.standardWorkPriceHistory?.[0].previousValue.unitPrice).toBe(120)
    expect(reloaded.plannerSettings.standardWorkPriceHistory?.[0].newValue.unitPrice).toBe(145)
  })

  it('non sovrascrive il listino prezzi salvato con i valori default del planner', async () => {
    const custom = structuredClone(data)
    custom.plannerSettings.standardWorkPriceList = [{
      id: 'price-preserve-1',
      panelName: 'Paraurti anteriore',
      workName: 'Preparazione',
      repairExtent: 'mezzo',
      variantCycle: 'standard',
      vatRate: 22,
      unitPrice: 99,
      active: true,
      note: 'da preservare',
    }]

    await saveDatabase(custom)
    const loaded = await loadDatabase()
    await saveDatabase(loaded)
    const reloaded = await loadDatabase()

    expect(reloaded.plannerSettings.standardWorkPriceList).toHaveLength(1)
    expect(reloaded.plannerSettings.standardWorkPriceList?.[0]).toMatchObject({
      id: 'price-preserve-1',
      panelName: 'Paraurti anteriore',
      workName: 'Preparazione',
      repairExtent: 'mezzo',
      variantCycle: 'standard',
      vatRate: 22,
      unitPrice: 99,
      active: true,
      note: 'da preservare',
    })
  })
})

describe('integrita sorgente dati unica', () => {
  const buildVehicle = (id: string, customerId = 'customer-1') => ({
    id,
    customerId,
    plate: `AB${id.slice(-4).toUpperCase()}`,
    make: 'Fiat',
    model: 'Panda',
    color: 'Nero',
    year: '2020',
    vin: `VIN-${id}`,
    mileage: '10000',
    status: 'accettata',
    coneNumber: null,
    priority: 'Normale' as const,
    deliveryDate: '2026-08-30',
    estimatedHours: 8,
    workedHours: 0,
    plannedEntryDate: '2026-08-20',
    requestedDeliveryDate: '2026-08-30',
    calculatedDeliveryDate: '',
    expectedRevenue: 1200,
    expectedMargin: 300,
    partsStatus: 'Disponibili' as const,
    blockReason: '',
    manualPlanningDate: '',
    createdAt: '2026-08-15T10:00:00.000Z',
  })

  const buildEstimate = (id: string, customerId = 'customer-1', vehicleId = 'vehicle-1') => ({
    id,
    number: `PREV-${id}`,
    date: '2026-08-15',
    customerId,
    vehicleId,
    plate: 'AA123AA',
    companyName: '',
    contactName: '',
    notes: '',
    status: 'Bozza' as const,
    lines: [],
    taxableAmount: 0,
    vatAmount: 0,
    total: 0,
    convertedJobId: null,
    history: [],
    createdAt: '2026-08-15T10:00:00.000Z',
    updatedAt: '2026-08-15T10:00:00.000Z',
  })

  const buildJob = (id: string, customerId = 'customer-1', vehicleId = 'vehicle-1') => ({
    id,
    number: `COMM-${id}`,
    estimateId: null,
    customerId,
    vehicleId,
    plate: 'AA123AA',
    coneNumber: null,
    entryDate: '2026-08-15',
    expectedDeliveryDate: '2026-08-30',
    priority: 'Normale' as const,
    responsible: 'Capo officina',
    status: 'Da pianificare' as const,
    companyName: '',
    contactName: '',
    notes: '',
    blocks: [],
    lines: [],
    phases: [],
    qualityChecklist: [],
    taxableAmount: 0,
    vatAmount: 0,
    total: 0,
    progressPercent: 0,
    createdAt: '2026-08-15T10:00:00.000Z',
    updatedAt: '2026-08-15T10:00:00.000Z',
    history: [],
  })

  it('refresh -> dati invariati', async () => {
    const source = structuredClone(data)
    source.vehicles = [buildVehicle('vehicle-refresh')]
    source.estimates = [buildEstimate('estimate-refresh', source.customers[0].id, source.vehicles[0].id)]
    source.jobs = [buildJob('job-refresh', source.customers[0].id, source.vehicles[0].id)]
    await saveDatabase(source)

    const before = await loadDatabase()
    const after = await loadDatabase()

    expect(after.customers).toHaveLength(before.customers.length)
    expect(after.vehicles).toHaveLength(before.vehicles.length)
    expect(after.estimates ?? []).toHaveLength((before.estimates ?? []).length)
    expect(after.jobs ?? []).toHaveLength((before.jobs ?? []).length)
  })

  it('riavvio vite/service -> dati invariati', async () => {
    const source = structuredClone(data)
    source.vehicles = [buildVehicle('vehicle-restart')]
    source.estimates = [buildEstimate('estimate-restart', source.customers[0].id, source.vehicles[0].id)]
    source.jobs = [buildJob('job-restart', source.customers[0].id, source.vehicles[0].id)]
    await saveDatabase(source)

    const before = await loadDatabase()
    vi.resetModules()
    const restartedModule = await import('./database')
    const after = await restartedModule.loadDatabase()

    expect(after.customers).toHaveLength(before.customers.length)
    expect(after.vehicles).toHaveLength(before.vehicles.length)
    expect(after.estimates ?? []).toHaveLength((before.estimates ?? []).length)
    expect(after.jobs ?? []).toHaveLength((before.jobs ?? []).length)
  })

  it('navigazione tra pagine -> dati invariati', async () => {
    const source = structuredClone(data)
    source.vehicles = [buildVehicle('vehicle-nav')]
    source.estimates = [buildEstimate('estimate-nav', source.customers[0].id, source.vehicles[0].id)]
    source.jobs = [buildJob('job-nav', source.customers[0].id, source.vehicles[0].id)]
    await saveDatabase(source)

    const office = await loadDatabase()
    office.plannerSettings.monthlyRevenueGoal = 42000
    await saveDatabase(office)

    const finance = await loadDatabase()
    finance.financeSettings.defaultPaymentDays = 45
    await saveDatabase(finance)

    const production = await loadDatabase()
    const currentProduction = (production.production ?? structuredClone(emptyData.production!))!
    production.production = {
      jobs: [...(currentProduction.jobs ?? [])],
      phaseHistory: [...(currentProduction.phaseHistory ?? [])],
      workLogs: [...(currentProduction.workLogs ?? [])],
      reports: [
        ...(currentProduction.reports ?? []),
        {
          id: 'report-nav-1',
          vehicleId: source.vehicles[0].id,
          type: 'richiesta all\'ufficio',
          note: 'Test navigazione',
          operatorId: 'tablet-operator',
          operatorName: 'Operatore Produzione',
          createdAt: '2026-08-15T11:00:00.000Z',
        },
      ],
      identities: [...(currentProduction.identities ?? [])],
      paceStates: [...(currentProduction.paceStates ?? [])],
      paceHistory: [...(currentProduction.paceHistory ?? [])],
    }
    await saveDatabase(production)

    const reloaded = await loadDatabase()
    expect(reloaded.customers).toHaveLength(1)
    expect(reloaded.vehicles).toHaveLength(1)
    expect(reloaded.estimates ?? []).toHaveLength(1)
    expect(reloaded.jobs ?? []).toHaveLength(1)
  })

  it('cross-tab stale save -> nessuna perdita dati su nuova vettura', async () => {
    const base = structuredClone(data)
    await saveDatabase(base)

    const tabA = await loadDatabase()
    const tabB = await loadDatabase()
    expect(tabA.dbRevision).toBe(tabB.dbRevision)

    tabA.vehicles = [buildVehicle('vehicle-tab-a')]
    await saveDatabase(tabA)
    const afterTabA = await loadDatabase()
    expect(afterTabA.vehicles.some((vehicle) => vehicle.id === 'vehicle-tab-a')).toBe(true)

    tabB.plannerSettings.monthlyRevenueGoal = 47000
    await saveDatabase(tabB)

    const afterTabB = await loadDatabase()
    expect(afterTabB.vehicles.some((vehicle) => vehicle.id === 'vehicle-tab-a')).toBe(true)
    expect(afterTabB.plannerSettings.monthlyRevenueGoal).toBe(47000)
  })

  it('cross-tab stale save -> nessuna perdita dati su nuova commessa', async () => {
    const base = structuredClone(data)
    base.vehicles = [buildVehicle('vehicle-job')]
    await saveDatabase(base)

    const tabA = await loadDatabase()
    const tabB = await loadDatabase()
    expect(tabA.dbRevision).toBe(tabB.dbRevision)

    tabA.jobs = [buildJob('job-tab-a', tabA.customers[0].id, tabA.vehicles[0].id)]
    await saveDatabase(tabA)
    const afterTabA = await loadDatabase()
    expect((afterTabA.jobs ?? []).some((job) => job.id === 'job-tab-a')).toBe(true)

    tabB.financeSettings.defaultVatRate = 10
    await saveDatabase(tabB)

    const afterTabB = await loadDatabase()
    expect((afterTabB.jobs ?? []).some((job) => job.id === 'job-tab-a')).toBe(true)
    expect(afterTabB.financeSettings.defaultVatRate).toBe(10)
  })

  it('creazione vettura -> reload -> presente', async () => {
    const source = structuredClone(data)
    source.vehicles = [buildVehicle('vehicle-create')]
    await saveDatabase(source)
    const reloaded = await loadDatabase()
    expect(reloaded.vehicles.some((vehicle) => vehicle.id === 'vehicle-create')).toBe(true)
  })

  it('historical storage con 3 occorrenze non contamina lo snapshot corrente autorevole', async () => {
    const current = structuredClone(data)
    current.vehicles = [buildVehicle('vehicle-current-1')]
    await saveDatabase(current)

    const legacy = structuredClone(data)
    legacy.vehicles = [
      { ...buildVehicle('vehicle-legacy-1'), plate: 'HGJFU8547' },
      { ...buildVehicle('vehicle-legacy-2'), plate: 'hg jfu 8547' },
      { ...buildVehicle('vehicle-legacy-3'), plate: 'HG JFU 8547' },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy))

    const reloaded = await loadDatabase()
    expect(reloaded.vehicles).toHaveLength(1)
    expect(reloaded.vehicles[0].id).toBe('vehicle-current-1')
  })

  it('conteggio targa normalizzata > 1 -> integrity check FAIL', async () => {
    const source = structuredClone(data)
    source.vehicles = [
      { ...buildVehicle('vehicle-dup-a'), plate: 'HGJFU8547' },
      { ...buildVehicle('vehicle-dup-b'), plate: 'hg jfu 8547' },
    ]

    await expect(saveDatabase(source)).rejects.toThrow(/targa duplicata rilevata/i)
  })

  it('analizza integrita: individua duplicati targa e orfani', async () => {
    const source = structuredClone(data)
    source.vehicles = [
      { ...buildVehicle('vehicle-dup-a'), plate: 'HGJFU8547' },
      { ...buildVehicle('vehicle-dup-b'), plate: 'hg jfu 8547' },
    ]
    source.estimates = [buildEstimate('estimate-orphan', source.customers[0].id, 'missing-vehicle-id')]

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('carrozzeria-elias-erp', 5)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('erp-state')) request.result.createObjectStore('erp-state')
      }
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('erp-state', 'readwrite')
        transaction.objectStore('erp-state').put(source, 'current')
        transaction.oncomplete = () => { database.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
      request.onerror = () => reject(request.error)
    })

    const report = await analyzeDatabaseIntegrity()
    expect(report.duplicatePlates.some((group) => group.normalizedPlate === 'HGJFU8547')).toBe(true)
    expect(report.orphanReferences.some((orphan) => orphan.vehicleId === 'missing-vehicle-id')).toBe(true)
  })

  it('risolvi duplicato: consolida riferimenti, crea backup e incrementa revisione', async () => {
    const source = structuredClone(data)
    source.dbRevision = 7
    source.vehicles = [
      { ...buildVehicle('vehicle-canonical'), plate: 'HGJFU8547', make: 'BMW', model: 'X1' },
      { ...buildVehicle('vehicle-duplicate'), plate: 'hg jfu 8547', make: '', model: '' },
    ]
    source.estimates = [buildEstimate('estimate-dup', source.customers[0].id, 'vehicle-duplicate')]
    source.jobs = [buildJob('job-dup', source.customers[0].id, 'vehicle-duplicate')]

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('carrozzeria-elias-erp', 5)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('erp-state')) request.result.createObjectStore('erp-state')
      }
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('erp-state', 'readwrite')
        transaction.objectStore('erp-state').put(source, 'current')
        transaction.oncomplete = () => { database.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
      request.onerror = () => reject(request.error)
    })

    const plan = await prepareDuplicateResolution('HGJFU8547')
    expect(plan.consolidatedVehicleIds).toContain('vehicle-duplicate')

    const result = await resolveDuplicatePlate('HGJFU8547')
    expect(result.revisionBefore).toBe(7)
    expect(result.revisionAfter).toBe(8)

    const reloaded = await loadDatabase()
    expect(reloaded.vehicles.filter((vehicle) => vehicle.plate.replace(/\s+/g, '').toUpperCase() === 'HGJFU8547')).toHaveLength(1)
    expect((reloaded.estimates ?? []).every((estimate) => estimate.vehicleId !== 'vehicle-duplicate')).toBe(true)
    expect((reloaded.jobs ?? []).every((job) => job.vehicleId !== 'vehicle-duplicate')).toBe(true)
  })

  it('creazione commessa -> reload -> presente', async () => {
    const source = structuredClone(data)
    source.vehicles = [buildVehicle('vehicle-create-job')]
    source.jobs = [buildJob('job-create', source.customers[0].id, source.vehicles[0].id)]
    await saveDatabase(source)
    const reloaded = await loadDatabase()
    expect((reloaded.jobs ?? []).some((job) => job.id === 'job-create')).toBe(true)
  })

  it('nessun reset automatico: load failure senza fallback genera errore e non azzera dati', async () => {
    const source = structuredClone(data)
    source.vehicles = [buildVehicle('vehicle-no-reset')]
    await saveDatabase(source)
    const dbBackup = indexedDB

    // Simula ambiente in errore totale: nessuna apertura DB e nessun fallback legacy.
    vi.stubGlobal('indexedDB', undefined)
    localStorage.removeItem(STORAGE_KEY)

    await expect(loadDatabase()).rejects.toThrowError('Impossibile caricare il database locale. Nessun fallback disponibile.')

    vi.stubGlobal('indexedDB', dbBackup)
    const reloaded = await loadDatabase()
    expect(reloaded.vehicles.some((vehicle) => vehicle.id === 'vehicle-no-reset')).toBe(true)
  })

  it('migrazione legacy -> nessuna perdita dati', async () => {
    const legacy = structuredClone(data)
    legacy.vehicles = [buildVehicle('vehicle-legacy')]
    legacy.estimates = [buildEstimate('estimate-legacy', legacy.customers[0].id, legacy.vehicles[0].id)]
    legacy.jobs = [buildJob('job-legacy', legacy.customers[0].id, legacy.vehicles[0].id)]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy))

    const migrated = await loadDatabase()

    expect(migrated.customers).toHaveLength(legacy.customers.length)
    expect(migrated.vehicles).toHaveLength(legacy.vehicles.length)
    expect(migrated.estimates ?? []).toHaveLength((legacy.estimates ?? []).length)
    expect(migrated.jobs ?? []).toHaveLength((legacy.jobs ?? []).length)
  })
})

describe('protezione origin persistenza', () => {
  const setOriginOverride = (origin: string) => {
    ;(globalThis as { __ERP_ORIGIN_OVERRIDE__?: string }).__ERP_ORIGIN_OVERRIDE__ = origin
  }

  it('localhost:5173 -> lettura/scrittura consentita: PASS', async () => {
    setOriginOverride(EXPECTED_APP_ORIGIN)
    const source = structuredClone(data)
    source.vehicles = [{
      id: 'vehicle-origin-ok',
      customerId: source.customers[0].id,
      plate: 'OR123OK',
      make: 'Fiat',
      model: 'Punto',
      color: 'Blu',
      year: '2020',
      vin: 'VIN-ORIGIN-OK',
      mileage: '1000',
      status: 'accettata',
      coneNumber: null,
      priority: 'Normale',
      deliveryDate: '',
      estimatedHours: 1,
      workedHours: 0,
      plannedEntryDate: '',
      requestedDeliveryDate: '',
      calculatedDeliveryDate: '',
      expectedRevenue: 0,
      expectedMargin: 0,
      partsStatus: 'Disponibili',
      blockReason: '',
      manualPlanningDate: '',
      createdAt: '2026-08-15T08:00:00.000Z',
    }]
    await saveDatabase(source)
    const reloaded = await loadDatabase()
    expect(reloaded.vehicles.some((vehicle) => vehicle.id === 'vehicle-origin-ok')).toBe(true)
  })

  it('file:// -> salvataggio bloccato: PASS', async () => {
    setOriginOverride('file://')
    await expect(saveDatabase(data)).rejects.toThrowError(/origin non consentito/i)
  })

  it('origin errato -> nessun database sovrascritto: PASS', async () => {
    setOriginOverride(EXPECTED_APP_ORIGIN)
    const baseline = structuredClone(data)
    baseline.vehicles = [{
      id: 'vehicle-baseline',
      customerId: baseline.customers[0].id,
      plate: 'BS123LN',
      make: 'Fiat',
      model: 'Panda',
      color: 'Grigio',
      year: '2019',
      vin: 'VIN-BASE',
      mileage: '2000',
      status: 'accettata',
      coneNumber: null,
      priority: 'Normale',
      deliveryDate: '',
      estimatedHours: 1,
      workedHours: 0,
      plannedEntryDate: '',
      requestedDeliveryDate: '',
      calculatedDeliveryDate: '',
      expectedRevenue: 0,
      expectedMargin: 0,
      partsStatus: 'Disponibili',
      blockReason: '',
      manualPlanningDate: '',
      createdAt: '2026-08-15T08:01:00.000Z',
    }]
    await saveDatabase(baseline)

    setOriginOverride('http://localhost:9999')
    const wrongOriginSnapshot = structuredClone(baseline)
    wrongOriginSnapshot.vehicles = []
    await expect(saveDatabase(wrongOriginSnapshot, { allowCountReduction: true })).rejects.toThrowError(/origin non consentito/i)

    setOriginOverride(EXPECTED_APP_ORIGIN)
    const reloaded = await loadDatabase()
    expect(reloaded.vehicles.some((vehicle) => vehicle.id === 'vehicle-baseline')).toBe(true)
  })

  it('origine LAN stessa porta -> lettura/scrittura consentita: PASS', async () => {
    setOriginOverride('http://192.168.1.8:5173')
    const source = structuredClone(data)
    source.vehicles = [{
      id: 'vehicle-origin-lan-ok',
      customerId: source.customers[0].id,
      plate: 'LN123OK',
      make: 'Fiat',
      model: 'Tipo',
      color: 'Bianco',
      year: '2023',
      vin: 'VIN-LAN-OK',
      mileage: '500',
      status: 'accettata',
      coneNumber: null,
      priority: 'Normale',
      deliveryDate: '',
      estimatedHours: 1,
      workedHours: 0,
      plannedEntryDate: '',
      requestedDeliveryDate: '',
      calculatedDeliveryDate: '',
      expectedRevenue: 0,
      expectedMargin: 0,
      partsStatus: 'Disponibili',
      blockReason: '',
      manualPlanningDate: '',
      createdAt: '2026-08-20T08:02:00.000Z',
    }]
    await saveDatabase(source)
    const reloaded = await loadDatabase()
    expect(reloaded.vehicles.some((vehicle) => vehicle.id === 'vehicle-origin-lan-ok')).toBe(true)
  })

  it('refresh localhost -> dati persistenti: PASS', async () => {
    setOriginOverride(EXPECTED_APP_ORIGIN)
    const source = structuredClone(data)
    source.vehicles = [{
      id: 'vehicle-refresh-origin',
      customerId: source.customers[0].id,
      plate: 'RF123SH',
      make: 'Fiat',
      model: '500',
      color: 'Nero',
      year: '2021',
      vin: 'VIN-REFRESH',
      mileage: '3000',
      status: 'accettata',
      coneNumber: null,
      priority: 'Normale',
      deliveryDate: '',
      estimatedHours: 1,
      workedHours: 0,
      plannedEntryDate: '',
      requestedDeliveryDate: '',
      calculatedDeliveryDate: '',
      expectedRevenue: 0,
      expectedMargin: 0,
      partsStatus: 'Disponibili',
      blockReason: '',
      manualPlanningDate: '',
      createdAt: '2026-08-15T08:02:00.000Z',
    }]
    await saveDatabase(source)
    const firstLoad = await loadDatabase()
    const secondLoad = await loadDatabase()
    expect(secondLoad.vehicles).toHaveLength(firstLoad.vehicles.length)
  })

  it('nuova vettura -> refresh -> ancora presente: PASS', async () => {
    setOriginOverride(EXPECTED_APP_ORIGIN)
    const source = structuredClone(data)
    source.vehicles = [{
      id: 'vehicle-new-refresh',
      customerId: source.customers[0].id,
      plate: 'NV123RF',
      make: 'Alfa Romeo',
      model: 'Giulietta',
      color: 'Rosso',
      year: '2022',
      vin: 'VIN-NEW-REFRESH',
      mileage: '1500',
      status: 'accettata',
      coneNumber: null,
      priority: 'Normale',
      deliveryDate: '',
      estimatedHours: 2,
      workedHours: 0,
      plannedEntryDate: '',
      requestedDeliveryDate: '',
      calculatedDeliveryDate: '',
      expectedRevenue: 0,
      expectedMargin: 0,
      partsStatus: 'Disponibili',
      blockReason: '',
      manualPlanningDate: '',
      createdAt: '2026-08-15T08:03:00.000Z',
    }]
    await saveDatabase(source)
    const reloaded = await loadDatabase()
    expect(reloaded.vehicles.some((vehicle) => vehicle.id === 'vehicle-new-refresh')).toBe(true)
  })
})
