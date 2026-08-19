import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MochiAvatar } from './mochi'

/**
 * The icons this app actually SHIPS, against the rig that draws her.
 *
 * `silhouette-vs-icon.test.ts` pins the rig to the artwork. Nothing pinned the
 * files in `resources/` to either, and the handoff claims they cannot come
 * apart — "generated from the same function that paints her, so the mark and the
 * mochi cannot drift". There is no generator in this repository: `resources/`
 * holds static PNGs, so the claim was not true, it was merely unfalsified.
 *
 * This is the falsifier. It does not regenerate anything — the tray mark and the
 * 1024px icon are not the same drawing (one is pure alpha, one is green on a
 * gradient), and emitting both from one function would mean re-authoring artwork
 * nobody asked to change. Measuring is the part that was missing.
 *
 * ## The measurement, and why this one
 *
 * PROFILE — half-width at each 5% of the height, normalised to the widest point
 * — rather than pixels. The assets are rasterised at eight sizes with
 * antialiasing, some are pure alpha and some are colour on a gradient, and a
 * pixel comparison across that would need a tolerance nobody could justify. This
 * is the measurement the sibling test settled on, for the same reason.
 *
 * The rig is rendered at each asset's OWN size, so both sides carry the same
 * rasterisation error. Comparing a 22px mark against a 256px render measures the
 * rasteriser, not the drawing.
 */

const RESOURCES = fileURLToPath(new URL('../../../../resources/', import.meta.url))

interface Shape {
  /** The longer side of the image, which is what the rig is matched to. */
  readonly size: number
  /** Width over height of her bounding box. */
  readonly aspect: number
  /** Twenty-one half-widths, bottom to top, as fractions of the widest. */
  readonly profile: readonly number[]
  readonly hasInk: boolean
}

function shapeOf(solid: (x: number, y: number) => boolean, w: number, h: number): Shape {
  let minX = w
  let maxX = -1
  let minY = h
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < 0) return { size: Math.max(w, h), aspect: 0, profile: [], hasInk: false }
  const height = maxY - minY + 1
  const widths: number[] = []
  for (let step = 0; step <= 20; step++) {
    const y = maxY - Math.round((step / 20) * (height - 1))
    let left = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    for (let x = minX; x <= maxX; x++) {
      if (!solid(x, y)) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
    widths.push(right >= left ? right - left + 1 : 0)
  }
  const widest = Math.max(...widths)
  return {
    size: Math.max(w, h),
    aspect: (maxX - minX + 1) / height,
    profile: widths.map((one) => one / widest),
    hasInk: true,
  }
}

function rigAt(size: number): Shape {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const avatar = new MochiAvatar(ctx as unknown as CanvasRenderingContext2D, {
    // She fills the canvas, so the comparison is her whole profile rather than
    // her profile plus however much margin each asset happens to carry.
    size: 'fit-canvas',
    random: () => 0.5,
  })
  avatar.resize(size, size, 1)
  avatar.setIdle(false)
  avatar.render(0)
  const { data } = ctx.getImageData(0, 0, size, size)
  return shapeOf((x, y) => (data[(y * size + x) * 4 + 3] ?? 0) > 128, size, size)
}

async function assetOf(file: string): Promise<Shape> {
  const image = await loadImage(RESOURCES + file)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, image.width, image.height)
  /*
    HER, not the tile she sits on, and not its shadow.

    Two kinds of asset, so two rules, chosen per image rather than merged. A
    single "opaque and not near-white" test measured `dock.png`'s paper plate and
    reported a perfect square as a 0.28 reshape; adding "or near-black" to catch
    the monochrome templates then picked up the SAME tile's drop shadow and
    reported a profile 1.00 out at the bottom. Both were my measurement, not the
    artwork — which is the argument for deciding first what kind of image this is
    and then measuring one thing.

    If any pixel is green, she is drawn in colour and her colour is the mark: her
    body and its shade both clear g−r ≥ 58 and g−b ≥ 32, and no grey plate,
    gradient or shadow is green at any lightness. Otherwise it is a macOS
    template — pure alpha, one flat fill — and alpha is the mark.
  */
  const isGreen = (i: number): boolean => {
    const r = data[i] ?? 255
    const g = data[i + 1] ?? 255
    const b = data[i + 2] ?? 255
    return (data[i + 3] ?? 0) > 128 && g > r + 8 && g > b + 8
  }
  let coloured = false
  for (let i = 0; i < data.length && !coloured; i += 4) coloured = isGreen(i)

  return shapeOf(
    (x, y) => {
      const i = (y * image.width + x) * 4
      if ((data[i + 3] ?? 0) <= 128) return false
      return coloured ? isGreen(i) : true
    },
    image.width,
    image.height,
  )
}

/**
 * Below this, the measurement cannot tell drift from rasterisation.
 *
 * Measured across all thirty-three assets rather than guessed, and the numbers
 * are why the small ones are skipped instead of merely given a looser tolerance.
 * Worst interior sample against a size-matched render of the rig:
 *
 * | px    | 1024  | 512   | 256   | 128   | 64    | 48    | 44    | 40    | 24    | 20    |
 * | ---   | ---   | ---   | ---   | ---   | ---   | ---   | ---   | ---   | ---   | ---   |
 * | worst | 0.005 | 0.016 | 0.017 | 0.035 | 0.076 | 0.060 | 0.137 | 0.129 | 0.207 | 0.346 |
 *
 * The step at 48 is not a judgement call: everything at or above it lands under
 * 0.08, everything below jumps to 0.129 and keeps climbing. At 16px her bounding
 * box is about 12x9 pixels, so twenty-one samples down nine rows asks the same
 * row three times and calls it three measurements. A tolerance wide enough to
 * pass 0.346 would pass a different animal — a test reporting coverage it does
 * not have, which is the failure this file exists to remove. So they are named
 * and counted below rather than waved through.
 */
const SMALLEST_MEASURABLE = 48

/** Aspect of her bounding box: the coarsest thing that would catch a reshape. */
const ASPECT_TOLERANCE = 0.05

/**
 * Per interior sample. The two TIPS are excluded, not loosened.
 *
 * At the top and bottom row the half-width is one or two pixels, so a single
 * pixel of antialiasing swings the fraction by a third — 0.32 on a 22px mark
 * that is correct everywhere else. The shape is carried by the nineteen samples
 * between them; including the tips adds a number that moves for reasons that are
 * not about the drawing.
 *
 * 0.10 rather than 0.08: the worst measurable asset is `window-64.png` at 0.076,
 * and five percent of headroom is a number chosen to make today pass. This sits
 * between that and the 0.129 floor of the band that cannot be measured at all.
 */
const SAMPLE_TOLERANCE = 0.1

const ASSETS = ['tray', 'icons'].flatMap((folder) =>
  readdirSync(RESOURCES + folder)
    .filter((one) => one.endsWith('.png'))
    .map((one) => `${folder}/${one}`),
)

describe('the shipped marks are still the mochi the rig draws', () => {
  it('found assets in both folders', () => {
    // Without this every case below is vacuously green the day a folder is
    // renamed, which is the silent pass this file exists to remove.
    expect(ASSETS.filter((one) => one.startsWith('tray/'))).not.toHaveLength(0)
    expect(ASSETS.filter((one) => one.startsWith('icons/'))).not.toHaveLength(0)
  })

  it.each(ASSETS)('%s', { timeout: 30_000 }, async (file) => {
    const asset = await assetOf(file)
    if (asset.size < SMALLEST_MEASURABLE) {
      // Not measurable is not the same as not checked: a blank file would ship
      // an invisible tray icon, and that IS detectable at any size.
      expect(asset.hasInk, `${file} is ${asset.size}px — too small to measure, but not blank`).toBe(
        true,
      )
      return
    }
    const rig = rigAt(asset.size)
    expect(
      Math.abs(asset.aspect - rig.aspect),
      `${file}: shipped ${asset.aspect.toFixed(3)} wide-to-tall, rig ${rig.aspect.toFixed(3)}`,
    ).toBeLessThan(ASPECT_TOLERANCE)
    for (const [index, expected] of rig.profile.entries()) {
      if (index === 0 || index === rig.profile.length - 1) continue
      expect(
        Math.abs((asset.profile[index] ?? 0) - expected),
        `${file} at height ${(index / 20).toFixed(2)}: rig ${expected.toFixed(3)} vs shipped ${(asset.profile[index] ?? 0).toFixed(3)}`,
      ).toBeLessThan(SAMPLE_TOLERANCE)
    }
  })

  it('says how many assets are too small to measure, rather than hiding it', async () => {
    const sizes = await Promise.all(ASSETS.map(async (one) => (await assetOf(one)).size))
    const unmeasured = sizes.filter((one) => one < SMALLEST_MEASURABLE).length
    // Written down, so the number moving is a thing somebody has to look at. If
    // a 512px icon is replaced by a 32px one this goes red, and that is the
    // point — coverage shrinking silently is how a suite starts lying.
    expect({ unmeasured, of: sizes.length }).toEqual({ unmeasured: 21, of: 33 })
  })
})
