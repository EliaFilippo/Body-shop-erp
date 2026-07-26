import type { TrafficStatus } from '../services/planner'

const labels: Record<TrafficStatus, string> = {
  green: 'Consegna realistica',
  yellow: 'Margine ridotto',
  red: 'Data non rispettabile',
  neutral: 'Da valutare',
}

export function TrafficLight({ status }: { status: TrafficStatus }) {
  return <span className={`traffic traffic-${status}`}><i />{labels[status]}</span>
}
