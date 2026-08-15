/**
 * The pictures on the website still come out of the rig that draws her.
 *
 * `site/art/*.png` is COMMITTED, because the site may end up published from a
 * repository that does not contain this source — and a public repo cannot
 * regenerate art from a private rig. Committed art is art that can go stale,
 * and stale art here has a specific cost: the website advertises a character
 * the download does not contain.
 *
 * So the same guard `tray-icon.test.ts` puts on the icons goes here. It runs
 * the generator for real and compares bytes, which works because the generator
 * is deterministic by construction: fixed frame count, fixed timestep, pinned
 * random. Verified — two runs produce identical SHA-256 for every file.
 *
 * This file lives beside the rig rather than beside the script, because what it
 * actually protects is the rig-to-website link: touching `geometry.ts`,
 * `face.ts` or `looks.ts` is what makes it fail.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEME_IDS } from '@shared/theme'
import { PHASES } from '@shared/posture'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const COMMITTED = join(ROOT, 'site/art')

function digest(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

describe('the website art', () => {
  it('has a picture for every colour a persona can be', () => {
    // A theme added to `THEME_IDS` and not to the site is a swatch the product
    // has and the page does not — the drift this test is cheapest at catching,
    // and the only one that does not need the generator to run.
    for (const theme of THEME_IDS) {
      expect(existsSync(join(COMMITTED, `theme-${theme}.png`)), `theme-${theme}.png`).toBe(true)
    }
  })

  it('has a picture for every phase the lifecycle assigns', () => {
    // Walked from `PHASES`, not listed. The previous version listed four names
    // by hand and two of them were faces the app never wears -- `thinking`,
    // which nothing has ever set, and a `happy` "talking" when she is neutral
    // for the whole of `awake`.
    for (const phase of PHASES) {
      expect(existsSync(join(COMMITTED, `mochi-${phase}.png`)), `mochi-${phase}.png`).toBe(true)
    }
    // Plus the one picture that is not a phase: `awake` with a mouth the audio
    // envelope opened.
    expect(existsSync(join(COMMITTED, 'mochi-talking.png'))).toBe(true)
  })

  /**
   * The page and the directory agree, in both directions.
   *
   * This is the guard for what actually went wrong: the generator stopped
   * producing `mochi-thinking.png` and `mochi-hero.png`, the old files stayed
   * on disk because it only ever added, and the page went on referencing them.
   * Every individual check passed. Only the correspondence was broken.
   */
  it('is exactly what the page asks for, no more and no less', () => {
    const html = readFileSync(join(ROOT, 'site/index.html'), 'utf8')
    const asked = new Set([...html.matchAll(/\.\/art\/([a-z0-9.-]+\.png)/g)].map((m) => m[1]!))
    const present = new Set(readdirSync(COMMITTED).filter((name) => name.endsWith('.png')))

    const missing = [...asked].filter((name) => !present.has(name)).sort()
    const unused = [...present].filter((name) => !asked.has(name)).sort()
    expect(missing, 'the page references art that is not there').toEqual([])
    expect(unused, 'art nothing on the page uses — a stale file from an older run').toEqual([])
  })

  /**
   * Run `pnpm site:art` for real, into a temporary directory, and diff.
   *
   * Slow-ish and budgeted for: it bundles the rig and rasterises twelve frames
   * of her, a hundred and twenty renders each.
   */
  it('is still what the rig produces today', { timeout: 120_000 }, () => {
    const out = mkdtempSync(join(tmpdir(), 'mochi-site-art-'))
    try {
      const result = spawnSync('pnpm', ['site:art'], {
        cwd: ROOT,
        env: { ...process.env, MOCHI_SITE_OUT: out },
        encoding: 'utf8',
        timeout: 110_000,
      })
      expect(result.status, `generator failed:\n${result.stderr}`).toBe(0)

      const fresh = readdirSync(out)
        .filter((name) => name.endsWith('.png'))
        .sort()
      // No exceptions. `icon.png` used to be copied in by hand and excluded
      // here; the generator owns the whole directory now, which is what lets it
      // EMPTY the directory first — and emptying is what stops a file outliving
      // the run that stopped producing it.
      const committed = readdirSync(COMMITTED)
        .filter((name) => name.endsWith('.png'))
        .sort()
      expect(committed, 'the committed set and the generated set differ').toEqual(fresh)

      const stale = fresh.filter(
        (name) => digest(join(out, name)) !== digest(join(COMMITTED, name)),
      )
      expect(
        stale,
        `these are out of date — run \`pnpm site:art\` and commit: ${stale.join(', ')}`,
      ).toEqual([])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
