import type { PlannerOperator } from '../types'

export const OPERATOR_DUTIES = ['Riparazione grandine', 'Stuccatura', 'Lavaggio esterno', 'Lavaggio interni', 'Incartatura', 'Scartatura', 'Verniciatura', 'Smontaggio', 'Rimontaggio', 'Lucidatura', 'Ritocchi', 'Meccanica / gommista', 'Lattoneria', 'Preparazione', 'Lavaggio', 'Controllo qualità']
const normalize = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
export function supportsOperatorDuty(operator: PlannerOperator, duty: string) {
  const skills = (operator.skills ?? []).map(normalize).filter(Boolean)
  if (!skills.length) return !operator.skillsConfigured
  const required = normalize(duty)
  if (['incartatura', 'scartatura'].includes(required) && skills.includes('preparazione')) return true
  if (['lavaggio esterno', 'lavaggio interni'].includes(required) && skills.includes('lavaggio')) return true
  if (required === 'preparazione') return skills.includes('preparazione') || (skills.includes('scartatura') && skills.includes('incartatura'))
  if (required === 'lavaggio') return skills.includes('lavaggio') || (skills.includes('lavaggio esterno') && skills.includes('lavaggio interni'))
  if (required === 'controllo qualita') return skills.includes('controllo') || skills.includes(required)
  if (required === 'meccanica' || required === 'gommista') return skills.includes('meccanica / gommista') || skills.includes(required)
  return skills.includes(required)
}

/** An explicit empty preference disables the name-based initial preference. */
export function preferredOperatorDuties(operator: PlannerOperator) {
  return operator.preferredDuties ?? (normalize(operator.name) === 'stefania' ? operator.skills ?? [] : [])
}
export function prefersOperatorDuty(operator: PlannerOperator, duty: string) {
  return supportsOperatorDuty({ ...operator, skillsConfigured: true, skills: preferredOperatorDuties(operator) }, duty)
}
