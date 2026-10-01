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
  { id: 'tetto', name: 'Tetto', view: 'top', path: 'M30 28 Q50 24 70 28 L67 50 Q50 54 33 50 Z', badgeX: 50, badgeY: 40 },
  { id: 'cofano', name: 'Cofano', view: 'top', path: 'M34 50 Q50 55 66 50 L61 66 Q50 70 39 66 Z', badgeX: 50, badgeY: 60 },
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
]
