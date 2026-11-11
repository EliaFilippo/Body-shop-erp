export function VehiclePresenceButton({ present, onChange }: { present: boolean; onChange: (present: boolean) => void }) {
  return <button type="button" className={present ? 'primary' : 'secondary'} aria-pressed={present}
    onClick={() => onChange(!present)}>
    Auto presente in carrozzeria · {present ? 'Sì' : 'No'}
  </button>
}
