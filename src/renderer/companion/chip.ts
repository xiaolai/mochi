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

/** Its size, in CSS pixels. Small: it is a handle, not a button bar. */
const SIZE = 26

/**
 * Where it sits relative to her corner, and it is worth stating in one place
 * because both extremes were tried and rejected by eye.
 *
 * Centred on the corner put a quarter of the button inside her outline — the
 * two ran into each other. Nine pixels clear of it read as unrelated to her,
 * floating in the desktop. Zero is the corner itself: the button's inner corner
 * touches the corner of her bounding box, which — because she is a rounded dome
 * and her box is not — leaves a small diagonal gap where her edge falls away,
 * and no overlap anywhere.
 */
const CLEAR = 0

/**
 * A margin around it for the purpose of STAYING VISIBLE, and for nothing else.
 *
 * Moving it clear of her opened a strip of empty desktop between the two, and
 * the rule "show it while the pointer is on her or on it" hides it exactly
 * halfway across — which un-solids the rectangle the cursor is travelling
 * towards. The click region is still the button and only the button; this is
 * about not vanishing on the way.
 */
const GRACE = 12

/** The badge, in CSS pixels. A dot, not a number: at this size a digit is mush. */
const DOT = 5

/**
 * The badge's colour, fixed rather than themed.
 *
 * Every other colour here is handed in so she can sit on a light desktop or a
 * dark one. This one is not a decoration — it means "read me" — and a red that
 * politely adapts to its surroundings is a red that can lose the argument with
 * them.
 */
const ALARM = '#d1495b'

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

/**
 * At HER shoulder, not the window's corner.
 *
 * The window is deliberately much larger than she is — the bubble draws above
 * her head and needs the width — so "top right of the window" put the control a
 * long way from the thing it belongs to. It followed the window because that is
 * what it was given; now it is given her.
 *
 * Clear of her corner rather than centred on it. Centred put a quarter of the
 * button inside her outline, so the two ran into each other.
 */
export function chipRect(her: { right: number; top: number }): Rect {
  return { x: her.right + CLEAR, y: her.top - SIZE - CLEAR, w: SIZE, h: SIZE }
}

/** Whether a point in CSS pixels is on it. */
export function hits(x: number, y: number, her: { right: number; top: number }): boolean {
  const rect = chipRect(her)
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
  her: { right: number; top: number },
): boolean {
  /**
   * Hover, and nothing else — including when something has gone wrong.
   *
   * It showed itself unbidden while a problem was outstanding, on the argument
   * that somebody whose edited file was rejected has no reason to hover. That
   * argument was overruled: a control that appears on the desktop by itself is
   * a control that appears on the desktop by itself, however good its reason.
   *
   * What is kept is the mark ON it — see `drawChip` — so the hover that finds
   * it still says something is waiting. And the bubble's own copy of this
   * control keeps its unprompted badge, which is the common case: the bubble is
   * on by default, and the chip is only what remains when it is not.
   */
  if (pointer === null) return false
  if (onHer) return true
  // The button, plus the gap it now sits across. See `GRACE`.
  const rect = chipRect(her)
  return (
    pointer.x >= rect.x - GRACE &&
    pointer.x <= rect.x + rect.w + GRACE &&
    pointer.y >= rect.y - GRACE &&
    pointer.y <= rect.y + rect.h + GRACE
  )
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
  her: { right: number; top: number },
  colours: ChipColours,
  opacity: number,
  problems = 0,
): void {
  if (opacity <= 0) return
  const { x, y, w, h } = chipRect(her)

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

  /**
   * A dot, when something needs reading, ringed in the chip's own paper.
   *
   * The ring is what makes it legible against whatever is behind her — she may
   * be sitting on a photograph, and a bare red dot on a red pixel is nothing.
   * No count: at five pixels a digit is mush, and the number is on the other
   * side of one click anyway.
   */
  if (problems > 0) {
    ctx.fillStyle = colours.paper
    ctx.beginPath()
    ctx.arc(x + w - DOT, y + DOT, DOT + 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = ALARM
    ctx.beginPath()
    ctx.arc(x + w - DOT, y + DOT, DOT, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}
