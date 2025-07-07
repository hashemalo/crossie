import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        inject: resolve(__dirname, 'src/inject.ts'),
        frame: resolve(__dirname, 'src/Frame/frame.tsx'),
        popup: resolve(__dirname, 'src/auth/index.tsx'),
        background: resolve(__dirname, 'src/background.js'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
})