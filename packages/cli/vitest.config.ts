import { defineConfig } from 'vitest/config'
// passWithNoTests: package scaffolded ahead of its test suites (phase 8); keeps `pnpm -r test` green.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], passWithNoTests: true } })
