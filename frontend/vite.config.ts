import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { documentIdentityOcrPlugin } from './server/viteOcrPlugin.js'

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/Body-shop-erp/' : '/',
  plugins: [react(), documentIdentityOcrPlugin()],
  build: { rollupOptions: { input: { main: 'index.html', production: 'production.html' } } },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
})
