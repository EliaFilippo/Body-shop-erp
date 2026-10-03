import type { StandardWorkDefinition } from '../types'

export type EliasPanelKind = 'front-bumper' | 'rear-bumper' | 'hood' | 'wing' | 'wheel' | 'mirror' | 'door' | 'sill' | 'handle' | 'roof' | 'pillar' | 'spoiler' | 'arch' | 'tailgate' | 'bumper-trim' | 'whole' | 'headlight' | 'windshield'
export interface EliasPriceEntry {
  id: string
  name: string
  panels: EliasPanelKind[]
  prices: number[]
  family: string
  phase: string
}

// Trascrizione del listino fornito dal titolare il 03/10/2026.
// Confermato: IVA esclusa, materiali inclusi. Nessun tempo è indicato nel foglio.
export const ELIAS_PRICE_LIST: EliasPriceEntry[] = [
  { id: 'paraurti-anteriore', name: 'Paraurti anteriore', panels: ['front-bumper'], prices: [185], family: 'finitura', phase: 'Verniciatura' },
  { id: 'mezzo-paraurti', name: '½ paraurti anteriore/posteriore', panels: ['front-bumper', 'rear-bumper'], prices: [80], family: 'finitura', phase: 'Verniciatura' },
  { id: 'cofano', name: 'Cofano anteriore', panels: ['hood'], prices: [200, 250], family: 'finitura', phase: 'Verniciatura' },
  { id: 'parafango', name: 'Parafango anteriore/posteriore', panels: ['wing'], prices: [150], family: 'finitura', phase: 'Verniciatura' },
  { id: 'coppa-ruota', name: 'Coppa ruota', panels: ['wheel'], prices: [15], family: 'finitura', phase: 'Verniciatura' },
  { id: 'cerchio-ferro', name: 'Cerchio nero lucido (ferro)', panels: ['wheel'], prices: [15], family: 'finitura', phase: 'Verniciatura' },
  { id: 'cerchio-esterno', name: 'Cerchio in lega esterno', panels: ['wheel'], prices: [60], family: 'finitura', phase: 'Verniciatura' },
  { id: 'cerchio-completo', name: 'Cerchio in lega interno + esterno + bilanciatura', panels: ['wheel'], prices: [100], family: 'finitura', phase: 'Verniciatura' },
  { id: 'cerchio-diamantato', name: 'Cerchio diamantato', panels: ['wheel'], prices: [100], family: 'finitura', phase: 'Riparazione cerchi' },
  { id: 'specchio', name: 'Coppa specchio', panels: ['mirror'], prices: [50], family: 'finitura', phase: 'Verniciatura' },
  { id: 'porta', name: 'Porta', panels: ['door'], prices: [150], family: 'finitura', phase: 'Verniciatura' },
  { id: 'sottoporta', name: 'Sottoporta', panels: ['sill'], prices: [150, 170], family: 'finitura', phase: 'Verniciatura' },
  { id: 'maniglia', name: 'Profilo porta/maniglia', panels: ['handle'], prices: [35], family: 'finitura', phase: 'Verniciatura' },
  { id: 'tetto', name: 'Tetto', panels: ['roof'], prices: [300, 350], family: 'finitura', phase: 'Verniciatura' },
  { id: 'montante', name: 'Montante', panels: ['pillar'], prices: [120], family: 'finitura', phase: 'Verniciatura' },
  { id: 'spoiler-tetto', name: 'Spoiler tetto', panels: ['spoiler'], prices: [80], family: 'finitura', phase: 'Verniciatura' },
  { id: 'codolino', name: 'Codolino parafango', panels: ['arch'], prices: [45], family: 'finitura', phase: 'Verniciatura' },
  { id: 'portellone', name: 'Portellone posteriore', panels: ['tailgate'], prices: [150], family: 'finitura', phase: 'Verniciatura' },
  { id: 'profili-paraurti', name: 'Profili/spoiler paraurti', panels: ['bumper-trim'], prices: [65], family: 'finitura', phase: 'Verniciatura' },
  { id: 'paraurti-posteriore', name: 'Paraurti posteriore', panels: ['rear-bumper'], prices: [150], family: 'finitura', phase: 'Verniciatura' },
  { id: 'lucidatura-totale', name: 'Lucidatura totale', panels: ['whole'], prices: [150, 200], family: 'lucidatura', phase: 'Lucidatura' },
  { id: 'lucidatura-fiancate', name: 'Lucidatura fiancate + ritocchi', panels: ['whole'], prices: [80], family: 'lucidatura', phase: 'Lucidatura' },
  { id: 'ritocchi', name: 'Ritocchi', panels: ['whole', 'front-bumper', 'rear-bumper', 'hood', 'wing', 'mirror', 'door', 'sill', 'roof', 'pillar', 'tailgate'], prices: [15], family: 'ritocchi', phase: 'Verniciatura' },
  { id: 'lucidatura-faro', name: 'Lucidatura faro', panels: ['headlight'], prices: [35], family: 'lucidatura', phase: 'Lucidatura' },
  { id: 'sfumatura', name: 'Sfumatura porta/parafango', panels: ['door', 'wing'], prices: [120], family: 'finitura', phase: 'Verniciatura' },
  { id: 'parabrezza', name: 'Sostituzione parabrezza', panels: ['windshield'], prices: [150, 170], family: 'vetri', phase: 'Sostituzione vetri' },
  { id: 'interni-smontaggio', name: 'Lavaggio interni (con smontaggio sedili)', panels: ['whole'], prices: [100], family: 'lavaggio', phase: 'Lavaggio' },
  { id: 'interni', name: 'Lavaggio interni (senza smontaggio sedili)', panels: ['whole'], prices: [50], family: 'lavaggio', phase: 'Lavaggio' },
]

export function eliasPanelKind(id: string): EliasPanelKind | undefined {
  if (id === 'vettura-intera') return 'whole'
  if (id === 'paraurti-anteriore') return 'front-bumper'
  if (id === 'paraurti-posteriore') return 'rear-bumper'
  if (id === 'cofano') return 'hood'
  if (/^(parafango-|rear-fender-)/.test(id)) return 'wing'
  if (id.startsWith('wheel-')) return 'wheel'
  if (id.startsWith('specchio-')) return 'mirror'
  if (id.startsWith('porta-')) return 'door'
  if (id.startsWith('sottoporta-')) return 'sill'
  if (id.startsWith('maniglia-')) return 'handle'
  if (id === 'tetto') return 'roof'
  if (id.startsWith('montante-')) return 'pillar'
  if (id === 'spoiler-tetto') return 'spoiler'
  if (id.startsWith('codolino-')) return 'arch'
  if (id === 'portellone-posteriore') return 'tailgate'
  if (id.startsWith('profilo-paraurti-')) return 'bumper-trim'
  if (id.startsWith('faro-')) return 'headlight'
  if (id === 'parabrezza') return 'windshield'
}

export const eliasPricesForPanel = (id: string) => ELIAS_PRICE_LIST.filter((entry) => entry.panels.includes(eliasPanelKind(id)!))
export const eliasEntryForWork = (workId?: string) => ELIAS_PRICE_LIST.find((entry) => `elias-listino:${entry.id}` === workId)

export function eliasWork(entry: EliasPriceEntry): StandardWorkDefinition {
  return { id: `elias-listino:${entry.id}`, name: entry.name, calculationType: entry.panels[0] === 'whole' ? 'per-vehicle' : 'per-panel',
    standardMinutes: 0, active: true, categoryOrPhase: entry.phase, cycleOrder: entry.phase === 'Lavaggio' ? 80 : entry.phase === 'Lucidatura' ? 70 : 50 }
}
