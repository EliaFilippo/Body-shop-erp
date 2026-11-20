import {render,screen} from '@testing-library/react'
import {expect,it} from 'vitest'
import {hourlyRevenueComparison,HourlyRevenueComparison} from './HourlyRevenueComparison'
it.each([[600,7200,200,300,100,50],[200,7200,200,100,-100,-50],[400,7200,200,200,0,0]] as const)('compares actual person-hours with target',(revenue,seconds,target,actual,delta,percent)=>{
 expect(hourlyRevenueComparison(revenue,seconds,target)).toMatchObject({actual,delta,percent})
})
it('does not invent a rate for missing hours or target',()=>{
 expect(hourlyRevenueComparison(500,0,200).delta).toBeNull()
 expect(hourlyRevenueComparison(500,3600,null).delta).toBeNull()
})
it.each([[600,'Sopra obiettivo','#67d9a3'],[200,'Sotto obiettivo','#ff6b6b'],[400,'In linea con l’obiettivo',undefined]] as const)('shows an accessible comparison with color',(revenue,label,color)=>{
 render(<HourlyRevenueComparison revenue={revenue} seconds={7200} target={200}/> )
 const status=screen.getByText(label)
 expect(status).toBeVisible()
 if(color)expect(status.parentElement).toHaveStyle({color})
})

it('compares the contribution after direct costs, preserving losses and accepting a zero remaining target',()=>{
 // 232 revenue - 5 materials - 38.72 labor = 188.28 available to cover overhead and objective.
 expect(hourlyRevenueComparison(232-5-38.72,2.5812*3600,70)).toMatchObject({actual:72.94,delta:2.94})
 expect(hourlyRevenueComparison(-40,7200,70)).toMatchObject({actual:-20,delta:-90})
 expect(hourlyRevenueComparison(100,3600,0)).toMatchObject({actual:100,goal:0,delta:100,percent:null})
 render(<HourlyRevenueComparison revenue={188.28} seconds={2.5812*3600} target={70} net/>)
 expect(screen.getByText('Margine orario rispetto all’obiettivo')).toBeVisible()
 expect(screen.getByText('Sopra obiettivo')).toBeVisible()
})
