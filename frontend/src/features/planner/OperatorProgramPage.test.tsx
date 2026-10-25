import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OperatorProgramPage } from './OperatorProgramPage'
import { emptyData } from '../../services/erp'
import { createEstimate, approveEstimateAndCreateJob } from '../../services/workflow'

describe('affiancamento sulla fase', () => {
 it('permette di scegliere un collega mentre mantiene automatica la scelta principale', () => {
  let data = structuredClone(emptyData)
  data.plannerSettings.operators = [{id:'a',name:'Stefania',active:true,dailyHours:8,skills:['Stuccatura','Verniciatura'],hourlyCost:20}, {id:'b',name:'Martin',active:true,dailyHours:8,skills:['Stuccatura','Verniciatura'],hourlyCost:40}]
  data = createEstimate(data, {customerId:'c',plate:'PROVA01',companyName:'',contactName:'',date:'2026-10-18',notes:'',selectedPhases:[],lines:[{description:'Verniciatura',standardWorkName:'Verniciatura',category:'verniciatura',estimatedMinutes:60,quantity:1,unitPrice:150,vatRate:22,discount:0}]})
  data = approveEstimateAndCreateJob(data,data.estimates![0].id)
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
