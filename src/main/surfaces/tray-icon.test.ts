import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { MOCHI } from '@shared/avatar-spec'
import { contrast, parseHex, toHex, type Rgb } from '../../renderer/design/accent'

// `tray.ts` is imported for ONE constant -- the Windows scale table -- and it
// reaches for electron at module load. Mocked rather than duplicating the
// table here, because a second copy is exactly the drift this asserts against.
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  Tray: class {},
  app: { getName: () => 'mochi', isPackaged: false },
  nativeImage: { createFromPath: vi.fn() },
  nativeTheme: { on: vi.fn(), removeListener: vi.fn(), shouldUseDarkColors: false },
}))

const { WINDOWS_SCALES } = await import('./tray')

/**
 * The generated assets `tray.ts` loads, measured as files.
 *
 * Not the generator's arithmetic -- the generator is what was wrong. Its inset
 * was applied to the height alone, and she is 1.28 times wider than she is
 * tall, so the tray mark reached 95% of its box (no optical margin at all,
 * beside system glyphs that all have one) and the app icon at inset 0.82 was
 * being CLIPPED at both sides, in every size, without a word from anything.
 *
 * A PNG cannot be reasoned into agreeing with the code that wrote it, which is
 * the property that makes this worth asserting here. It also catches the OTHER
 * failure in this area: an icon left stale after her body was retuned, which
 * the aspect-ratio check below is what notices.
 */

const asset = (name: string): string =>
  fileURLToPath(new URL(`../../../resources/${name}`, import.meta.url))

interface Bounds {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

/** The opaque extent of a PNG, in pixels. */
async function boundsOf(path: string): Promise<{ size: number; bounds: Bounds }> {
  const image = await loadImage(path)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, image.width, image.height)

  let minX = image.width
  let maxX = -1
  let minY = image.height
  let maxY = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      // 128, the same threshold the silhouette comparison uses: an antialiased
      // edge fades over about a pixel, and counting its faintest tail as solid
      // would report a margin one pixel smaller than the eye sees.
      if ((data[(y * image.width + x) * 4 + 3] ?? 0) <= 128) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  expect(maxX, `${path} has no opaque pixels`).toBeGreaterThan(-1)
  return {
    size: image.width,
    bounds: {
      left: minX,
      right: image.width - 1 - maxX,
      top: minY,
      bottom: image.height - 1 - maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
  }
}

describe('the generated icons', () => {
  /**
   * Room on all four sides of the menu-bar mark.
   *
   * 9% is below the 13% the current inset produces and well above the ~2% a
   * single antialiased pixel accounts for at 44px, so it fails on a mark that
   * has grown back toward its box and not on a rounding difference.
   */
  it.each(['trayTemplate@2x.png', 'tray@2x.png'])('leaves %s room to breathe', async (name) => {
    const { size, bounds } = await boundsOf(asset(`tray/${name}`))
    for (const [side, margin] of Object.entries({
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
    })) {
      expect(margin / size, `${name}: ${side} margin`).toBeGreaterThan(0.09)
    }
  })

  it('fills the app icon canvas edge to edge, because macOS masks it itself', async () => {
    // The rule that governs how she looks in the Dock, and it is the OPPOSITE
    // of the one this test used to assert.
    //
    // macOS 26 puts any icon that is "not already a squircle" inside a grey
    // squircle of its own, shrinking the artwork to fit. Her silhouette alone
    // on a transparent square is exactly that case, so she shipped as a small
    // green blob on a grey tile beside every other app's edge-to-edge icon.
    // Apple's instruction for the layered format states the same rule from the
    // other side: do not export the canvas mask, the system applies it.
    //
    // So: opaque in all four corners, no transparent border, and NO rounded
    // rectangle of our own — that would be masked again and read as a tile
    // inside a tile.
    for (const size of [16, 256, 1024]) {
      const image = await loadImage(asset(`icons/${size}x${size}.png`))
      const canvas = createCanvas(image.width, image.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const alphaAt = (x: number, y: number): number => ctx.getImageData(x, y, 1, 1).data[3] ?? 0
      const last = image.width - 1
      for (const [x, y] of [
        [0, 0],
        [last, 0],
        [0, last],
        [last, last],
        [Math.floor(last / 2), 0],
      ]) {
        expect(alphaAt(x ?? 0, y ?? 0), `${size}px at ${x},${y} is not opaque`).toBe(255)
      }
    }
  })

  it('stands her off her own tile, which paper is the hard direction for', async () => {
    // The tile is paper now, and her green is a PALE one: #8ec8a8 on #f3f2f2
    // measures 1.71:1, the same smudge the light Windows taskbar produces. So
    // the generator darkens her, and this is the check that the darkening
    // actually happened and is still enough.
    //
    // WCAG 1.4.11's 3:1 for a graphical object, stated here independently of
    // the constant that implements it -- a guard that reads its own target from
    // the code it guards is a guard that agrees with any value.
    //
    // Sampled where she SITS, not against the nominal paper: the tile carries a
    // wash down it, so the background behind her is darker than its top stop.
    // Correcting against the top stop alone put her at 3.01:1 at 16px.
    for (const size of [16, 256, 1024]) {
      const image = await loadImage(asset(`icons/${size}x${size}.png`))
      const canvas = createCanvas(image.width, image.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const at = (x: number, y: number): Rgb => {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
        return { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0 }
      }
      // Her middle, and the tile just below her -- she rests above the lower
      // edge, so this is paper at its darkest rather than at its nominal value.
      const her = at(image.width / 2, image.height / 2)
      const behind = at(image.width / 2, image.height - Math.max(2, image.height * 0.03))
      expect(
        contrast(her, behind),
        `${size}px: ${toHex(her)} on ${toHex(behind)} is a smudge`,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('paints the tile in the paper the app itself uses', async () => {
    // ONE source for the colour, across a boundary that cannot be imported: the
    // generator is a Node script and `--paper` lives in a stylesheet, so the
    // value is written out in `make-icons.ts` and this compares the SHIPPED
    // PIXEL against the token. That is the arrangement the old "sampled from
    // the icon" constants lacked, and being noticeable only by eye is how they
    // rotted.
    const css = readFileSync(
      fileURLToPath(new URL('../../renderer/design/tokens.css', import.meta.url)),
      'utf8',
    )
    const declared = /--paper:\s*light-dark\(\s*(#[0-9a-f]{6})\s*,/i.exec(css)
    expect(declared, '--paper is not a light-dark() pair any more').not.toBeNull()
    const paper = parseHex(declared![1]!)
    expect(paper).not.toBeNull()

    // The tile's TOP, where the wash is at its first stop and therefore exactly
    // the token. A few pixels in, because the squircle's edge is antialiased.
    const image = await loadImage(asset('icons/dock.png'))
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const pad = (image.width * (1 - 824 / 1024)) / 2
    const d = ctx.getImageData(Math.round(image.width / 2), Math.round(pad + 4), 1, 1).data
    const top = { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0 }
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(
        Math.abs(top[channel] - paper![channel]),
        `tile is ${toHex(top)}, --paper is ${toHex(paper!)} — run \`pnpm icons\``,
      ).toBeLessThanOrEqual(2)
    }
  })

  it('is still her silhouette, and not a stale copy of an older one', async () => {
    // The generator reads MOCHI. If her body is retuned and `pnpm icons` is not
    // re-run, every other assertion here still passes -- the mark is well
    // inside its box, it just is not her any more.
    const { bounds } = await boundsOf(asset('tray/trayTemplate@3x.png'))
    expect(bounds.width / bounds.height).toBeCloseTo(MOCHI.bodyW / MOCHI.bodyH, 1)
  })
})

describe('the generator itself', () => {
  /**
   * Run `pnpm icons` for real, into a temporary directory.
   *
   * The other tests here read the COMMITTED PNGs, so they pass happily while
   * the generator is broken and the files are stale — which is exactly what
   * happened: a rig module gained an `@shared` alias import that `node` cannot
   * resolve, `pnpm verify` does not run the generator, and the icons quietly
   * stopped being reproducible from the source they claim to come from.
   *
   * Slow-ish, and explicitly budgeted for: it spawns a process that rasterises
   * every icon this app ships.
   */
  it('still runs, and still produces every file', { timeout: 60_000 }, async () => {
    const out = mkdtempSync(join(tmpdir(), 'mochi-icons-'))
    try {
      const root = fileURLToPath(new URL('../../../', import.meta.url))
      const result = spawnSync('node', ['scripts/make-icons.ts'], {
        cwd: root,
        env: { ...process.env, MOCHI_ICON_OUT: out },
        encoding: 'utf8',
        timeout: 50_000,
      })
      expect(result.status, `generator failed:\n${result.stderr}`).toBe(0)
      const expected = [
        'tray/trayTemplate@2x.png',
        'icons/512x512.png',
        'icons/16x16.png',
        // Every Windows rendition the tray asks for. `withWindowsScales`
        // SKIPS a missing file rather than throwing -- right at runtime, since
        // one blurry scale beats no icon, and invisible without this. A scale
        // added to that table and not to the generator would otherwise ship as
        // a resample nobody notices.
        ...WINDOWS_SCALES.flatMap(([size]) => [
          `tray/trayWin-onDark-${String(size)}.png`,
          `tray/trayWin-onLight-${String(size)}.png`,
        ]),
      ]
      for (const name of expected) {
        expect(existsSync(join(out, name)), `${name} was not produced`).toBe(true)
      }
      // And what it produces NOW must match what is committed, or the checked-in
      // icons are stale — the failure this whole test exists for.
      const fresh = await boundsOf(join(out, 'icons/512x512.png'))
      const committed = await boundsOf(asset('icons/512x512.png'))
      expect(fresh.bounds).toEqual(committed.bounds)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

describe('the Dock tile', () => {
  it('carries the whole Apple treatment, because nothing else will apply it', async () => {
    // `app.dock.setIcon()` draws the image at the slot size exactly as given:
    // no squircle crop, no inset, no shadow. Measured in a real Dock
    // screenshot, the slot pitch is 152px and every system icon's tile is
    // 118px -- 0.776 of the slot. Ours, full-bleed, came out 144px: 22% larger
    // than every neighbour, with square-ish corners and no shadow.
    //
    // So this file carries Apple's grid itself. The bundle icons beside it
    // stay full-bleed, because for those the SYSTEM's crop is the one that
    // should win. The two are different jobs and this test is the one that
    // remembers which is which.
    const image = await loadImage(asset('icons/dock.png'))
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, image.width, image.height)
    const alphaAt = (x: number, y: number): number => data[(y * image.width + x) * 4 + 3] ?? 0

    const last = image.width - 1
    const mid = Math.round(last / 2)
    expect(alphaAt(0, 0), 'corner must be cut away').toBe(0)
    expect(alphaAt(last, last), 'corner must be cut away').toBe(0)
    expect(alphaAt(mid, mid), 'middle must be solid').toBe(255)

    // The tile is INSET, 824 of 1024. Measured on solid pixels only, so the
    // drop shadow does not count toward the shape.
    let left = image.width
    let right = -1
    for (let x = 0; x <= last; x++) {
      if (alphaAt(x, mid) < 250) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
    const fraction = (right - left + 1) / image.width
    expect(fraction, 'tile should be ~824/1024 of the canvas').toBeCloseTo(824 / 1024, 1)

    // And a SUPERELLIPSE, not a circular-cornered rectangle. An arc corner and
    // a superellipse differ most a third of the way along the corner, where
    // the superellipse is still solid and the arc has already cut away.
    const inset = Math.round(image.width * (1 - 824 / 1024)) / 2
    const probe = Math.round(inset + image.width * 0.075)
    expect(alphaAt(probe, probe), 'superellipse corner should still be solid here').toBe(255)
  })
})

describe('the window icon (Windows and Linux)', () => {
  it('is the mark on transparency, NOT the full-bleed tile', async () => {
    // The third treatment, and the one most likely to be "corrected" into
    // matching the other two. Windows applies no mask and takes the taskbar
    // icon from the window, so the full-bleed square meant for the macOS
    // bundle would render as a solid colour block beside neighbours that are
    // all logos. The macOS assertions above are deliberately the opposite of
    // this one; both are right for their platform.
    for (const size of [32, 64, 256]) {
      const image = await loadImage(asset(`icons/window-${size}.png`))
      const canvas = createCanvas(image.width, image.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const alphaAt = (x: number, y: number): number => ctx.getImageData(x, y, 1, 1).data[3] ?? 0
      const last = image.width - 1
      expect(alphaAt(0, 0), `${size}px corner must be transparent`).toBe(0)
      expect(alphaAt(last, 0), `${size}px corner must be transparent`).toBe(0)
      // Her top edge does not reach the canvas top either — she is a mark with
      // room around it, not a shape cropped to a box.
      expect(alphaAt(Math.round(last / 2), 0), `${size}px top must be clear`).toBe(0)
      // And she is actually there.
      expect(alphaAt(Math.round(last / 2), Math.round(last * 0.75))).toBe(255)
    }
  })
})

describe('the Windows tray set', () => {
  it('fills its box, unlike the macOS one', async () => {
    // Opposite conventions, and inheriting the wrong one is what made her look
    // undersized in the Windows notification area. macOS menu-bar glyphs all
    // carry optical margin; Windows tray icons run to the edges.
    const fillOf = async (name: string): Promise<{ w: number; h: number }> => {
      const { size, bounds } = await boundsOf(asset(name))
      return { w: bounds.width / size, h: bounds.height / size }
    }
    const mac = await fillOf('tray/trayTemplate@2x.png')
    const win = await fillOf('tray/trayWin-onDark-32.png')
    expect(win.w, 'windows should fill its width').toBeGreaterThan(0.9)
    expect(win.w, 'but not touch the edge — antialiasing needs a pixel').toBeLessThan(1)
    expect(win.w).toBeGreaterThan(mac.w + 0.15)
    expect(win.h).toBeGreaterThan(mac.h + 0.1)
  })

  it('ships the sizes Windows actually asks for', async () => {
    // 16 at 100%, 24 at 150%, 32 at 200%. The old asset was 22px — a macOS
    // point size that lands on none of them, so every Windows scale was a
    // resample of a resample.
    for (const size of [16, 24, 32]) {
      for (const variant of ['onDark', 'onLight']) {
        const { size: actual } = await boundsOf(asset(`tray/trayWin-${variant}-${size}.png`))
        expect(actual, `trayWin-${variant}-${size}.png`).toBe(size)
      }
    }
  })
})

describe('the Windows tray variants', () => {
  /** The ink she is actually drawn in, sampled from her body. */
  async function inkOf(name: string): Promise<Rgb> {
    const image = await loadImage(asset(name))
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const at = ctx.getImageData(
      Math.round(image.width / 2),
      Math.round(image.height * 0.7),
      1,
      1,
    ).data
    return { r: at[0] ?? 0, g: at[1] ?? 0, b: at[2] ?? 0 }
  }

  it('each variant is legible on the taskbar it is named for', async () => {
    // Windows has NO template mechanism — it draws exactly what you hand it —
    // and her green is 8.5:1 on a dark taskbar and 1.7:1 on a light one. A
    // single asset cannot serve both, so there are two, and this is what stops
    // one of them silently stopping working when her palette is retuned.
    const dark = parseHex('#202020')
    const light = parseHex('#f3f3f3')
    expect(dark).not.toBeNull()
    expect(light).not.toBeNull()
    if (dark === null || light === null) return

    expect(contrast(await inkOf('tray/trayWin-onDark-32.png'), dark)).toBeGreaterThan(4.5)
    expect(contrast(await inkOf('tray/trayWin-onLight-32.png'), light)).toBeGreaterThan(4.5)
  })

  it('they are actually different, which is the whole point', async () => {
    // A generator bug that emitted the same colour twice would pass every
    // assertion above except this one.
    expect(toHex(await inkOf('tray/trayWin-onDark-32.png'))).not.toBe(
      toHex(await inkOf('tray/trayWin-onLight-32.png')),
    )
  })
})
