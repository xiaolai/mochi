import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { MOCHI } from '@shared/avatar-spec'
import { domeOutline } from './geometry'
import { ICON_SET } from './icons'
import { mochiSvg, outlineFor } from './svg'

/**
 * The generator, and the guarantee it replaces a hope with.
 *
 * `shipped-icons.test.ts` MEASURES the artwork against the rig and allows a
 * tolerance, because a hand-drawn PNG and a rasterised dome can only ever agree
 * approximately. This file asks a stricter question that only became askable
 * once a generator existed: **is what is committed exactly what the generator
 * emits today?**
 *
 * Byte equality, no tolerance. The two tests are not redundant — the sibling
 * one would still catch somebody hand-editing `resources/` to match a broken
 * generator, and this one catches the generator and the tree drifting apart,
 * which is the failure that produced thirty-three hand-maintained files in the
 * first place.
 */

const RESOURCES = fileURLToPath(new URL('../../../../resources/', import.meta.url))

async function render(px: number, svg: string): Promise<Buffer> {
  const image = await loadImage(Buffer.from(svg))
  const canvas = createCanvas(px, px)
  canvas.getContext('2d').drawImage(image, 0, 0, px, px)
  return canvas.toBuffer('image/png')
}

describe('the shape comes from the rig, not from a copy of it', () => {
  it('traces the same outline `paint` does, point for point', () => {
    /*
      No rasteriser and no tolerance: both sides call `domeOutline`, so if the
      SVG ever grows its own idea of her shape this is an exact mismatch rather
      than a few pixels of profile drift.
    */
    const { points, shape, scale } = outlineFor(MOCHI, 1024, 0.64)
    expect(scale).toBeCloseTo((1024 * 0.64) / MOCHI.bodyW, 10)
    const rig = domeOutline(shape)
    expect(points).toHaveLength(rig.length)
    // Same points, moved into the square. The offset is the only difference.
    const dx = points[0]!.x - rig[0]!.x
    const dy = points[0]!.y + rig[0]!.y
    for (const [index, point] of points.entries()) {
      expect(point.x).toBeCloseTo((rig[index]?.x ?? 0) + dx, 6)
      expect(point.y).toBeCloseTo(dy - (rig[index]?.y ?? 0), 6)
    }
  })

  it('clips the lit copy to her outline, which is what keeps her HER shape', () => {
    /*
      The bug this pins, caught by measurement: `paint` calls `ctx.clip` before
      `paintBody`, so the offset lit fill uncovers a crescent of shadow rather
      than making her larger. An SVG without the clip drew a mark **1.23
      wide-to-tall against the rig's 1.28** — a different creature, outside the
      tolerance the sibling test allows, on the one proportion a mark is
      recognised by.
    */
    const svg = mochiSvg(MOCHI, 256, ICON_SET[0]!.treatment)
    expect(svg).toContain('<clipPath id="her">')
    expect(svg).toContain('clip-path="url(#her)"')
    // Two fills, both inside the clip: the shadow, and the same path offset.
    expect(svg.match(/<path /g)).toHaveLength(3)
  })

  it('puts the plate outside the clip, or the icon would be only her', () => {
    const app = ICON_SET.find((one) => one.treatment.background !== null)
    expect(app).toBeDefined()
    const svg = mochiSvg(MOCHI, 256, app!.treatment)
    // The rect precedes the clipped group; a plate inside it would be invisible
    // everywhere she is not.
    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('clip-path'))
  })
})

describe('the set', () => {
  it('names every file the app and the installer actually load', () => {
    const files = new Set(ICON_SET.map((one) => one.file))
    // `electron-builder.yml` points at the first; `tray.ts` loads the rest.
    for (const required of [
      'icons/1024x1024.png',
      'icons/dock.png',
      'icons/window-32.png',
      'tray/trayTemplate.png',
      'tray/trayTemplate@2x.png',
      'tray/tray.png',
      'tray/trayWin-onDark-16.png',
      'tray/trayWin-onLight-48.png',
    ]) {
      expect(files.has(required), required).toBe(true)
    }
  })

  it('gives every asset its own file and a positive size', () => {
    expect(new Set(ICON_SET.map((one) => one.file)).size).toBe(ICON_SET.length)
    for (const one of ICON_SET) {
      expect(Number.isInteger(one.px) && one.px > 0, one.file).toBe(true)
      expect(one.treatment.width, one.file).toBeGreaterThan(0)
      expect(one.treatment.width, one.file).toBeLessThanOrEqual(1)
    }
  })

  it('keeps template images flat, because macOS recolours them', () => {
    // A template with a lit side is recoloured to two shades of one grey and
    // reads as a printing error rather than as shading.
    for (const one of ICON_SET.filter((asset) => asset.file.includes('Template'))) {
      expect(one.treatment.body, one.file).toBe(one.treatment.shadow)
      expect(one.treatment.background, one.file).toBeNull()
      expect(one.treatment.body, one.file).toBe('#000000')
    }
  })

  it('plates the launcher icon and nothing else', () => {
    /*
      Three groups, not two, and `icons/` is not the line: `icons/window-*` sits
      in that folder and is TRANSPARENT, because it is drawn beside her inside
      the app rather than standing on its own in a Dock. Only the thing an
      operating system shows in a launcher gets a background.
    */
    for (const one of ICON_SET) {
      const plated = one.treatment.background !== null
      const launcher = one.file.startsWith('icons/') && !one.file.includes('window-')
      expect(plated, one.file).toBe(launcher)
    }
  })
})

describe('what is committed is what the generator emits', () => {
  it.each(ICON_SET.map((one) => [one.file, one] as const))('%s', async (file, asset) => {
    /*
      Byte equality. `pnpm icons` is the fix when this fails, and the failure
      message says so rather than leaving somebody to diff two PNGs by eye.
    */
    const expected = await render(asset.px, mochiSvg(MOCHI, asset.px, asset.treatment))
    const committed = readFileSync(join(RESOURCES, file))
    expect(
      committed.equals(expected),
      `${file} is not what the generator emits — run \`pnpm icons\``,
    ).toBe(true)
  })
})
