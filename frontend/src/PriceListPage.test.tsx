import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PriceListPage } from './App'
import { emptyData } from './services/erp'
import { within } from '@testing-library/react'
import { loadDatabase, saveDatabase } from './services/database'
import type { ErpData, StandardWorkPriceListItem } from './types'

vi.mock('./services/database', async () => {
  const actual = await vi.importActual<typeof import('./services/database')>('./services/database')
  return {
    ...actual,
    loadDatabase: vi.fn(),
    saveDatabase: vi.fn(),
  }
})

function makeData(): ErpData {
  return {
    ...structuredClone(emptyData),
    plannerSettings: {
      ...structuredClone(emptyData.plannerSettings),
      standardWorks: [{
        id: 'work-prep',
        name: 'Preparazione',
        calculationType: 'per-panel',
        standardMinutes: 60,
        categoryOrPhase: 'Carrozzeria',
        active: true,
        requiredSkill: 'carrozzeria',
        cycleOrder: 10,
      }],
      standardWorkPriceList: [],
    },
  }
}

describe('PriceListPage save draft flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocca il salvataggio con messaggio UI quando lavorazione e vuota', async () => {
    const data = makeData()
    const onChange = vi.fn()
    const setNotice = vi.fn()
    const setError = vi.fn()

    render(<PriceListPage data={data} query="" onChange={onChange} setNotice={setNotice} setError={setError} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Nuova voce listino' }))
    const editModalTitle = screen.getByText('Modifica voce listino')
    const editModal = editModalTitle.closest('section') as HTMLElement
    fireEvent.change(within(editModal).getByLabelText('Pannello'), { target: { value: 'Porta anteriore SX' } })
    fireEvent.click(within(editModal).getByRole('button', { name: 'Salva' }))

    await waitFor(() => {
      expect(setError).toHaveBeenCalledWith('Seleziona una lavorazione.')
    })
    expect(saveDatabase).not.toHaveBeenCalled()
    expect(loadDatabase).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('trasferisce workId/workName dalla select e persiste la voce dopo reload', async () => {
    const data = makeData()
    const onChange = vi.fn()
    const setNotice = vi.fn()
    const setError = vi.fn()

    let stored: ErpData = data
    vi.mocked(saveDatabase).mockImplementation(async (nextData) => {
      stored = structuredClone(nextData)
    })
    vi.mocked(loadDatabase).mockImplementation(async () => structuredClone(stored))

    render(<PriceListPage data={data} query="" onChange={onChange} setNotice={setNotice} setError={setError} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Nuova voce listino' }))
    const editModalTitle = screen.getByText('Modifica voce listino')
    const editModal = editModalTitle.closest('section') as HTMLElement
    fireEvent.change(within(editModal).getByLabelText('Pannello'), { target: { value: 'Porta anteriore SX' } })
    fireEvent.change(within(editModal).getByLabelText('Lavorazione'), { target: { value: 'work-prep' } })
    fireEvent.change(within(editModal).getByLabelText('Prezzo imponibile'), { target: { value: '123' } })
    fireEvent.blur(within(editModal).getByLabelText('Prezzo imponibile'))
    fireEvent.click(within(editModal).getByRole('button', { name: 'Salva' }))

    await waitFor(() => {
      expect(saveDatabase).toHaveBeenCalledTimes(1)
      expect(loadDatabase).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(setNotice).toHaveBeenCalledWith('Listino prezzi salvato.')
    })

    const persistedList = stored.plannerSettings.standardWorkPriceList ?? []
    expect(persistedList).toHaveLength(1)
    expect(persistedList[0]).toMatchObject({
      panelName: 'Porta anteriore SX',
      workId: 'work-prep',
      workName: 'Preparazione',
      unitPrice: 123,
      active: true,
    })
    expect(setError).not.toHaveBeenCalledWith('Seleziona una lavorazione.')
  })

  it('mostra nel dropdown solo le lavorazioni attive e recepisce nuove lavorazioni al rerender', () => {
    const data = makeData()
    const { rerender } = render(<PriceListPage data={data} query="" onChange={vi.fn()} setNotice={vi.fn()} setError={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Nuova voce listino' }))
    const editModalTitle = screen.getByText('Modifica voce listino')
    const editModal = editModalTitle.closest('section') as HTMLElement
    const workSelect = within(editModal).getByLabelText('Lavorazione')
    expect(screen.getByRole('option', { name: 'Preparazione' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Lattoneria' })).not.toBeInTheDocument()

    const withNewWork = structuredClone(data)
    withNewWork.plannerSettings.standardWorks = [
      ...(withNewWork.plannerSettings.standardWorks ?? []),
      {
        id: 'work-lattoneria',
        name: 'Lattoneria',
        calculationType: 'per-panel',
        standardMinutes: 90,
        categoryOrPhase: 'Carrozzeria',
        active: true,
        requiredSkill: 'lattoneria',
        cycleOrder: 20,
      },
    ]
    rerender(<PriceListPage data={withNewWork} query="" onChange={vi.fn()} setNotice={vi.fn()} setError={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'Lattoneria' })).toBeInTheDocument()

    const withDisabledWork = structuredClone(withNewWork)
    withDisabledWork.plannerSettings.standardWorks = (withDisabledWork.plannerSettings.standardWorks ?? []).map((work) =>
      work.id === 'work-lattoneria' ? { ...work, active: false } : work,
    )
    rerender(<PriceListPage data={withDisabledWork} query="" onChange={vi.fn()} setNotice={vi.fn()} setError={vi.fn()} />)
    fireEvent.change(workSelect, { target: { value: 'work-prep' } })
    expect(screen.queryByRole('option', { name: 'Lattoneria' })).not.toBeInTheDocument()
  })

  it('mantiene disponibile la lavorazione storica disattivata durante la modifica', () => {
    const data = makeData()
    data.plannerSettings.standardWorks = [{
      id: 'work-prep',
      name: 'Preparazione',
      calculationType: 'per-panel',
      standardMinutes: 60,
      categoryOrPhase: 'Carrozzeria',
      active: false,
      requiredSkill: 'carrozzeria',
      cycleOrder: 10,
    }]
    data.plannerSettings.standardWorkPriceList = [{
      id: 'pl-storica',
      workId: 'work-prep',
      panelName: 'Porta anteriore SX',
      workName: 'Preparazione',
      repairExtent: '',
      variantCycle: '',
      vatRate: 22,
      unitPrice: 111,
      active: true,
      note: '',
    }]

    render(<PriceListPage data={data} query="" onChange={vi.fn()} setNotice={vi.fn()} setError={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Modifica' }))
    expect(screen.getByRole('option', { name: 'Preparazione (disattivata)' })).toBeInTheDocument()
  })

  it('mostra lo storico listino nella pagina Listino prezzi e permette ricerca test nel catalogo', () => {
    const data = makeData()
    data.plannerSettings.standardWorkPriceList = [
      {
        id: 'pl-test',
        workId: 'work-prep',
        panelName: 'Pannello test',
        workName: 'Preparazione',
        repairExtent: '',
        variantCycle: 'test-variante',
        vatRate: 22,
        unitPrice: 123,
        active: true,
        note: '',
      },
      {
        id: 'pl-real',
        workId: 'work-prep',
        panelName: 'Cofano',
        workName: 'Preparazione',
        repairExtent: '',
        variantCycle: 'standard',
        vatRate: 22,
        unitPrice: 200,
        active: true,
        note: '',
      },
    ]
    data.plannerSettings.standardWorkPriceHistory = [{
      id: 'hist-1',
      at: '2026-08-10T10:00:00.000Z',
      itemId: 'pl-test',
      operation: 'create',
      previousValue: { ...data.plannerSettings.standardWorkPriceList[0], active: false, unitPrice: 0 },
      newValue: data.plannerSettings.standardWorkPriceList[0],
    }]

    render(<PriceListPage data={data} query="" onChange={vi.fn()} setNotice={vi.fn()} setError={vi.fn()} />)

    expect(screen.getByText('STORICO LISTINO')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Cerca nel listino...'), { target: { value: 'test' } })
    const [catalogTable] = screen.getAllByRole('table')
    expect(within(catalogTable).getByText('Pannello test')).toBeInTheDocument()
    expect(within(catalogTable).queryByText('Cofano')).not.toBeInTheDocument()
  })

  it('disattiva una voce listino e salva lo stato senza rompere il workId', async () => {
    const data = makeData()
    data.plannerSettings.standardWorkPriceList = [{
      id: 'pl-1',
      workId: 'work-prep',
      panelName: 'Porta',
      workName: 'Preparazione',
      repairExtent: '',
      variantCycle: '',
      vatRate: 22,
      unitPrice: 99,
      active: true,
      note: '',
    }]
    const onChange = vi.fn()
    const setError = vi.fn()

    let stored: ErpData = structuredClone(data)
    vi.mocked(saveDatabase).mockImplementation(async (nextData) => {
      stored = structuredClone(nextData)
    })
    vi.mocked(loadDatabase).mockImplementation(async () => structuredClone(stored))

    render(<PriceListPage data={data} query="" onChange={onChange} setNotice={vi.fn()} setError={setError} />)

    fireEvent.click(screen.getByRole('button', { name: 'Disattiva' }))

    await waitFor(() => {
      expect(saveDatabase).toHaveBeenCalled()
      expect(onChange).toHaveBeenCalled()
    })

    const row = stored.plannerSettings.standardWorkPriceList?.find((item) => item.id === 'pl-1')
    expect(row?.active).toBe(false)
    expect(row?.workId).toBe('work-prep')
    expect(setError).not.toHaveBeenCalled()
  })

  it('elimina singola voce listino con conferma senza toccare documenti storici', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const data = makeData()
    data.plannerSettings.standardWorkPriceList = [{
      id: 'pl-del',
      workId: 'work-prep',
      panelName: 'Parafango',
      workName: 'Preparazione',
      repairExtent: '',
      variantCycle: '',
      vatRate: 22,
      unitPrice: 88,
      active: true,
      note: '',
    }]

    let stored: ErpData = structuredClone(data)
    vi.mocked(saveDatabase).mockImplementation(async (nextData) => {
      stored = structuredClone(nextData)
    })
    vi.mocked(loadDatabase).mockImplementation(async () => structuredClone(stored))

    render(<PriceListPage data={data} query="" onChange={vi.fn()} setNotice={vi.fn()} setError={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }))

    await waitFor(() => {
      expect(stored.plannerSettings.standardWorkPriceList).toHaveLength(0)
    })
    confirmSpy.mockRestore()
  })

  it('pulisce lo storico filtrato senza eliminare il listino corrente', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const data = makeData()
    const listItem: StandardWorkPriceListItem = {
      id: 'pl-keep',
      workId: 'work-prep',
      panelName: 'Cofano',
      workName: 'Preparazione',
      repairExtent: '',
      variantCycle: '',
      vatRate: 22,
      unitPrice: 250,
      active: true,
      note: '',
    }
    data.plannerSettings.standardWorkPriceList = [listItem]
    data.plannerSettings.standardWorkPriceHistory = [{
      id: 'hist-clean',
      at: '2026-08-12T10:00:00.000Z',
      itemId: 'pl-keep',
      operation: 'update',
      previousValue: { ...listItem, unitPrice: 200 },
      newValue: listItem,
    }]

    let stored: ErpData = structuredClone(data)
    vi.mocked(saveDatabase).mockImplementation(async (nextData) => {
      stored = structuredClone(nextData)
    })
    vi.mocked(loadDatabase).mockImplementation(async () => structuredClone(stored))

    render(<PriceListPage data={data} query="" onChange={vi.fn()} setNotice={vi.fn()} setError={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Lavorazione'), { target: { value: 'Preparazione' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pulisci storico' }))

    await waitFor(() => {
      expect(stored.plannerSettings.standardWorkPriceHistory).toHaveLength(0)
      expect(stored.plannerSettings.standardWorkPriceList).toHaveLength(1)
      expect(stored.plannerSettings.standardWorkPriceList?.[0].unitPrice).toBe(250)
    })
    confirmSpy.mockRestore()
  })
})
