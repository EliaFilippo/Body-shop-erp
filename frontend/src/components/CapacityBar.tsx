export function CapacityBar({ percent, overload = 0, kind = 'capacity' }: { percent: number; overload?: number; kind?: 'capacity' | 'goal' }) {
  const width = Math.min(100, Math.max(0, percent))
  const capacityTone = percent > 100 ? 'overloaded' : percent > 85 ? 'warning' : ''
  const goalTone = percent < 100 ? 'below-goal' : ''
  return <div className="capacity-bar">
    <i><b className={kind === 'goal' ? goalTone : capacityTone} style={{ width: `${width}%` }} /></i>
    <span>{Math.round(percent)}%{overload > 0 ? ` · +${overload} h` : ''}</span>
  </div>
}
