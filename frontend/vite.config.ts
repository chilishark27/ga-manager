import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const electronPkg = JSON.parse(readFileSync(resolve(__dirname, '../electron/package.json'), 'utf-8'))

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(electronPkg.version),
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:18600',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:18600',
        ws: true,
      },
    },
  },
})
