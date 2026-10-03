import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  root: 'src/renderer',
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' '))
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true
  }
})
