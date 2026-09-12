import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlannerPage } from './PlannerPage'
import { emptyData } from '../../services/erp'
import type { ErpData } from '../../types'

function makeData(): ErpData {
  const data = structuredClone(emptyData)
  data.plannerSettings.operators = [{
    id: 'op-1',
    name: 'Operatore Uno',
    dailyHours: 8,
    active: true,
    skills: ['smontaggio', 'verniciatura'],
  }]
  data.customers = [{
    id: 'c1',
    type: 'Privato',
    name: 'Mario Rossi',
    phone: '000',
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
    color: '',
    year: '',
    vin: '',
    mileage: '',
    status: 'Confermata',
    coneNumber: null,
    deliveryDate: '2026-08-20',
    priority: 'Normale',
    estimatedHours: 16,
    workedHours: 0,
    plannedEntryDate: '2026-08-14',
    requestedDeliveryDate: '2026-08-14',
    calculatedDeliveryDate: '',
    expectedRevenue: 0,
    expectedMargin: 0,
    partsStatus: 'Disponibili',
    blockReason: '',
    manualPlanningDate: '',
    createdAt: '2026-08-14T07:00:00.000Z',
  }]
  data.jobs = [{
    id: 'j1',
    number: 'COMM-00001',
    estimateId: 'e1',
    customerId: 'c1',
    vehicleId: 'v1',
    plate: 'AB123CD',
    coneNumber: null,
    entryDate: '2026-08-14',
    expectedDeliveryDate: '2026-08-20',
    priority: 'Normale',
    responsible: '',
    status: 'Pianificata',
    companyName: '',
    contactName: '',
    notes: '',
    blocks: [],
    lines: [],
    phases: [{
      id: 'p1',
      name: 'Smontaggio',
      status: 'In lavorazione',
      operatorAssignments: [],
      estimatedMinutes: 120,
      actualMinutes: 60,
      notes: '',
      blockedReason: '',
      requiredSkill: 'smontaggio',
      cycleOrder: 10,
      notRequired: false,
      technicalWaitMinutes: 0,
      technicalWaitBlocksPhaseNames: [],
      timeAdjustments: [],
    }, {
      id: 'p2',
      name: 'Verniciatura',
      status: 'Da fare',
      operatorAssignments: [],
      estimatedMinutes: 240,
      actualMinutes: 0,
      notes: '',
      blockedReason: '',
      requiredSkill: 'verniciatura',
      cycleOrder: 20,
      notRequired: false,
      technicalWaitMinutes: 30,
      technicalWaitBlocksPhaseNames: [],
      timeAdjustments: [],
    }],
    qualityChecklist: [],
    taxableAmount: 0,
    vatAmount: 0,
    total: 0,
    progressPercent: 35,
    createdAt: '2026-08-14T07:00:00.000Z',
    updatedAt: '2026-08-14T07:00:00.000Z',
    history: [],
  }]
  data.operatorPrograms = [{
    date: '2026-08-14',
    operatorId: 'op-1',
    operatorName: 'Operatore Uno',
    generatedAt: '2026-08-14T07:30:00.000Z',
    revision: 1,
    tasks: [{
      id: 'task-1',
      operatorId: 'op-1',
      operatorName: 'Operatore Uno',
      vehicleId: 'v1',
      plate: 'AB123CD',
      jobId: 'j1',
      jobNumber: 'COMM-00001',
      phaseId: 'p1',
      phaseName: 'Smontaggio',
      startAt: '2026-08-14T08:00:00.000Z',
      endAt: '2026-08-14T10:00:00.000Z',
      plannedMinutes: 120,
      priority: 'Normale',
      reason: 'Test',
      panelNames: ['Paraurti anteriore'],
      panelNotes: ['Rettifica supporto'],
      revision: 1,
    }, {
      id: 'task-2',
      operatorId: 'op-1',
      operatorName: 'Operatore Uno',
      vehicleId: 'v1',
      plate: 'AB123CD',
      jobId: 'j1',
      jobNumber: 'COMM-00001',
      phaseId: 'p2',
      phaseName: 'Verniciatura',
      startAt: '2026-08-14T10:30:00.000Z',
      endAt: '2026-08-14T14:30:00.000Z',
      plannedMinutes: 240,
      priority: 'Normale',
      reason: 'Test',
      panelNames: ['Paraurti anteriore'],
      panelNotes: ['Mascheratura completa'],
      revision: 1,
    }],
    summary: {
      plannedMinutes: 360,
      actualMinutes: 0,
      differenceMinutes: -360,
      overtimeMinutes: 0,
      advancedMinutes: 0,
      completedPlannedMinutes: 0,
      efficiencyPercent: 0,
    },
  }]
  return data
}

describe('PlannerPage regressione visibilita commessa pianificata', () => {
  it('mostra nel Planner intelligente una commessa con attivita schedulata nel Programma operatori', () => {
    const data = makeData()
    const openJob = vi.fn()
    const openProgram = vi.fn()
    const recalculatePlanning = vi.fn()
    render(
      <PlannerPage
        data={data}
        customerById={(id) => data.customers.find((item) => item.id === id)}
        onMove={() => undefined}
        onOpenSettings={() => undefined}
        onOpenJob={openJob}
        onOpenOperatorProgram={openProgram}
        onRecalculatePlanning={recalculatePlanning}
        onUpdateVehicleStatus={() => undefined}
        statusOptions={[{ id: 'accettata', label: 'Accettata' }, { id: 'in-lavorazione', label: 'In lavorazione' }, { id: 'pronta', label: 'Pronta' }]}
        statusLabel={(status) => status}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dettaglio pianificazione AB123CD' }))

    expect(screen.getByText('Dettaglio pianificazione vettura')).toBeInTheDocument()
    expect(screen.getAllByText('Mario Rossi').length).toBeGreaterThan(0)
    expect(screen.getAllByText('COMM-00001').length).toBeGreaterThan(0)
    expect(screen.getAllByText('TEMPO LAVORAZIONE').length).toBeGreaterThan(0)
    expect(screen.getAllByText('TEMPO TECNICO / ATTESA').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Data non rispettabile').length).toBeGreaterThan(0)
    expect(screen.getByText(/Perché\?/i)).toBeInTheDocument()
    expect(screen.getByText(/Prima data realistica/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Apri commessa' }))
    expect(openJob).toHaveBeenCalledWith('COMM-00001')

    fireEvent.click(screen.getByRole('button', { name: 'Dettaglio pianificazione AB123CD' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apri programma operatori' }))
    expect(openProgram).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Dettaglio pianificazione AB123CD' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ricalcola pianificazione' }))
    expect(recalculatePlanning).toHaveBeenCalledTimes(1)

  })
})
