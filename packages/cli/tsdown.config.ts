import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  // bin/Docker/Task N contract is dist/index.js; platform:'node' would otherwise force .mjs
  fixedExtension: false,
})
