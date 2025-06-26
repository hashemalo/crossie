import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    assetsDir: '.', 
    target: 'es2020',
    rollupOptions: {
      input: {
        inject: resolve(__dirname, 'src/inject.ts'),
        frame: resolve(__dirname, 'src/Frame/frame.tsx'),
        popup: resolve(__dirname, 'src/auth/index.tsx'),
      },
      output: {
        format: 'es', // Change to 'es' or 'cjs'
        entryFileNames: '[name].js',        
        chunkFileNames: '[name].js',        
        assetFileNames: '[name].[ext]',
      },
      external: ['chrome'],
    }
  }
})