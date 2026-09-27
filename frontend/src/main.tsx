import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './polyfills/randomUuid'
import './index.css'
import App from './App.tsx'
import { installFinanceNavigation } from './features/finance/installFinanceNavigation'
import { installProductionNavigation } from './features/production/installProductionNavigation'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

installFinanceNavigation()
installProductionNavigation()
