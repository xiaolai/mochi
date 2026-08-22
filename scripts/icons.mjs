/**
 * Every shipped icon, from one shape.
 *
 * ## What this replaces
 *
 * `electron-builder.yml` has said it since the rewrite: *"the generator that
 * produced them did not survive the rewrite, so `resources/` is
 * hand-maintained"*. Thirty-two PNGs, no vector source, and a claim in the
 * handoff that the mark and the mochi "cannot drift" which
 * `shipped-icons.test.ts` demoted to *"not true, merely unfalsified"*.
 *
 * This is the generator. Every asset below is rasterised from an SVG emitted by
 * `rig/svg.ts`, which builds its outline with `domeOutline` — the same function
 * `paint` calls sixty times a second to draw her on screen.
 *
 * ## Run it
 *
 *   pnpm icons            # write resources/
 *   pnpm icons:check      # write nothing; fail if what is on disk has drifted
 *
 * ## Loading the rig from a plain script
 *
 * The whole point is that this imports the geometry that DRAWS her, and that
 * module is TypeScript with extensionless imports and an `@shared` alias —
 * neither of which plain Node resolves. Rather than add a runner, this uses
 * Vite's own `ssrLoadModule`: `vite` is already a dependency (electron-vite and
 * Vitest are both built on it), and this is its public API for exactly this.
 * The alias is declared here rather than read from a config so the script says
 * what it needs instead of inheriting it.
 *
 * `--check` is what CI wants and what `icons.test.ts` uses: regenerating in a
 * test would make the test pass by overwriting the thing it is checking.
 *
 * ## No new dependency
 *
 * `@napi-rs/canvas` is already here for the rig's own tests and it rasterises
 * SVG. A dedicated rasteriser (`sharp`, `resvg-js`) would be a second image
 * stack in a repository that already has one, for output this size.
 *
 * ## The numbers are MEASURED, not chosen
 *
 * Every treatment below — the greens, the gradient stops, the fraction of the
 * square she fills — was sampled off the artwork that shipped, so running this
 * reproduces the existing icons rather than redesigning them. Where a number
 * looks arbitrary it is because the artwork was.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const RESOURCES = join(ROOT, 'resources')
const CHECK = process.argv.includes('--check')

const vite = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  resolve: { alias: { '@shared': join(ROOT, 'src/shared') } },
})
const { MOCHI } = await vite.ssrLoadModule('/src/shared/avatar-spec.ts')
const { mochiSvg } = await vite.ssrLoadModule('/src/renderer/companion/rig/svg.ts')
const { ICON_SET } = await vite.ssrLoadModule('/src/renderer/companion/rig/icons.ts')

/**
 * One asset, as PNG bytes.
 *
 * Rasterised at the size it ships at rather than downscaled from a big one.
 * Antialiasing a 1024px dome down to 16 and rendering the dome at 16 are
 * different pictures, and the second is the one that keeps its shoulders.
 */
async function render(entry) {
  const svg = mochiSvg(MOCHI, entry.px, entry.treatment)
  const image = await loadImage(Buffer.from(svg))
  const canvas = createCanvas(entry.px, entry.px)
  canvas.getContext('2d').drawImage(image, 0, 0, entry.px, entry.px)
  return canvas.toBuffer('image/png')
}

let drifted = 0
let wrote = 0

for (const entry of ICON_SET) {
  const path = join(RESOURCES, entry.file)
  const bytes = await render(entry)

  if (CHECK) {
    let existing = null
    try {
      existing = await readFile(path)
    } catch {
      /* absent counts as drifted */
    }
    if (existing === null || !existing.equals(bytes)) {
      console.error(`  DRIFTED  ${entry.file}`)
      drifted += 1
    }
    continue
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  wrote += 1
}

if (CHECK) {
  if (drifted > 0) {
    console.error(
      `\n${String(drifted)} of ${String(ICON_SET.length)} assets differ. Run \`pnpm icons\`.`,
    )
    process.exit(1)
  }
  console.log(`all ${String(ICON_SET.length)} assets match the generator`)
} else {
  console.log(`wrote ${String(wrote)} assets to resources/`)
}

await vite.close()
