import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import { FinancePage } from './features/finance/FinancePage'
import { loadDatabase, saveDatabase } from './services/database'
import { emptyData } from './services/erp'
import type { ErpData } from './types'

function FinanceApp() {
  const [data, setData] = useState<ErpData>(emptyData)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    loadDatabase()
      .then(setData)
      .catch((problem) => setError(problem instanceof Error ? problem.message : 'Impossibile caricare il database.'))
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!ready) return
    void saveDatabase(data).catch((problem) => setError(problem instanceof Error ? problem.message : 'Impossibile salvare i dati.'))
  }, [data, ready])

  const customerById = (customerId: string) => data.customers.find((customer) => customer.id === customerId)

  return <div className="app-shell finance-standalone">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">E</div><div><strong>ELIAS</strong><span>BODY SHOP ERP</span></div></div>
      <nav>
        <a className="active" href="/finance.html"><span>Cruscotto finanziario</span></a>
        <a href="/"><span>Torna al gestionale</span></a>
      </nav>
      <div className="sidebar-foot"><span className="online-dot" /> {ready ? 'Archivio pronto' : 'Caricamento archivio'}</div>
    </aside>
    <main>
      <header><div><span className="eyebrow">CONTROLLO AMMINISTRATIVO</span><h1>Cruscotto finanziario</h1></div><div className="avatar">FE</div></header>
      {error && <div className="toast error">{error}<button onClick={() => setError('')}>×</button></div>}
      {notice && <div className="toast success">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      <div className="content">
        <FinancePage data={data} onChange={setData} customerById={customerById} setError={setError} setNotice={setNotice} />
      </div>
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><FinanceApp /></StrictMode>)
