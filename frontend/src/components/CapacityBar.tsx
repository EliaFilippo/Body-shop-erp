export function CapacityBar({ percent, overload = 0 }: { percent: number; overload?: number }) {
  const width = Math.min(100, Math.max(0, percent))
  return <div className="capacity-bar">
    <i><b className={percent > 100 ? 'overloaded' : percent > 85 ? 'warning' : ''} style={{ width: `${width}%` }} /></i>
    <span>{Math.round(percent)}%{overload > 0 ? ` · +${overload} h` : ''}</span>
  </div>
}
