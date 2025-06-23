import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    assetsDir: '.', // flatten assets to avoid /assets/ nesting
    rollupOptions: {
      input: {
        inject: resolve(__dirname, 'src/inject.ts'),
        frame: resolve(__dirname, 'src/frame.tsx'),
      },
      output: {
        entryFileNames: '[name].js', // no hash in filename
      }
    }
  }
})
