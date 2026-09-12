const paths: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  'today-shop': 'M3 4h18v16H3V4Zm4 4h10v2H7V8Zm0 4h7v2H7v-2Zm10 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  vehicles: 'M5 17h14v-5l-2-5H7l-2 5v5Zm0 0v2m14-2v2M7 7l1-3h8l1 3M3 12h18',
  cones: 'M12 2 5 21h14L12 2Zm-3.5 12h7M10 9h4',
  planner: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v15H3V6a2 2 0 0 1 2-2Zm3 10h3v3H8v-3Z',
  'vehicle-statuses': 'M4 6h16v4H4V6Zm0 8h16v4H4v-4Zm2-6h3m-3 8h3M12 8h6M12 16h6',
  'operator-program': 'M4 4h16v16H4V4Zm2 5h12M8 2v4M16 2v4M7 12h3v3H7v-3Zm4 0h3v3h-3v-3Zm4 0h3v3h-3v-3Z',
  'pending-cases': 'M4 5h16v14H4V5Zm3 3h7v2H7V8Zm0 4h10v2H7v-2Zm0 4h6v2H7v-2M17 7v4m0 0h2m-2 0h-2',
  'confirmed-cases': 'M4 5h16v14H4V5Zm3 3h7v2H7V8Zm0 4h10v2H7v-2Zm0 4h6v2H7v-2m9-4 2 2 4-4',
  'estimates-jobs': 'M4 5h16v14H4V5Zm3 3h10M7 10h10M7 13h6M15 4v2M9 4v2',
  'monthly-goals': 'M4 4h16v16H4zM8 16l2-2 2 2 4-4M8 8h8',
  'database-diagnostics': 'M4 5h16v14H4V5Zm3 3h10v2H7V8Zm0 4h6v2H7v-2Zm8 0h2v2h-2v-2M9 3h6v2H9V3Z',
  settings: 'M12 3v2M12 19v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M3 12h2M19 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
  search: 'M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 6h16M4 12h16M4 18h16',
}

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>
}
