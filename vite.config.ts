import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 构建水印用本地墙钟：toISOString 是 UTC，中国用户看到会比现在慢 8 小时（2026-11-07 用户报错）
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const localStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`

export default defineConfig({
  base: './',
  plugins: [react()],
  root: 'src/renderer',
  define: {
    __BUILD_STAMP__: JSON.stringify(localStamp)
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true
  }
})
