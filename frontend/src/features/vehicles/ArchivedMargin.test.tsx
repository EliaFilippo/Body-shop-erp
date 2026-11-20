import { render,screen } from '@testing-library/react'
import { expect,it } from 'vitest'
import { ArchivedMargin } from './ArchivedVehicleDetails'
it.each([[100,'Positivo'],[-50,'Negativo'],[0,'In pareggio'],[null,'Da completare']] as const)('shows margin %s as %s',(margin,label)=>{
 render(<ArchivedMargin margin={margin} percent={margin===null?null:10} estimatedMaterials={true}/> )
 expect(screen.getByText(new RegExp(label))).toBeInTheDocument()
 if(margin===null)expect(screen.getByText('Costi incompleti')).toBeInTheDocument()
 else expect(screen.getByText(/La manodopera usa i costi preventivati/)).toBeInTheDocument()
})
