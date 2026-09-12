import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { documentIdentityOcrPlugin } from './server/viteOcrPlugin.js'

export default defineConfig({
  plugins: [react(), documentIdentityOcrPlugin()],
})
