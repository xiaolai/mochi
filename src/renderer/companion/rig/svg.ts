import type { FaceSpec } from '@shared/avatar-spec'
import { domeOutline, type BodyShape, type Point } from './geometry'

/**
 * Her, as a vector, from the same geometry that paints her.
 *
 * ## The claim this exists to make true
 *
 * `electron-builder.yml` says it plainly: *"the generator that produced them did
 * not survive the rewrite, so `resources/` is hand-maintained"*. And
 * `shipped-icons.test.ts` says what that cost: the handoff claimed the mark and
 * the mochi "cannot drift", and the test's own header answers that the claim
 * "was not true, it was merely unfalsified".
 *
 * Measuring drift is the second-best answer. This is the first: every shipped
 * asset is rasterised from an SVG emitted **by `domeOutline`**, which is the
 * function `paint` calls to draw her on screen. Change her shape and the icons
 * change with her, because there is one shape and this is it.
 *
 * ## Why SVG rather than emitting PNGs from the canvas directly
 *
 * The rig could rasterise these itself -- `@napi-rs/canvas` is already here and
 * `paint` already knows how. Three things a vector step buys that a direct
 * raster does not:
 *
 * 1. **A source somebody can open.** A designer can look at the shape, and a
 *    diff can show what changed about it, without decoding a PNG.
 * 2. **One geometry, many rasterisers.** macOS wants `.icns`, Windows wants
 *    `.ico`, the web wants whatever it wants; every one of those pipelines
 *    takes SVG, and none of them take a `CanvasRenderingContext2D`.
 * 3. **Resolution is a parameter rather than a re-render.** The 16px mark and
 *    the 1024px icon come out of the same document, so they cannot disagree
 *    about her proportions -- which is the exact failure the profile test in
 *    `shipped-icons.test.ts` was written to detect.
 *
 * ## What is NOT drawn
 *
 * No eyes, no mouth, no cheeks. Every shipped asset is her SILHOUETTE, measured
 * off the existing artwork: a face at 16px is four grey pixels, and the mark has
 * to read at the size a menu bar gives it. `looks.ts` deforms a face; this draws
 * a body, and the two have never been the same picture.
 */

/** How one asset is coloured and how much of its square she fills. */
export interface Treatment {
  /** The lit fill. */
  readonly body: string
  /** The fill behind it, offset by `shadowX`/`shadowY`. See `paintBody`. */
  readonly shadow: string
  /**
   * A vertical gradient behind her, or null for transparency.
   *
   * `size` and `radius` describe a PLATE rather than a full-bleed square, and
   * they exist because leaving them out lost an asset. `icons/dock.png` was
   * hand-drawn as an 852px rounded plate inside a 1024 canvas with transparent
   * margin — the pre-masked tile `dock.setIcon` needs, because an image set at
   * runtime gets no squircle from the system. When every asset was moved to
   * this generator the plate became `<rect width="px" height="px">`, a
   * full-bleed square, and the mark it framed went from 62% of a plate to 51%
   * of a tile without a single number changing.
   *
   * Both default to the full square, so every other treatment is untouched.
   */
  readonly background: {
    readonly from: string
    readonly to: string
    /** Side of the plate as a fraction of the square. 1 is full bleed. */
    readonly size?: number
    /** Corner radius as a fraction of the PLATE, not of the square. */
    readonly radius?: number
  } | null
  /**
   * Her width as a fraction of the square.
   *
   * Measured off the shipped artwork rather than chosen: the app icon has her
   * at 0.64 of its width and the Windows tray mark at 0.91, because a mark in a
   * 16px strip has no room for margin and an app icon on a gradient needs one.
   * One number per treatment, so a change of mind is a change of number.
   */
  readonly width: number
}

/** Two decimals is a tenth of a pixel at 1024, and shortens the file by half. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

function toD(points: readonly Point[]): string {
  return `${points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`)
    .join('')}Z`
}

/**
 * Her outline as an SVG path, centred in a `px` square at the given width.
 *
 * Exported because the tests measure it: a profile taken from these points can
 * be compared with one taken from the rig's own `domeOutline` without going
 * near a rasteriser, which is a comparison with no tolerance in it at all.
 */
export function outlineFor(
  face: FaceSpec,
  px: number,
  width: number,
): {
  readonly points: readonly Point[]
  readonly shape: BodyShape
  readonly scale: number
  readonly offset: { readonly dx: number; readonly dy: number }
} {
  /*
    `width` is her SILHOUETTE, and the offset copy does not extend it.

    That is only true because the lit copy is clipped to the outline — see
    `mochiSvg`. An earlier draft drew it unclipped and had to solve for the
    overshoot here, which produced a mark 4% too wide and the wrong shape
    entirely: measured, 1.23 wide-to-tall against the rig's 1.28.

    Clipped, her extent is exactly the outline, so this is the plain division it
    looks like. Checked against the shipped 1024, whose mark is 0.6396 of the
    square wide and 0.499 tall — 0.64 and 0.64/1.2821, to three decimals.
  */
  const scale = (px * width) / face.bodyW
  const shape: BodyShape = {
    halfWidth: (face.bodyW / 2) * scale,
    height: face.bodyH * scale,
    waist: face.waist,
    upperShoulder: face.upperShoulder,
    lowerShoulder: face.lowerShoulder,
    // Upright. A lean is something a MOTION does to her; an icon is her at rest,
    // and a mark that leaned would look like a mistake rather than a pose.
    lean: 0,
  }
  const dx = face.shadowX * shape.halfWidth * 2
  const dy = face.shadowY * shape.height

  /*
    Centred, and SNAPPED to whole pixels.

    Centring alone puts her baseline at a fraction — 53.875 in a 64px square —
    so the bottom row of the dome is a partial coverage the rasteriser
    antialiases away, and her base reads narrower than it is. That is not
    theoretical: `window-64.png` was the one asset of thirty-three that failed
    the profile check against the rig, by 0.112 against a tolerance of 0.1, at
    the 5% height band which is exactly where her base is.

    Snapping costs at most half a pixel of centring and buys a crisp edge at
    every size. It matters most at 16 and 22, where half a pixel is a twentieth
    of the mark.
  */
  const originX = Math.round(px / 2)
  const originY = Math.round(px / 2 + shape.height / 2)
  // Local space is +y up with the base at 0; SVG is +y down, like the canvas.
  const points = domeOutline(shape).map((point) => ({
    x: originX + point.x,
    y: originY - point.y,
  }))
  return { points, shape, scale, offset: { dx, dy } }
}

/**
 * One asset, as an SVG document.
 *
 * The body is drawn TWICE and the pair is CLIPPED to the first, which is not
 * decoration and is not optional -- it is exactly what `paint` does. The
 * silhouette is clipped before `paintBody` is called, so the lit copy moving up
 * and to the right does not make her bigger: it uncovers a crescent of shadow
 * along her lower left and is cut off everywhere else.
 *
 * Getting this wrong is not subtle and was caught by measurement rather than by
 * eye. Unclipped, the offset copy extends her bounding box by the offset, and
 * the mark comes out **1.23 wide-to-tall against the rig's 1.28** -- outside the
 * tolerance `shipped-icons.test.ts` allows, on the one axis a mark is most
 * recognisable by. Two paths and a `clipPath` reproduce her; two paths alone
 * reproduce something else.
 */
/**
 * The plate she sits on: the whole square, or a rounded tile inside it.
 *
 * Centred, and the original artwork was not quite — its margins were 86 either
 * side and 99 over 74 top to bottom, so the plate sat 12px low in a 1024
 * square. That is a tenth of a percent of the tile and reproducing it would be
 * reproducing a wobble rather than a decision.
 */
function plateRect(px: number, background: Treatment['background']): string {
  if (background === null) return ''
  /*
    THE SIZE TAKES THE PARITY OF THE TILE, so the margins are equal.

    Coordinates in the emitted SVG are integers. `at = round((px - size) / 2)`
    with an odd remainder puts the plate half a pixel off centre and leaves
    margins that differ by one — `px = 16` with `size = 13` gives 2 above and 1
    below. The docblock above says "Centred", and at the sizes a tray icon is
    drawn at, one pixel of the sixteen is a visible lean.

    Losing a pixel of SIZE is the cheaper correction than gaining a pixel of
    offset: the plate is a proportion of the tile and one pixel narrower is
    within the rounding that already happened, while an off-centre plate is a
    different shape from the one asked for.
  */
  const wanted = Math.round(px * (background.size ?? 1))
  const size = Math.max(0, (px - wanted) % 2 === 0 ? wanted : wanted - 1)
  const at = (px - size) / 2
  const radius = Math.round(size * (background.radius ?? 0))
  return (
    `<rect x="${String(at)}" y="${String(at)}" ` +
    `width="${String(size)}" height="${String(size)}" ` +
    (radius > 0 ? `rx="${String(radius)}" ry="${String(radius)}" ` : '') +
    `fill="url(#bg)"/>`
  )
}

export function mochiSvg(face: FaceSpec, px: number, treatment: Treatment): string {
  const { points, offset } = outlineFor(face, px, treatment.width)
  const d = toD(points)
  const dx = round(offset.dx)
  // Canvas and SVG both grow y downward and the light comes from above, so the
  // lit copy moves toward smaller y.
  const dy = round(offset.dy)

  const gradient =
    treatment.background === null
      ? ''
      : `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${treatment.background.from}"/>` +
        `<stop offset="1" stop-color="${treatment.background.to}"/>` +
        `</linearGradient>`
  // OUTSIDE the clip: the plate is what she sits on, and clipping it to her
  // would produce an icon that is only her, on nothing.
  const plate = plateRect(px, treatment.background)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(px)}" height="${String(px)}" ` +
    `viewBox="0 0 ${String(px)} ${String(px)}">` +
    `<defs>${gradient}<clipPath id="her"><path d="${d}"/></clipPath></defs>` +
    plate +
    `<g clip-path="url(#her)">` +
    `<path d="${d}" fill="${treatment.shadow}"/>` +
    `<path d="${d}" fill="${treatment.body}" transform="translate(${String(dx)} ${String(-dy)})"/>` +
    `</g>` +
    `</svg>`
  )
}
