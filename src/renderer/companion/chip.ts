/**
 * The little speech-bubble button that appears at her shoulder on hover.
 *
 * One control, one job: open the conversations she remembers. It lives in her
 * window rather than in a menu because the window is the only surface she has —
 * there is no title bar, no dock entry, and nothing else to hang it on.
 *
 * ## It DOES take the mouse, and that is a deliberate exception
 *
 * `bubble.ts` rule 3 says a bubble must not enlarge her hit region, because
 * `hitTest` is the promise that only painted pixels take the mouse. This is not
 * that: a control nobody can click is not a control, so while it is visible its
 * rectangle is solid on purpose.
 *
 * The promise is kept by making the exception exactly as large as the control
 * and no larger — `hits()` is a rectangle, not a margin, and `face.ts` only
 * consults it while the chip is actually on screen. When she is not hovered,
 * the corner is empty desktop again.
 *
 * ## Why it must stay up while the pointer is on IT
 *
 * The obvious rule — "show it while the pointer is on her" — cannot be clicked.
 * The chip sits outside her silhouette (that is the point of a corner), so
 * moving towards it leaves her, which hides it, which un-solids it under the
 * cursor. `visible()` therefore takes both, and the two together are stable:
 * the pointer is always on one or the other along any path between them.
 */

/** Its size and inset, in CSS pixels. Small: it is a handle, not a button bar. */
const SIZE = 26
const INSET = 8

export interface ChipColours {
  /** Its own opaque surface. She may be sitting on a photograph. */
  readonly paper: string
  readonly ink: string
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Top right of her window, inset. Returned rather than drawn so it is testable. */
export function chipRect(width: number): Rect {
  return { x: width - SIZE - INSET, y: INSET, w: SIZE, h: SIZE }
}

/** Whether a point in CSS pixels is on it. */
export function hits(x: number, y: number, width: number): boolean {
  const rect = chipRect(width)
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
}

/**
 * Whether it should be on screen at all.
 *
 * `onHer` comes from the rig's silhouette test, which is per-pixel. The second
 * term is what makes it reachable — see the note above.
 */
export function visible(
  pointer: { x: number; y: number } | null,
  onHer: boolean,
  width: number,
): boolean {
  if (pointer === null) return false
  return onHer || hits(pointer.x, pointer.y, width)
}

/**
 * A speech bubble, drawn rather than shipped as an asset.
 *
 * Twenty lines of canvas against a file that has to be found, loaded, decoded,
 * scaled for two pixel ratios and kept in step with the theme. At this size the
 * drawing is also sharper, because it is drawn at the device ratio the window
 * happens to have rather than resampled to it.
 */
export function drawChip(
  ctx: CanvasRenderingContext2D,
  width: number,
  colours: ChipColours,
  opacity: number,
): void {
  if (opacity <= 0) return
  const { x, y, w, h } = chipRect(width)

  ctx.save()
  ctx.globalAlpha = opacity

  ctx.fillStyle = colours.paper
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 8)
  ctx.fill()

  // The glyph: a rounded speech bubble with a tail at the bottom left, and three
  // dots — the shape that reads as "what was said" at 26 pixels.
  const pad = 6
  const bx = x + pad
  const by = y + pad + 1
  const bw = w - pad * 2
  const bh = h - pad * 2 - 3

  ctx.fillStyle = colours.ink
  ctx.beginPath()
  ctx.roundRect(bx, by, bw, bh, 3)
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(bx + 3, by + bh)
  ctx.lineTo(bx + 3, by + bh + 3)
  ctx.lineTo(bx + 7, by + bh)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = colours.paper
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath()
    ctx.arc(bx + bw / 2 + (i - 1) * 3.5, by + bh / 2, 1, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}
