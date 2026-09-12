import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { emptyData } from '../../services/erp'
import { WorkflowPage } from './WorkflowPage'
import type { ErpData } from '../../types'

function makeData(): ErpData {
  const data = structuredClone(emptyData)
  data.customers = [{
    id: 'c1',
    type: 'Privato',
    name: 'Mario Rossi',
    phone: '333',
    email: '',
    taxId: '',
    address: '',
    createdAt: '2026-08-01T00:00:00.000Z',
  }]
  data.vehicles = [{
    id: 'v1',
    customerId: 'c1',
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
  }]
  data.plannerSettings.standardWorkPriceList = [{
    id: 'pl-1',
    panelName: 'Porta anteriore SX',
    workName: 'Smontaggio',
    variantCycle: '',
    unitPrice: 150,
    active: true,
  }]
  return data
}

function renderWorkflow(data = makeData()) {
  render(
    <WorkflowPage
      data={data}
      customerById={(id) => data.customers.find((customer) => customer.id === id)}
      query=""
      onChange={() => {}}
      setError={() => {}}
      setNotice={() => {}}
      onUpdateVehicleStatus={() => {}}
      statusOptions={[{ id: 'accettata', label: 'Accettata' }, { id: 'in-lavorazione', label: 'In lavorazione' }, { id: 'pronta', label: 'Pronta' }]}
      statusLabel={(status) => status}
    />, 
  )
  fireEvent.click(screen.getByRole('button', { name: 'Nuovo preventivo' }))
}

function goToPanelStep() {
  fireEvent.click(screen.getByRole('tab', { name: '2 Seleziona pannelli' }))
}

function goToWorkStep() {
  fireEvent.click(screen.getByRole('tab', { name: '3 Scegli lavorazioni' }))
}

describe('WorkflowPage esploso interattivo preventivo', () => {
  it('usa la ricerca unica per recuperare automaticamente cliente e vettura esistenti', () => {
    renderWorkflow()

    fireEvent.change(screen.getByPlaceholderText('Targa, cliente o telefono'), { target: { value: 'AB123CD' } })
    fireEvent.click(screen.getByRole('button', { name: /AB123CD/i }))

    expect(screen.getByDisplayValue('AB123CD')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Mario Rossi')).toBeInTheDocument()
    expect(screen.getByDisplayValue('AB123CD - Fiat 500')).toBeInTheDocument()
  })

  it('apre il pannello dettaglio al click su pannello SVG', () => {
    renderWorkflow()
    goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Sinistra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-sx'))
    expect(screen.getByRole('heading', { name: 'Porta anteriore SX' })).toBeInTheDocument()
  })

  it('consente selezione multipla lavorazioni e ricalcola tempi/prezzi', () => {
    renderWorkflow()
    goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Sinistra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-sx'))
    goToWorkStep()

    fireEvent.click(screen.getByLabelText('Smontaggio'))
    fireEvent.click(screen.getByLabelText('Lattoneria'))

    expect(screen.getAllByText('1 h 30 min').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/150,00/).length).toBeGreaterThan(0)
  })

  it('riapre un pannello gia configurato mantenendo le selezioni', () => {
    renderWorkflow()
    goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Sinistra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-sx'))
    goToWorkStep()
    fireEvent.click(screen.getByLabelText('Smontaggio'))

    goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Alto' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-paraurti-anteriore'))
    fireEvent.click(screen.getByRole('tab', { name: 'Sinistra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-sx'))
    goToWorkStep()

    const smontaggio = screen.getByLabelText('Smontaggio') as HTMLInputElement
    expect(smontaggio.checked).toBe(true)
  })

  it('rimuove un singolo pannello senza toccare gli altri', () => {
    renderWorkflow()
    goToPanelStep()

    fireEvent.click(screen.getByRole('tab', { name: 'Sinistra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-sx'))
    goToWorkStep()
    fireEvent.click(screen.getByLabelText('Smontaggio'))

    goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Destra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-dx'))
    goToWorkStep()
    fireEvent.click(screen.getByLabelText('Smontaggio'))

    goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Sinistra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-sx'))
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi pannello dal preventivo' }))

    fireEvent.click(screen.getByRole('tab', { name: 'Destra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-dx'))
    goToWorkStep()
    const rightSmontaggio = screen.getByLabelText('Smontaggio') as HTMLInputElement
    expect(rightSmontaggio.checked).toBe(true)
    expect(screen.getAllByText('1 h 00 min').length).toBeGreaterThan(0)
  })

  it('mappa ogni area SVG al pannello corretto senza ambiguita', () => {
    renderWorkflow()
    goToPanelStep()

    const checks: Array<{ view: 'Sinistra' | 'Destra' | 'Alto'; panelId: string; panelName: string }> = [
      { view: 'Sinistra', panelId: 'parafango-ant-sx', panelName: 'Parafango anteriore SX' },
      { view: 'Sinistra', panelId: 'porta-ant-sx', panelName: 'Porta anteriore SX' },
      { view: 'Sinistra', panelId: 'porta-post-sx', panelName: 'Porta posteriore SX' },
      { view: 'Sinistra', panelId: 'montante-sup-sx', panelName: 'Montante superiore SX' },
      { view: 'Sinistra', panelId: 'rear-fender-left', panelName: 'Parafango posteriore SX' },
      { view: 'Sinistra', panelId: 'wheel-front-sx', panelName: 'Cerchio anteriore SX' },
      { view: 'Sinistra', panelId: 'wheel-rear-sx', panelName: 'Cerchio posteriore SX' },
      { view: 'Destra', panelId: 'parafango-ant-dx', panelName: 'Parafango anteriore DX' },
      { view: 'Destra', panelId: 'porta-ant-dx', panelName: 'Porta anteriore DX' },
      { view: 'Destra', panelId: 'porta-post-dx', panelName: 'Porta posteriore DX' },
      { view: 'Destra', panelId: 'montante-sup-dx', panelName: 'Montante superiore DX' },
      { view: 'Destra', panelId: 'rear-fender-right', panelName: 'Parafango posteriore DX' },
      { view: 'Destra', panelId: 'wheel-front-dx', panelName: 'Cerchio anteriore DX' },
      { view: 'Destra', panelId: 'wheel-rear-dx', panelName: 'Cerchio posteriore DX' },
      { view: 'Alto', panelId: 'cofano', panelName: 'Cofano' },
      { view: 'Alto', panelId: 'tetto', panelName: 'Tetto' },
      { view: 'Alto', panelId: 'portellone-posteriore', panelName: 'Portellone/cofano posteriore' },
      { view: 'Alto', panelId: 'paraurti-anteriore', panelName: 'Paraurti anteriore' },
      { view: 'Alto', panelId: 'paraurti-posteriore', panelName: 'Paraurti posteriore' },
    ]

    for (const item of checks) {
      fireEvent.click(screen.getByRole('tab', { name: item.view }))
      fireEvent.click(screen.getByTestId(`vehicle-panel-${item.panelId}`))
      expect(screen.getByRole('heading', { name: item.panelName })).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('tab', { name: 'Sinistra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-rear-fender-left'))
    expect(screen.getByRole('heading', { name: 'Parafango posteriore SX' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Fiancata posteriore SX' })).not.toBeInTheDocument()
  })

  it('attiva fiancata completa SX solo quando i 4 pannelli laterali sono selezionati', () => {
    renderWorkflow()
    goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Sinistra' }))

    expect(screen.getByText('Fiancata completa SX').className.includes('configured')).toBe(false)
    fireEvent.click(screen.getByTestId('vehicle-panel-parafango-ant-sx'))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-sx'))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-post-sx'))
    fireEvent.click(screen.getByTestId('vehicle-panel-rear-fender-left'))
    expect(screen.getByText('Fiancata completa SX').className.includes('configured')).toBe(true)

    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-sx'))
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi pannello dal preventivo' }))
    expect(screen.getByText('Fiancata completa SX').className.includes('configured')).toBe(false)
  })

  it('mostra indicatore FRONTE in vista alto', () => {
    renderWorkflow()
    goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Alto' }))
    expect(screen.getByText('FRONTE')).toBeInTheDocument()
  })

  it('mantiene note diverse e intero-mezzo per pannelli distinti', () => {
    renderWorkflow()
    goToPanelStep()

    fireEvent.click(screen.getByRole('tab', { name: 'Sinistra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-sx'))
    fireEvent.change(screen.getByLabelText('Estensione riparazione'), { target: { value: 'mezzo' } })
    fireEvent.change(screen.getByPlaceholderText('Annotazioni specifiche per questo pannello'), { target: { value: 'Note SX' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Destra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-dx'))
    fireEvent.change(screen.getByPlaceholderText('Annotazioni specifiche per questo pannello'), { target: { value: 'Note DX' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Sinistra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-sx'))
    expect((screen.getByLabelText('Estensione riparazione') as HTMLSelectElement).value).toBe('mezzo')
    expect((screen.getByPlaceholderText('Annotazioni specifiche per questo pannello') as HTMLTextAreaElement).value).toBe('Note SX')

    fireEvent.click(screen.getByRole('tab', { name: 'Destra' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-porta-ant-dx'))
    expect((screen.getByPlaceholderText('Annotazioni specifiche per questo pannello') as HTMLTextAreaElement).value).toBe('Note DX')
  })

  it('recupera automaticamente tempo standard e prezzo listino con variante cofano+verniciatura+doppiostrato', () => {
    const data = makeData()
    data.plannerSettings.standardWorks = [{
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
    data.plannerSettings.standardWorkPriceList = [{
      id: 'pl-cofano-doppio',
      panelName: 'Cofano',
      workName: 'Verniciatura',
      repairExtent: 'intero',
      variantCycle: 'doppiostrato',
      unitPrice: 250,
      active: true,
    }]

    renderWorkflow(data)
  goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Alto' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-cofano'))
  fireEvent.click(screen.getByRole('button', { name: 'Dettagli pannello' }))
  fireEvent.change(screen.getByPlaceholderText('Es. perlato'), { target: { value: 'doppiostrato' } })
  goToWorkStep()
    fireEvent.click(screen.getByLabelText('Verniciatura'))

    const row = screen.getByLabelText('Verniciatura').closest('article')
    if (!row) throw new Error('Riga lavorazione non trovata')
    const scope = within(row)
    expect(scope.getAllByText(/30 min/).length).toBeGreaterThan(0)
    expect(scope.getAllByText(/250,00/).length).toBeGreaterThan(0)
  })

  it('mostra prezzo non configurato e tempo non configurato quando assenti', () => {
    const data = makeData()
    data.plannerSettings.standardWorks = [{
      id: 'std-non-config',
      name: 'Lucidatura',
      calculationType: 'per-vehicle',
      standardMinutes: 0,
      categoryOrPhase: 'Lucidatura',
      rules: [],
      active: true,
      requiredSkill: 'lucidatura',
      cycleOrder: 70,
    }]
    data.plannerSettings.standardWorkPriceList = []

    renderWorkflow(data)
  goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Alto' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-cofano'))
  goToWorkStep()
    fireEvent.click(screen.getByLabelText('Lucidatura'))

    const row = screen.getByLabelText('Lucidatura').closest('article')
    if (!row) throw new Error('Riga lavorazione non trovata')
    const scope = within(row)
    expect(scope.getByText('1 min')).toBeInTheDocument()
    fireEvent.click(scope.getByRole('button', { name: 'Dettagli' }))
    expect(scope.getByLabelText('Tempo preventivato (min)')).toBeInTheDocument()
    expect(scope.getByLabelText('Prezzo applicato')).toBeInTheDocument()
  })

  it('se esiste una sola variante la seleziona automaticamente', () => {
    const data = makeData()
    data.plannerSettings.standardWorks = [{
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
    data.plannerSettings.standardWorkPriceList = [{
      id: 'pl-variant-single',
      panelName: 'Cofano',
      workName: 'Verniciatura',
      repairExtent: 'intero',
      variantCycle: 'doppiostrato',
      unitPrice: 250,
      active: true,
    }]

    renderWorkflow(data)
    goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Alto' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-cofano'))
    goToWorkStep()
    fireEvent.click(screen.getByLabelText('Verniciatura'))

    const row = screen.getByLabelText('Verniciatura').closest('article')
    if (!row) throw new Error('Riga lavorazione non trovata')
    const scope = within(row)
    fireEvent.click(scope.getByRole('button', { name: 'Dettagli' }))
    expect(scope.getByLabelText('Tipo / Variante')).toHaveValue('doppiostrato')
    expect(scope.getByDisplayValue(/250,00/)).toBeInTheDocument()
  })

  it('con piu varianti permette scelta utente e aggiorna il prezzo applicato', () => {
    const data = makeData()
    data.plannerSettings.standardWorks = [{
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
    data.plannerSettings.standardWorkPriceList = [
      {
        id: 'pl-var-pastello',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: 'intero',
        variantCycle: 'pastello',
        unitPrice: 200,
        active: true,
      },
      {
        id: 'pl-var-doppio',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: 'intero',
        variantCycle: 'doppiostrato',
        unitPrice: 250,
        active: true,
      },
    ]

    renderWorkflow(data)
  goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Alto' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-cofano'))
  goToWorkStep()
    fireEvent.click(screen.getByLabelText('Verniciatura'))

    const row = screen.getByLabelText('Verniciatura').closest('article')
    if (!row) throw new Error('Riga lavorazione non trovata')
    const scope = within(row)
  fireEvent.click(scope.getByRole('button', { name: 'Dettagli' }))
    const variantSelect = scope.getByLabelText('Tipo / Variante')
    expect(variantSelect).toHaveValue('')

    fireEvent.change(variantSelect, { target: { value: 'doppiostrato' } })
    expect(scope.getByDisplayValue(/250,00/)).toBeInTheDocument()

    fireEvent.change(variantSelect, { target: { value: 'pastello' } })
    expect(scope.getByDisplayValue(/200,00/)).toBeInTheDocument()
  })

  it('cambio paintCycle pannello riesegue lookup prezzo e aggiorna imponibile/IVA/totale', () => {
    const data = makeData()
    data.plannerSettings.standardWorks = [{
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
    data.plannerSettings.standardWorkPriceList = [
      {
        id: 'pl-cofano-doppio',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: '',
        variantCycle: 'doppiostrato',
        unitPrice: 250,
        vatRate: 22,
        active: true,
      },
      {
        id: 'pl-cofano-pastello',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: '',
        variantCycle: 'pastello',
        unitPrice: 210,
        vatRate: 22,
        active: true,
      },
    ]

    renderWorkflow(data)
    goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Alto' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-cofano'))
    fireEvent.click(screen.getByRole('button', { name: 'Dettagli pannello' }))
    fireEvent.change(screen.getByPlaceholderText('Es. perlato'), { target: { value: 'doppiostrato' } })
    goToWorkStep()
    fireEvent.click(screen.getByLabelText('Verniciatura'))

    const row = screen.getByLabelText('Verniciatura').closest('article')
    if (!row) throw new Error('Riga lavorazione non trovata')
    const scope = within(row)
    fireEvent.click(scope.getByRole('button', { name: 'Dettagli' }))

    expect(scope.getByDisplayValue(/250,00/)).toBeInTheDocument()
    expect(scope.getByText(/Imponibile riga:/)).toHaveTextContent(/250,00/)
    expect(scope.getByText(/Totale riga:/)).toHaveTextContent(/305,00/)

    fireEvent.click(screen.getByRole('tab', { name: '4 Controlla e conferma' }))
    const economicStep = screen.getByTestId('estimate-economic-step')
    const economicScope = within(economicStep)
    expect(economicScope.getByText('Totale preventivo').parentElement).toHaveTextContent(/305,00/)
  })

  it('override manuale prezzo non viene sovrascritto al cambio variante e puo essere rimosso', () => {
    const data = makeData()
    data.plannerSettings.standardWorks = [{
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
    data.plannerSettings.standardWorkPriceList = [
      {
        id: 'pl-var-doppio',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: 'intero',
        variantCycle: 'doppiostrato',
        unitPrice: 250,
        active: true,
      },
      {
        id: 'pl-var-pastello',
        panelName: 'Cofano',
        workName: 'Verniciatura',
        repairExtent: 'intero',
        variantCycle: 'pastello',
        unitPrice: 200,
        active: true,
      },
    ]

    renderWorkflow(data)
  goToPanelStep()
    fireEvent.click(screen.getByRole('tab', { name: 'Alto' }))
    fireEvent.click(screen.getByTestId('vehicle-panel-cofano'))
  goToWorkStep()
    fireEvent.click(screen.getByLabelText('Verniciatura'))

    const row = screen.getByLabelText('Verniciatura').closest('article')
    if (!row) throw new Error('Riga lavorazione non trovata')
    const scope = within(row)
  fireEvent.click(scope.getByRole('button', { name: 'Dettagli' }))

    const variantSelect = scope.getByLabelText('Tipo / Variante')
    fireEvent.change(variantSelect, { target: { value: 'doppiostrato' } })
    expect(scope.getByDisplayValue(/250,00/)).toBeInTheDocument()

    fireEvent.change(scope.getByLabelText('Prezzo applicato'), { target: { value: '300' } })
    fireEvent.blur(scope.getByLabelText('Prezzo applicato'))
    expect(scope.getByDisplayValue(/300,00/)).toBeInTheDocument()

    fireEvent.change(variantSelect, { target: { value: 'pastello' } })
    expect(scope.getByDisplayValue(/300,00/)).toBeInTheDocument()
    expect(scope.getByText(/Override tempo:/)).toHaveTextContent(/Override prezzo:\s*Si/)

    fireEvent.click(scope.getByRole('button', { name: 'Aggiorna al listino attuale' }))
    expect(scope.getByDisplayValue(/200,00/)).toBeInTheDocument()
    expect(scope.getByText(/Override tempo:/)).toHaveTextContent(/Override prezzo:\s*No/)
  })
})
