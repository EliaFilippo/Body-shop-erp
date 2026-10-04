import { describe, expect, it } from 'vitest'
import { supportsOperatorDuty } from './operatorSkills'
describe('mansioni abilitate', () => {
  const base = { id: 'a', name: 'A', active: true, dailyHours: 8, skillsConfigured: true }
  it('non abilita mansioni non selezionate o elenco vuoto', () => {
    expect(supportsOperatorDuty({ ...base, skills: [] }, 'Smontaggio')).toBe(false)
    expect(supportsOperatorDuty({ ...base, skills: ['smontaggio'] }, 'Rimontaggio')).toBe(false)
    expect(supportsOperatorDuty({ ...base, skills: ['smontaggio'] }, 'Smontaggio')).toBe(true)
  })
  it('richiede entrambe le competenze per fasi aggregate', () => {
    expect(supportsOperatorDuty({ ...base, skills: ['scartatura'] }, 'Preparazione')).toBe(false)
    expect(supportsOperatorDuty({ ...base, skills: ['scartatura', 'incartatura'] }, 'Preparazione')).toBe(true)
    expect(supportsOperatorDuty({ ...base, skills: ['lavaggio esterno'] }, 'Lavaggio interni')).toBe(false)
  })
})
