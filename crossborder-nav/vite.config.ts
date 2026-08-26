import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base 用部署子路径绝对值：详情页路由 /nav/platform/xxx 下相对 base 会让入口资源 404
// 将来升级域名根部署时改回 '/' 即可
export default defineConfig({
  base: '/nav/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    // 不生成 index.html 的 meta 注入（保持纯净）
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 把 logo 等静态资源分块，nginx 缓存友好
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
})
