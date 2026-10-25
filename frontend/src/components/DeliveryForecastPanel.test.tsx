import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emptyData } from '../services/erp'
import { DeliveryForecastPanel } from './DeliveryForecastPanel'
import { simulateEstimateProductionForecast } from '../services/planner'
vi.mock('../services/planner',()=>({simulateEstimateProductionForecast:vi.fn()}))
vi.mock('../services/damageQuote',()=>({acceptanceEstimateLines:()=>[{description:'Riparazione',estimatedMinutes:60}]}))
describe('consegna prima della creazione della vettura',()=>{
 it('simula la nuova targa senza salvare e aggiorna la data richiesta',()=>{
  const simulate=vi.mocked(simulateEstimateProductionForecast)
  simulate.mockReturnValue({advisedDeliveryDate:'2026-10-28',firstAvailabilityDate:'2026-10-26',reliability:'Alta',blockingReasons:[]} as unknown as ReturnType<typeof simulateEstimateProductionForecast>)
  const data=structuredClone(emptyData)
  const before=JSON.stringify(data)
  const estimate={lines:[{description:'Riparazione',estimatedMinutes:60}]} as never
  const {rerender}=render(<DeliveryForecastPanel data={data} plate="AB123CD" estimate={estimate} requestedDeliveryDate="2026-10-27"/>)
  expect(screen.getByText('Consegna indicativa: 28/10/2026')).toBeInTheDocument()
  expect(simulate).toHaveBeenLastCalledWith(data,expect.objectContaining({plate:'AB123CD',vehicleId:undefined,requestedDeliveryDate:'2026-10-27'}))
  rerender(<DeliveryForecastPanel data={data} plate="AB123CD" estimate={estimate} requestedDeliveryDate="2026-10-29"/>)
  expect(simulate).toHaveBeenLastCalledWith(data,expect.objectContaining({requestedDeliveryDate:'2026-10-29'}))
  fireEvent.click(screen.getByRole('button',{name:'Ricalcola previsione consegna'}))
  expect(JSON.stringify(data)).toBe(before)
 })
 it('mostra il blocco anziché promettere una data senza operatori compatibili',()=>{
  vi.mocked(simulateEstimateProductionForecast).mockReturnValue({advisedDeliveryDate:'',blockingReasons:['Nessun operatore disponibile per Verniciatura.']} as unknown as ReturnType<typeof simulateEstimateProductionForecast>)
  render(<DeliveryForecastPanel data={structuredClone(emptyData)} plate="AB123CD" estimate={{lines:[{}]} as never}/>)
  expect(screen.getByText('Data da calcolare')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Nessun operatore disponibile')
 })
})
