import { describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { emptyData } from './erp'
import { loadDatabase, saveDatabase } from './database'
import { upsertPriceListItem, setPriceListItemActive, removePriceListItem } from './priceList'

const makeData = () => ({
  ...structuredClone(emptyData),
  plannerSettings: {
    ...structuredClone(emptyData.plannerSettings),
    standardWorkPriceList: [],
  },
})

describe('price list repository', () => {
  it('crea nuova voce listino e la mantiene dopo reload del repository', async () => {
    const source = makeData()
    const entry: Parameters<typeof upsertPriceListItem>[1] = {
      id: 'pl-1',
      panelName: 'Porta posteriore SX',
      workName: 'Preparazione',
      repairExtent: 'intero',
      variantCycle: '',
      vatRate: 22,
      unitPrice: 180,
      active: true,
      note: 'primo import',
    }

    const next = upsertPriceListItem(source, entry)
    await saveDatabase(next)
    const reloaded = await loadDatabase()

    expect(reloaded.plannerSettings.standardWorkPriceList?.find((item) => item.id === 'pl-1')).toMatchObject({
      panelName: 'Porta posteriore SX',
      workName: 'Preparazione',
      unitPrice: 180,
      active: true,
    })
  })

  it('modifica prezzo e lo mantiene dopo reload', async () => {
    const source = makeData()
    const entry: Parameters<typeof upsertPriceListItem>[1] = { id: 'pl-2', panelName: 'Parafango', workName: 'Lattoneria', repairExtent: 'mezzo', variantCycle: '', vatRate: 22, unitPrice: 100, active: true, note: '' }
    await saveDatabase(upsertPriceListItem(source, entry))

    const edited = upsertPriceListItem(await loadDatabase(), { ...entry, unitPrice: 140, active: true })
    await saveDatabase(edited)
    const reloaded = await loadDatabase()

    expect(reloaded.plannerSettings.standardWorkPriceList?.find((item) => item.id === 'pl-2')?.unitPrice).toBe(140)
  })

  it('disattiva e elimina voce persistendo dopo reload', async () => {
    const source = makeData()
    const entry: Parameters<typeof upsertPriceListItem>[1] = { id: 'pl-3', panelName: 'Porta', workName: 'Verniciatura', repairExtent: 'intero', variantCycle: 'standard', vatRate: 22, unitPrice: 300, active: true, note: '' }

    let next = upsertPriceListItem(source, entry)
    await saveDatabase(next)

    next = setPriceListItemActive(await loadDatabase(), 'pl-3', false)
    await saveDatabase(next)
    expect((await loadDatabase()).plannerSettings.standardWorkPriceList?.find((item) => item.id === 'pl-3')?.active).toBe(false)

    next = removePriceListItem(await loadDatabase(), 'pl-3')
    await saveDatabase(next)
    expect((await loadDatabase()).plannerSettings.standardWorkPriceList?.some((item) => item.id === 'pl-3')).toBe(false)
  })

  it('usa un ID stabile e non duplica record sul doppio salvataggio', async () => {
    const source = makeData()
    const entry: Parameters<typeof upsertPriceListItem>[1] = { id: 'pl-4', panelName: 'Porta', workName: 'Smontaggio', repairExtent: '', variantCycle: '', vatRate: 22, unitPrice: 80, active: true, note: '' }

    const first = upsertPriceListItem(source, entry)
    const second = upsertPriceListItem(first, { ...entry })
    await saveDatabase(second)
    const reloaded = await loadDatabase()

    expect(reloaded.plannerSettings.standardWorkPriceList?.filter((item) => item.id === 'pl-4')).toHaveLength(1)
  })

  it('mantiene la voce dopo ricreazione del contesto e reload dal repository', async () => {
    const source = makeData()
    const saved = upsertPriceListItem(source, {
      id: 'pl-5',
      panelName: 'Porta inferiore',
      workName: 'Preparazione',
      repairExtent: 'intero',
      variantCycle: 'standard',
      vatRate: 22,
      unitPrice: 123,
      active: true,
      note: 'persistenza reload',
    })

    await saveDatabase(saved)

    const rehydrated = await loadDatabase()
    const freshContext = {
      ...structuredClone(emptyData),
      plannerSettings: {
        ...structuredClone(emptyData.plannerSettings),
        standardWorkPriceList: rehydrated.plannerSettings.standardWorkPriceList ?? [],
      },
    }

    await saveDatabase(freshContext)
    const reloaded = await loadDatabase()
    const item = reloaded.plannerSettings.standardWorkPriceList?.find((entry) => entry.id === 'pl-5')

    expect(item).toBeDefined()
    expect(item?.unitPrice).toBe(123)
    expect(item?.panelName).toBe('Porta inferiore')
  })

  it('propaga l\'errore reale di persistenza quando il repository non riesce a scrivere', async () => {
    const openSpy = vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(() => {
      throw new Error('Quota IndexedDB insufficiente')
    })
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage pieno')
    })

    const source = makeData()
    const entry: Parameters<typeof upsertPriceListItem>[1] = {
      id: 'pl-6',
      panelName: 'Vernice laterale',
      workName: 'Verniciatura',
      repairExtent: 'mezzo',
      variantCycle: 'standard',
      vatRate: 22,
      unitPrice: 123,
      active: true,
      note: 'errore storage',
    }

    await expect(saveDatabase(upsertPriceListItem(source, entry))).rejects.toThrow(/Quota IndexedDB insufficiente|Storage pieno|Impossibile salvare/i)
    openSpy.mockRestore()
    storageSpy.mockRestore()
  })

  it('salva una nuova voce con ID, pannello, lavoro, prezzo, IVA e stato corretti e la rilegge dal repository', async () => {
    const source = makeData()
    const entry: Parameters<typeof upsertPriceListItem>[1] = {
      id: 'pl-7',
      panelName: 'Porta laterale',
      workName: 'Preparazione',
      repairExtent: 'intero',
      variantCycle: 'variante-123',
      vatRate: 22,
      unitPrice: 123,
      active: true,
      note: 'record valido',
    }

    await saveDatabase(upsertPriceListItem(source, entry))
    const reloaded = await loadDatabase()
    const saved = reloaded.plannerSettings.standardWorkPriceList?.find((item) => item.id === 'pl-7')

    expect(saved).toMatchObject({
      id: 'pl-7',
      panelName: 'Porta laterale',
      workName: 'Preparazione',
      unitPrice: 123,
      vatRate: 22,
      active: true,
    })
    expect(saved?.repairExtent).toBe('intero')
  })
})
