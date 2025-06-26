import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    assetsDir: '.', 
    rollupOptions: {
      input: {
        inject: resolve(__dirname, 'src/inject.ts'),
        frame: resolve(__dirname, 'src/Frame/frame.tsx'),
        popup: resolve(__dirname, 'src/auth/index.tsx'),
      },
      output: {
        entryFileNames: '[name].js',        // JS files
        chunkFileNames: '[name].js',        // Chunk files  
        assetFileNames: '[name].[ext]',     // CSS and other assets
      }
    }
  }
})