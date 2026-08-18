/**
 * Two icons from Lucide, as path data.
 *
 * Lucide (ISC licensed) rather than shapes drawn by hand: a `×` typed as a
 * glyph and a `⧉` borrowed from the Unicode block are whatever the system font
 * decides they are, at whatever weight it likes, and they do not match each
 * other. These are the real geometry.
 *
 * **Extracted, not imported.** `lucide-static` is a devDependency and none of
 * it reaches the bundle: it ships SVG files for the DOM, and this draws on a
 * canvas, so the only thing needed is the path data. Regenerate with:
 *
 *     node -e 'console.log(require("node:fs").readFileSync(
 *       "node_modules/lucide-static/icons/copy.svg", "utf8"))'
 *
 * Both are drawn on Lucide's own 24×24 grid with its stroke conventions —
 * width 2, round caps and joins — so they are scaled by the caller rather than
 * redrawn at each size, and they stay consistent with each other.
 */

/** Lucide's grid. Everything below is in these units. */
export const ICON_GRID = 24

export interface Icon {
  /** SVG path data, on the 24×24 grid. */
  readonly paths: readonly string[]
  /** Rounded rectangles, which Lucide states as `<rect>` rather than a path. */
  readonly rects: readonly { x: number; y: number; w: number; h: number; r: number }[]
}

/** `copy` — lucide-static 1.31.0. */
export const COPY: Icon = {
  rects: [{ x: 8, y: 8, w: 14, h: 14, r: 2 }],
  paths: ['M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
}

/** `x` — lucide-static 1.31.0. */
export const CLOSE: Icon = {
  rects: [],
  paths: ['M18 6 6 18', 'm6 6 12 12'],
}

/** `check` — lucide-static 1.31.0, for confirming a copy. */
export const CHECK: Icon = {
  rects: [],
  paths: ['M20 6 9 17l-5-5'],
}

/**
 * Stroke an icon into a box, at Lucide's proportions.
 *
 * The stroke width scales with the box so a small icon does not end up with a
 * hairline that disappears against the surface behind it.
 */
export function strokeIcon(
  ctx: CanvasRenderingContext2D,
  icon: Icon,
  box: { x: number; y: number; size: number },
  colour: string,
): void {
  const scale = box.size / ICON_GRID
  ctx.save()
  ctx.translate(box.x, box.y)
  ctx.scale(scale, scale)
  ctx.strokeStyle = colour
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const rect of icon.rects) {
    ctx.beginPath()
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.r)
    ctx.stroke()
  }
  for (const data of icon.paths) {
    ctx.stroke(new Path2D(data))
  }
  ctx.restore()
}
