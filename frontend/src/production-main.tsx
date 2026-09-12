import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './polyfills/randomUuid'
import './index.css'
import { ProductionPage } from './features/production/ProductionPage'

createRoot(document.getElementById('root')!).render(<StrictMode><ProductionPage /></StrictMode>)
