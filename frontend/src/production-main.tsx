import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './polyfills/randomUuid'
import './index.css'
import { LiveProductionPage } from './features/production/LiveProductionPage'

createRoot(document.getElementById('root')!).render(<StrictMode><LiveProductionPage /></StrictMode>)
