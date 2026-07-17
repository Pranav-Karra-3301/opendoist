#!/usr/bin/env node
/**
 * Bundle budget gate (phase 10, Task I). Gzips every JS chunk emitted to the web app's
 * `dist/assets`, prints a per-chunk table, and fails the build if the app JS grows past budget:
 *   - total gzipped JS  > 900 KB, or
 *   - any single chunk   > 400 KB gzipped.
 *
 * Run after building the web app:  pnpm --filter @opendoist/web build && pnpm check:bundle
 * The service worker (dist/sw.js, outside assets/) is intentionally excluded — it is precached and
 * versioned separately, not part of the initial app payload.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ASSETS_DIR = fileURLToPath(new URL('../apps/web/dist/assets', import.meta.url))
const TOTAL_BUDGET_BYTES = 900 * 1024
const CHUNK_BUDGET_BYTES = 400 * 1024

/** Bytes → KB with one decimal. */
function kb(bytes) {
  return (bytes / 1024).toFixed(1)
}

let files
try {
  files = readdirSync(ASSETS_DIR).filter((name) => name.endsWith('.js'))
} catch {
  console.error(
    `check-bundle: ${ASSETS_DIR} not found — run \`pnpm --filter @opendoist/web build\` first`,
  )
  process.exit(1)
}

if (files.length === 0) {
  console.error(`check-bundle: no .js chunks in ${ASSETS_DIR}`)
  process.exit(1)
}

const rows = files
  .map((file) => {
    const raw = readFileSync(new URL(`../apps/web/dist/assets/${file}`, import.meta.url))
    const gzip = gzipSync(raw, { level: 9 })
    return { file, raw: raw.length, gzip: gzip.length }
  })
  .sort((a, b) => b.gzip - a.gzip)

const totalGzip = rows.reduce((sum, r) => sum + r.gzip, 0)

const nameWidth = Math.max(5, ...rows.map((r) => r.file.length))
const header = `${'chunk'.padEnd(nameWidth)}  ${'raw KB'.padStart(8)}  ${'gzip KB'.padStart(8)}`
console.log(header)
console.log('-'.repeat(header.length))
for (const r of rows) {
  const flag = r.gzip > CHUNK_BUDGET_BYTES ? '  <- over chunk budget' : ''
  console.log(
    `${r.file.padEnd(nameWidth)}  ${kb(r.raw).padStart(8)}  ${kb(r.gzip).padStart(8)}${flag}`,
  )
}
console.log('-'.repeat(header.length))
console.log(`${'TOTAL'.padEnd(nameWidth)}  ${''.padStart(8)}  ${kb(totalGzip).padStart(8)}`)

const failures = []
for (const r of rows) {
  if (r.gzip > CHUNK_BUDGET_BYTES) {
    failures.push(`chunk ${r.file} is ${kb(r.gzip)} KB gzip (budget ${kb(CHUNK_BUDGET_BYTES)} KB)`)
  }
}
if (totalGzip > TOTAL_BUDGET_BYTES) {
  failures.push(`total JS is ${kb(totalGzip)} KB gzip (budget ${kb(TOTAL_BUDGET_BYTES)} KB)`)
}

if (failures.length > 0) {
  console.error('\nbundle FAILED:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(`\nbundle OK: ${kb(totalGzip)} KB gzip total`)
