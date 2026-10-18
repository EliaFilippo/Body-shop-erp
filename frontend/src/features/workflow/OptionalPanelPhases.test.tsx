import { useState } from 'react'
import { fireEvent,render,screen } from '@testing-library/react'
import { it,expect } from 'vitest'
import { emptyData } from '../../services/erp'
import { ELIAS_PRICE_LIST } from '../../services/eliasPriceList'
import { chooseEliasPrice } from '../../services/damageQuote'
import { OptionalPanelPhases } from './OptionalPanelPhases'
it('permette di togliere e riattivare i tempi del pezzo con due spunte distinte',()=>{
 const settings=structuredClone(emptyData.plannerSettings)
 const [initial]=chooseEliasPrice(settings,[],{id:'parafango-ant-dx',name:'Parafango anteriore DX'},ELIAS_PRICE_LIST.find(e=>e.id==='parafango')!,150,22,'lieve',60)
 function Editor(){const [line,setLine]=useState(initial);return <><OptionalPanelPhases line={line} settings={settings} onChange={setLine}/><output>{line.estimatedMinutes} min · {line.unitPrice} euro</output></>}
 render(<Editor/>)
 fireEvent.click(screen.getByLabelText(/Smontaggio \/ rimontaggio necessario/))
 fireEvent.click(screen.getByLabelText(/Lucidatura del pezzo verniciato necessaria/))
 expect(screen.getByRole('status')).toHaveTextContent('100 min · 150 euro')
 fireEvent.click(screen.getByLabelText(/Smontaggio \/ rimontaggio necessario/))
 fireEvent.click(screen.getByLabelText(/Lucidatura del pezzo verniciato necessaria/))
 expect(screen.getByRole('status')).toHaveTextContent('175 min · 150 euro')
})
