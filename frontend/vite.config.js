import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/chat': 'http://localhost:8000',
      '/upload': 'http://localhost:8000',
      '/files': 'http://localhost:8000',
      '/env.js': 'http://localhost:8000',
    },
  },
})
