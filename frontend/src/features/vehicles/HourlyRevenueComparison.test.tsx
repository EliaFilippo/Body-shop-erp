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
