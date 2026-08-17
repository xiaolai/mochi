import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MochiAvatar } from './mochi'

/**
 * The rendered mochi against the mark she is supposed to be.
 *
 * This exists because three separate things about the first silhouette were
 * wrong -- aspect ratio, where the widest point sits, and which side the shadow
 * falls on -- and none of them could fail a unit test that only knew about the
 * code. The artwork is the specification, so the artwork is what she is
 * measured against.
 *
 * It also writes a side-by-side to `.render/`, which is the thing a person
 * actually looks at. The assertions catch a silhouette that has drifted; only
 * an eye catches one that never fit.
 */

const ICON = fileURLToPath(new URL('./__fixtures__/mochi-icon.png', import.meta.url))
const OUTPUT = fileURLToPath(new URL('../../../../.render', import.meta.url))

const SIZE = 420

/** Half-width at each 5% of the height, as a fraction of the widest point. */
function profileOf(
  isSolid: (x: number, y: number) => boolean,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): number[] {
  const height = bounds.maxY - bounds.minY + 1
  const widths: number[] = []
  for (let step = 0; step <= 20; step++) {
    const y = bounds.maxY - Math.round((step / 20) * (height - 1))
    let left = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (!isSolid(x, y)) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
    widths.push(right >= left ? right - left + 1 : 0)
  }
  const widest = Math.max(...widths)
  return widths.map((width) => width / widest)
}

function boundsOf(
  isSolid: (x: number, y: number) => boolean,
  width: number,
  height: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = width
  let maxX = 0
  let minY = height
  let maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isSolid(x, y)) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return { minX, maxX, minY, maxY }
}

/**
 * Is this pixel painted?
 *
 * The buffer is read ONCE and indexed, rather than calling
 * `getImageData(x, y, 1, 1)` per pixel. That is what this did, and at a
 * megapixel it is a million separate rasteriser round-trips: the test took
 * 4.4s against vitest's 5s default, which is not a failure but is the next
 * load-dependent flake in the queue. Reading the whole buffer first is the
 * same comparison at a fraction of the cost.
 */
const opaque = (ctx: SKRSContext2D, width: number, height: number) => {
  const { data } = ctx.getImageData(0, 0, width, height)
  return (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    return (data[(y * width + x) * 4 + 3] ?? 0) > 128
  }
}

interface Band {
  /** Fraction of the body that is in shadow. */
  readonly fraction: number
  /** Centroid of the shadow, normalised to the bounding box. */
  readonly x: number
  readonly y: number
}

/**
 * Where the shadow band sits and how much of her it covers.
 *
 * Face ink is excluded by luminance: it sits near 0.24, an order away from the
 * 0.675 shading tone, and counting it would report the eyes and mouth as
 * shadow -- which is exactly the mistake that made a correct band look 25% too
 * large the first time this was measured by hand.
 */
function shadowBand(
  read: (x: number, y: number) => { solid: boolean; luminance: number },
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): Band {
  const width = bounds.maxX - bounds.minX + 1
  const height = bounds.maxY - bounds.minY + 1
  let body = 0
  let dark = 0
  let sumX = 0
  let sumY = 0
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const { solid, luminance } = read(x, y)
      if (!solid || luminance < 0.45) continue
      body++
      if (luminance >= 0.7) continue
      dark++
      sumX += (x - bounds.minX) / width
      sumY += (y - bounds.minY) / height
    }
  }
  return { fraction: dark / body, x: sumX / dark, y: sumY / dark }
}

describe('the rendered mochi against __fixtures__/mochi-icon.png', () => {
  /**
   * A generous, EXPLICIT timeout.
   *
   * This decodes a PNG, rasterises her at the same size and compares every
   * pixel, which costs about two seconds on an idle machine. Against vitest's
   * generic 5s default that is only 2.5x of headroom, and it duly failed the
   * first time the suite ran with the app open beside it -- which is the normal
   * way anyone works in this repository. The number below is a property of what
   * the test does, rather than a limit inherited from a default that never knew
   * about it; the test is not being made to pass by loosening a budget somebody
   * chose.
   */
  it('matches the icon silhouette', { timeout: 30_000 }, async () => {
    const icon = await loadImage(ICON)
    const iconCanvas = createCanvas(icon.width, icon.height)
    const iconCtx = iconCanvas.getContext('2d')
    iconCtx.drawImage(icon, 0, 0)
    const iconData = iconCtx.getImageData(0, 0, icon.width, icon.height).data
    // The icon is green on white, so "not near-white" is the shape.
    const iconSolid = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= icon.width || y >= icon.height) return false
      const i = (y * icon.width + x) * 4
      const r = iconData[i] ?? 255
      const g = iconData[i + 1] ?? 255
      const b = iconData[i + 2] ?? 255
      return (iconData[i + 3] ?? 0) > 128 && !(r > 245 && g > 245 && b > 245)
    }
    const iconBounds = boundsOf(iconSolid, icon.width, icon.height)
    const iconProfile = profileOf(iconSolid, iconBounds)

    const canvas = createCanvas(SIZE, SIZE)
    const ctx = canvas.getContext('2d')
    const avatar = new MochiAvatar(ctx as unknown as CanvasRenderingContext2D, {
      // She must fill the comparison canvas: this measures her PROFILE against
      // the artwork, and a smaller render would compare fewer pixels to it.
      size: 'fit-canvas',
      random: () => 0.5,
    })
    avatar.resize(SIZE, SIZE, 1)
    avatar.setIdle(false)
    avatar.render(0)

    const mine = opaque(ctx, SIZE, SIZE)
    const myBounds = boundsOf(mine, SIZE, SIZE)
    const myProfile = profileOf(mine, myBounds)

    const iconRatio =
      (iconBounds.maxX - iconBounds.minX + 1) / (iconBounds.maxY - iconBounds.minY + 1)
    const myRatio = (myBounds.maxX - myBounds.minX + 1) / (myBounds.maxY - myBounds.minY + 1)
    expect(myRatio).toBeCloseTo(iconRatio, 1)

    for (const [index, expected] of iconProfile.entries()) {
      // Loose at the two tips, where a pixel either way swings the fraction
      // hard, and tight everywhere the shape is actually readable.
      const tolerance = index === 0 || index === iconProfile.length - 1 ? 0.12 : 0.06
      expect(
        Math.abs((myProfile[index] ?? 0) - expected),
        `height ${(index / 20).toFixed(2)}: icon ${expected.toFixed(3)} vs rendered ${(myProfile[index] ?? 0).toFixed(3)}`,
      ).toBeLessThan(tolerance)
    }

    // The shadow band: present, on the lower left, and about the right size.
    //
    // Loose on purpose -- the offsets are still being tuned, so this is not a
    // pin on the exact geometry. What it refuses is the band vanishing, ending
    // up on the wrong side, or being lit from a direction that contradicts
    // itself, all three of which shipped in earlier versions of this rig and
    // none of which any other test could see.
    const iconBand = shadowBand((x, y) => {
      const i = (y * icon.width + x) * 4
      const r = iconData[i] ?? 255
      const g = iconData[i + 1] ?? 255
      const b = iconData[i + 2] ?? 255
      return {
        solid: iconSolid(x, y),
        luminance: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
      }
    }, iconBounds)

    const rendered = ctx.getImageData(0, 0, SIZE, SIZE).data
    const myBand = shadowBand((x, y) => {
      const i = (y * SIZE + x) * 4
      const r = rendered[i] ?? 0
      const g = rendered[i + 1] ?? 0
      const b = rendered[i + 2] ?? 0
      return {
        solid: (rendered[i + 3] ?? 0) > 128,
        luminance: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
      }
    }, myBounds)

    expect(myBand.fraction).toBeGreaterThan(0.05)
    expect(Math.abs(myBand.fraction - iconBand.fraction)).toBeLessThan(0.06)
    // Left of centre and below it, like the icon's.
    expect(myBand.x).toBeLessThan(0.5)
    expect(myBand.y).toBeGreaterThan(0.6)
    expect(Math.abs(myBand.x - iconBand.x)).toBeLessThan(0.08)
    expect(Math.abs(myBand.y - iconBand.y)).toBeLessThan(0.08)

    // The side-by-side a person looks at. Written every run so it cannot go
    // stale relative to the code that produced it.
    const sheet = createCanvas(SIZE * 2, SIZE)
    const sheetCtx = sheet.getContext('2d')
    sheetCtx.fillStyle = '#ffffff'
    sheetCtx.fillRect(0, 0, SIZE * 2, SIZE)
    sheetCtx.drawImage(
      icon,
      iconBounds.minX,
      iconBounds.minY,
      iconBounds.maxX - iconBounds.minX,
      iconBounds.maxY - iconBounds.minY,
      SIZE * 0.1,
      SIZE * 0.25,
      SIZE * 0.8,
      SIZE * 0.8 * (1 / iconRatio),
    )
    sheetCtx.drawImage(canvas, SIZE, 0)
    mkdirSync(OUTPUT, { recursive: true })
    writeFileSync(`${OUTPUT}/icon-vs-render.png`, sheet.toBuffer('image/png'))
  })
})
