import { fireEvent,render,screen,within } from '@testing-library/react'
import { useState } from 'react'
import { describe,it,expect } from 'vitest'
import { emptyData } from '../../services/erp'
import { chooseEliasPrice } from '../../services/damageQuote'
import { eliasPricesForPanel } from '../../services/eliasPriceList'
import { EliasCatalogSettings } from './EliasCatalogSettings'
describe('modifica listino in ufficio',()=>{
 it('salva prezzo e gruppi minuti sul pannello scelto senza cambiare gli altri',()=>{
  let saved=structuredClone(emptyData.plannerSettings)
  function Editor(){const [settings,setSettings]=useState(saved);return <EliasCatalogSettings settings={settings} onSave={next=>{saved=next;setSettings(next)}}/>}
  render(<Editor/>)
  fireEvent.change(screen.getByLabelText('Applica a'),{target:{value:'porta-ant-sx'}})
  const summary=screen.getByText('Porta anteriore SX',{selector:'strong'})
  const row=summary.closest('details')!
  fireEvent.click(summary)
  fireEvent.change(within(row).getByLabelText('Prezzi Porta anteriore SX €'),{target:{value:'220'}})
  const times=within(row).getAllByRole('spinbutton')
  times.forEach(field=>fireEvent.change(field,{target:{value:'0'}}))
  fireEvent.change(times[2],{target:{value:'75'}})
  fireEvent.click(within(row).getByRole('button',{name:'Salva Porta anteriore SX'}))
  const panel={id:'porta-ant-sx',name:'Porta anteriore SX'}
  const entry=eliasPricesForPanel(panel.id,panel.name,saved).find(e=>e.id==='porta')!
  expect(chooseEliasPrice(saved,[],panel,entry,220,22,'lieve',60)[0]).toMatchObject({unitPrice:220,estimatedMinutes:75})
  expect(eliasPricesForPanel('porta-ant-dx','Porta anteriore DX',saved).find(e=>e.id==='porta')!.prices).toEqual([150])
  expect(saved.eliasPriceHistory).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('Lavaggio esterno · minuti per vettura'),{target:{value:'35'}})
  fireEvent.click(screen.getByRole('button',{name:'Salva tempo lavaggio esterno'}))
  expect(saved.eliasExteriorWashMinutes).toBe(35)
 })
})
