import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OperatorProgramPage } from './OperatorProgramPage'
import { emptyData } from '../../services/erp'
import { todayKey } from '../../services/planner'
import type { OperatorDayProgram, OperatorProgramTask } from '../../types'
import { createEstimate, approveEstimateAndCreateJob } from '../../services/workflow'

const setup = () => {
  let data = structuredClone(emptyData)
  data.plannerSettings.operators = [{id:'a',name:'Stefania',active:true,dailyHours:8,skills:['Stuccatura','Verniciatura'],hourlyCost:20}, {id:'b',name:'Martin',active:true,dailyHours:8,skills:['Stuccatura','Verniciatura'],hourlyCost:40}]
  data = createEstimate(data, {customerId:'c',plate:'PROVA01',companyName:'',contactName:'',date:'2026-10-18',notes:'',selectedPhases:[],lines:[{description:'Verniciatura',standardWorkName:'Verniciatura',category:'verniciatura',estimatedMinutes:60,quantity:1,unitPrice:150,vatRate:22,discount:0}]})
  data = approveEstimateAndCreateJob(data,data.estimates![0].id)
  return data
}

describe('affiancamento sulla fase', () => {
 it('permette di scegliere un collega mentre mantiene automatica la scelta principale', () => {
  const data = setup()
  const onChange = vi.fn()
  render(<OperatorProgramPage data={data} onChange={onChange} />)
  expect(screen.getByLabelText('Assegnazione PROVA01')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('Secondo operatore PROVA01'), {target:{value:'b'}})
  const next = onChange.mock.calls.at(-1)![0]
  const phase = next.jobs[0].phases.find((p: {name:string})=>p.name==='Stuccatura')
  expect(phase.supportOperatorId).toBe('b');expect(phase.preferredOperatorId).toBeUndefined()
  expect(next.jobs[0].history[0].message).toContain('Martin')
  expect(data.jobs![0].phases.find(p=>p.name==='Stuccatura')!.supportOperatorId).toBeUndefined()
 })
})

it('salva l’operatore della fase successiva senza modificare la prima fase', () => {
  const data = setup()
  const job = data.jobs![0]
  const firstPhase = job.phases.find(phase => phase.name === 'Stuccatura')!
  const futurePhase = job.phases.find(phase => phase.name === 'Verniciatura')!
  const onChange = vi.fn()
  render(<OperatorProgramPage data={data} onChange={onChange} />)

  const phasePicker = screen.getByLabelText('Fase di lavorazione PROVA01')
  expect(phasePicker).toHaveValue(firstPhase.id)
  fireEvent.change(phasePicker, { target: { value: futurePhase.id } })
  expect(onChange).not.toHaveBeenCalled()

  fireEvent.change(screen.getByLabelText('Assegnazione PROVA01'), { target: { value: 'b' } })
  const savedJob = onChange.mock.calls[0][0].jobs[0] as typeof job
  expect(onChange.mock.calls[0][0].plannerSettings.operatorProgramEditedAt).toMatch(/Z$/)
  expect(savedJob.phases.find(phase => phase.id === futurePhase.id)?.preferredOperatorId).toBe('b')
  expect(savedJob.phases.find(phase => phase.id === firstPhase.id)?.preferredOperatorId).toBeUndefined()
})

it('mostra il piano visibile e riprende le fasi del solo operatore scelto, mantenendo il piano manuale salvato', () => {
  const data = setup()
  const date = todayKey()
  const job = data.jobs![0]
  job.vehicleId = 'vehicle-1'
  const filling = job.phases.find(phase => phase.name === 'Stuccatura')!
  filling.notRequired = false
  const paint = job.phases.find(phase => phase.name === 'Verniciatura')!
  const saved = { operatorId: 'b', jobId: job.id, phaseId: paint.id }
  data.plannerSettings.manualOperatorDays = [{ date, period: 'day', assignments: [saved] }]

  const task: OperatorProgramTask = {
    id: 'published-filling', operatorId: 'a', operatorName: 'Stefania', vehicleId: job.vehicleId,
    plate: job.plate, jobId: job.id, jobNumber: job.number, phaseId: filling.id, phaseName: filling.name,
    startAt: `${date}T08:00:00Z`, endAt: `${date}T09:00:00Z`, plannedMinutes: 60,
    priority: 'Normale', revision: 1, reason: 'Piano pubblicato',
  }
  const programs: OperatorDayProgram[] = [
    { date, operatorId: 'a', operatorName: 'Stefania', revision: 1, generatedAt: task.startAt, tasks: [task] },
    { date, operatorId: 'b', operatorName: 'Martin', revision: 1, generatedAt: task.startAt, tasks: [] },
  ]
  const onChange = vi.fn()
  render(<OperatorProgramPage data={data} onChange={onChange} visiblePrograms={programs} />)

  fireEvent.click(screen.getByRole('button', { name: 'Modifica programma del giorno' }))
  const editor = within(screen.getByRole('region', { name: 'Modifica programma del giorno' }))
  expect(editor.getByText(/08:00–09:00 · PROVA01/)).toBeVisible()
  expect(editor.getByText(/PROVA01 · Verniciatura/, { selector: 'li' })).toBeVisible()
  expect(onChange).not.toHaveBeenCalled()

  fireEvent.click(editor.getByRole('button', { name: 'Riprendi le fasi pianificate di Stefania' }))
  fireEvent.click(editor.getByRole('button', { name: 'Salva e calcola orari' }))
  expect(onChange.mock.calls[0][0].plannerSettings.manualOperatorDays).toEqual([{
    date, period: 'day', assignments: [saved, { operatorId: 'a', jobId: job.id, phaseId: filling.id }],
  }])
})
