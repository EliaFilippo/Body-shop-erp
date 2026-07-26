import type { ReactNode } from 'react'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">CARROZZERIA ELIAS</span><h2>{title}</h2></div><button className="close" onClick={onClose}>×</button></div>
      {children}
    </section>
  </div>
}

