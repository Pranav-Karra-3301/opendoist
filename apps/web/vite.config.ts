import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // injectManifest: we own the static public/manifest.webmanifest (Task A) and register
    // the worker ourselves (src/pwa/register.ts); the plugin only compiles src/sw.ts →
    // dist/sw.js and injects the precache manifest. Disabled in dev (no worker there).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      // Second entry (desktop Task A): the Tauri Quick Add popover window loads
      // quickadd.html; the web deployment simply never links to it.
      input: { main: 'index.html', quickadd: 'quickadd.html' },
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:7968' },
    // phase 9: What's New imports the repo-root CHANGELOG.md via `?raw`
    fs: { allow: ['../..'] },
  },
})
