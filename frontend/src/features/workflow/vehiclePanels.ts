export type VehicleViewId = 'top' | 'left' | 'right'

export type ExplodedPanelDefinition = {
  id: string
  name: string
  view: VehicleViewId
  path: string
  badgeX: number
  badgeY: number
}

export const PANEL_CATALOG: ExplodedPanelDefinition[] = [
  { id: 'paraurti-posteriore', name: 'Paraurti posteriore', view: 'top', path: 'M36 8 Q50 3 64 8 L60 13 Q50 10 40 13 Z', badgeX: 50, badgeY: 7 },
  { id: 'portellone-posteriore', name: 'Portellone/cofano posteriore', view: 'top', path: 'M31 13 Q50 7 69 13 L64 27 Q50 23 36 27 Z', badgeX: 50, badgeY: 18 },
  { id: 'tetto', name: 'Tetto', view: 'top', path: 'M34 28 Q50 25 66 28 L64 43 Q50 47 36 43 Z', badgeX: 50, badgeY: 36 },
  { id: 'cofano', name: 'Cofano', view: 'top', path: 'M34 54 Q50 57 66 54 L61 66 Q50 70 39 66 Z', badgeX: 50, badgeY: 60 },
  { id: 'paraurti-anteriore', name: 'Paraurti anteriore', view: 'top', path: 'M39 66 Q50 71 61 66 L58 73 Q50 76 42 73 Z', badgeX: 50, badgeY: 71 },
  { id: 'parafango-ant-sx', name: 'Parafango anteriore SX', view: 'left', path: 'M16 46 L24 34 L31 35 L29 49 L22 55 L16 54 Z', badgeX: 22, badgeY: 43 },
  { id: 'porta-ant-sx', name: 'Porta anteriore SX', view: 'left', path: 'M31 35 L46 35 L46 57 L30 57 Z', badgeX: 38, badgeY: 45 },
  { id: 'porta-post-sx', name: 'Porta posteriore SX', view: 'left', path: 'M46 35 L60 35 L61 57 L46 57 Z', badgeX: 53, badgeY: 45 },
  { id: 'montante-sup-sx', name: 'Montante superiore SX', view: 'left', path: 'M34 33 L62 33 L66 35 L40 35 Z', badgeX: 50, badgeY: 31 },
  { id: 'sottoporta-sx', name: 'Sottoporta SX', view: 'left', path: 'M30 57 L63 57 L61 62 L32 62 Z', badgeX: 47, badgeY: 60 },
  { id: 'rear-fender-left', name: 'Parafango posteriore SX', view: 'left', path: 'M72 46 L80 41 L84 50 L80 58 L71 58 L69 51 Z', badgeX: 77, badgeY: 51 },
  { id: 'wheel-front-sx', name: 'Cerchio anteriore SX', view: 'left', path: 'M22 61 A6 6 0 1 0 34 61 A6 6 0 1 0 22 61 Z', badgeX: 28, badgeY: 65 },
  { id: 'wheel-rear-sx', name: 'Cerchio posteriore SX', view: 'left', path: 'M66 61 A6 6 0 1 0 78 61 A6 6 0 1 0 66 61 Z', badgeX: 72, badgeY: 65 },
  { id: 'parafango-ant-dx', name: 'Parafango anteriore DX', view: 'right', path: 'M84 46 L76 34 L69 35 L71 49 L78 55 L84 54 Z', badgeX: 78, badgeY: 43 },
  { id: 'porta-ant-dx', name: 'Porta anteriore DX', view: 'right', path: 'M69 35 L54 35 L54 57 L70 57 Z', badgeX: 62, badgeY: 45 },
  { id: 'porta-post-dx', name: 'Porta posteriore DX', view: 'right', path: 'M54 35 L40 35 L39 57 L54 57 Z', badgeX: 47, badgeY: 45 },
  { id: 'montante-sup-dx', name: 'Montante superiore DX', view: 'right', path: 'M66 33 L38 33 L34 35 L60 35 Z', badgeX: 50, badgeY: 31 },
  { id: 'sottoporta-dx', name: 'Sottoporta DX', view: 'right', path: 'M70 57 L37 57 L39 62 L68 62 Z', badgeX: 53, badgeY: 60 },
  { id: 'rear-fender-right', name: 'Parafango posteriore DX', view: 'right', path: 'M28 46 L20 41 L16 50 L20 58 L29 58 L31 51 Z', badgeX: 23, badgeY: 51 },
  { id: 'wheel-front-dx', name: 'Cerchio anteriore DX', view: 'right', path: 'M66 61 A6 6 0 1 0 78 61 A6 6 0 1 0 66 61 Z', badgeX: 72, badgeY: 65 },
  { id: 'wheel-rear-dx', name: 'Cerchio posteriore DX', view: 'right', path: 'M22 61 A6 6 0 1 0 34 61 A6 6 0 1 0 22 61 Z', badgeX: 28, badgeY: 65 },
  { id: 'parabrezza', name: 'Parabrezza', view: 'top', path: 'M36 44 Q50 48 64 44 L67 52 Q50 56 33 52 Z', badgeX: 50, badgeY: 50 },
  { id: 'spoiler-tetto', name: 'Spoiler tetto', view: 'top', path: 'M32 24 Q50 20 68 24 L68 27 Q50 23 32 27 Z', badgeX: 50, badgeY: 25 },
  { id: 'profilo-paraurti-ant', name: 'Profili/spoiler paraurti anteriore', view: 'top', path: 'M42 73 Q50 76 58 73 L57 76 Q50 79 43 76 Z', badgeX: 50, badgeY: 75 },
  { id: 'profilo-paraurti-post', name: 'Profili/spoiler paraurti posteriore', view: 'top', path: 'M37 5 Q50 1 63 5 L64 8 Q50 4 36 8 Z', badgeX: 50, badgeY: 5 },
  { id: 'faro-sx', name: 'Faro anteriore SX', view: 'top', path: 'M29 59 L34 58 L38 65 L32 66 Z', badgeX: 33, badgeY: 62 },
  { id: 'faro-dx', name: 'Faro anteriore DX', view: 'top', path: 'M71 59 L66 58 L62 65 L68 66 Z', badgeX: 67, badgeY: 62 },
  { id: 'specchio-sx', name: 'Specchio SX', view: 'left', path: 'M29 34 L33 32 L36 34 L35 38 L30 38 Z', badgeX: 32, badgeY: 35 },
  { id: 'specchio-dx', name: 'Specchio DX', view: 'right', path: 'M71 34 L67 32 L64 34 L65 38 L70 38 Z', badgeX: 68, badgeY: 35 },
  { id: 'maniglia-ant-sx', name: 'Profilo/maniglia porta anteriore SX', view: 'left', path: 'M40 39 L44 39 L44 41 L40 41 Z', badgeX: 42, badgeY: 40 },
  { id: 'maniglia-post-sx', name: 'Profilo/maniglia porta posteriore SX', view: 'left', path: 'M54 39 L58 39 L58 41 L54 41 Z', badgeX: 56, badgeY: 40 },
  { id: 'maniglia-ant-dx', name: 'Profilo/maniglia porta anteriore DX', view: 'right', path: 'M56 39 L60 39 L60 41 L56 41 Z', badgeX: 58, badgeY: 40 },
  { id: 'maniglia-post-dx', name: 'Profilo/maniglia porta posteriore DX', view: 'right', path: 'M42 39 L46 39 L46 41 L42 41 Z', badgeX: 44, badgeY: 40 },
  { id: 'codolino-ant-sx', name: 'Codolino parafango anteriore SX', view: 'left', path: 'M19 61 A9 9 0 0 1 37 61 L35 61 A7 7 0 0 0 21 61 Z', badgeX: 28, badgeY: 53 },
  { id: 'codolino-post-sx', name: 'Codolino parafango posteriore SX', view: 'left', path: 'M63 61 A9 9 0 0 1 81 61 L79 61 A7 7 0 0 0 65 61 Z', badgeX: 72, badgeY: 53 },
  { id: 'codolino-ant-dx', name: 'Codolino parafango anteriore DX', view: 'right', path: 'M63 61 A9 9 0 0 1 81 61 L79 61 A7 7 0 0 0 65 61 Z', badgeX: 72, badgeY: 53 },
  { id: 'codolino-post-dx', name: 'Codolino parafango posteriore DX', view: 'right', path: 'M19 61 A9 9 0 0 1 37 61 L35 61 A7 7 0 0 0 21 61 Z', badgeX: 28, badgeY: 53 },
]

export const QUOTE_PANELS = [...PANEL_CATALOG, { id: 'vettura-intera', name: 'Vettura intera / interni', view: 'top' as const, path: '', badgeX: 50, badgeY: 40 }]
