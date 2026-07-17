import { mkdir, readFile } from 'node:fs/promises'
import sharp from 'sharp'

const OUT = 'apps/web/public/icons'
const BRAND_GREEN = '#3e6737'
const svg = await readFile('assets/brand/icon.svg', 'utf8')
const tinted = (color) => Buffer.from(svg.replace(/currentColor/g, color))
await mkdir(OUT, { recursive: true })

/** any-purpose: green glyph, transparent bg, 12% padding */
async function anyIcon(size, file) {
  const glyph = await sharp(tinted(BRAND_GREEN))
    .resize(Math.round(size * 0.76))
    .png()
    .toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: glyph, gravity: 'centre' }])
    .png()
    .toFile(`${OUT}/${file}`)
}
/** maskable: white glyph at 62% inside full-bleed brand-green square (80% safe zone) */
async function maskableIcon(size, file) {
  const glyph = await sharp(tinted('#ffffff'))
    .resize(Math.round(size * 0.62))
    .png()
    .toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: BRAND_GREEN } })
    .composite([{ input: glyph, gravity: 'centre' }])
    .png()
    .toFile(`${OUT}/${file}`)
}
/** apple-touch: white bg (iOS shows black behind transparency), green glyph */
async function appleIcon() {
  const glyph = await sharp(tinted(BRAND_GREEN)).resize(126).png().toBuffer()
  await sharp({ create: { width: 180, height: 180, channels: 4, background: '#ffffff' } })
    .composite([{ input: glyph, gravity: 'centre' }])
    .png()
    .toFile(`${OUT}/apple-touch-icon.png`)
}
await anyIcon(192, 'icon-192.png')
await anyIcon(512, 'icon-512.png')
await maskableIcon(192, 'maskable-192.png')
await maskableIcon(512, 'maskable-512.png')
await appleIcon()
console.log('icons written to', OUT)
