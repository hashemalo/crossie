// build.js - Custom build script to handle different formats
import { build } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function buildExtension() {
  console.log('Building Chrome Extension...');

  // Build the content script as IIFE (non-module)
  console.log('Building content script...');
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/inject.ts'),
        name: 'CrossieInject',
        formats: ['iife'],
        fileName: () => 'inject.js'
      },
      rollupOptions: {
        output: {
          extend: true,
        }
      }
    }
  });

  // Build the rest of the extension (React components, background)
  console.log('Building extension pages...');
  await build({
    configFile: resolve(__dirname, 'vite.config.ts'),
  });

  console.log('Build complete!');
}

buildExtension().catch(console.error);