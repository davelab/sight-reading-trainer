import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Tauri on macOS uses WKWebView (Safari 13+).
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  },
  // Verovio ships its WASM inlined in an ES module; keep it out of dep pre-bundling.
  optimizeDeps: { exclude: ['verovio'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
