/**
 * Which side of her the bubble goes on.
 *
 * Its own module because it is arithmetic with no canvas in it, and because
 * getting it wrong is invisible until somebody drags her into a corner. The
 * bubble used to be unconditionally above her, which was never WRONG — the
 * bubble is drawn inside her window and the window is always on screen, so it
 * was never clipped — but it meant that with her at the top of the display you
 * read her words in the strip beside the menu bar, and with her at the right
 * edge the box slid sideways to stay in the window rather than going where
 * there was room.
 *
 * ## Two boxes, one coordinate space
 *
 * Everything here is in CANVAS pixels. The work area arrives translated into
 * that space by the caller, which knows where the window is — see `roomFor`.
 * Mixing screen and canvas coordinates in the same expression is the bug this
 * shape exists to make impossible.
 */

/** Her body, in canvas pixels. */
export interface Body {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** How far the bubble may spread, in canvas pixels. See `roomFor`. */
export interface Room {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export type Side = 'above' | 'below' | 'left' | 'right'

/**
 * Where somebody asked for it, or `auto` to let the room decide.
 *
 * A preference rather than a command: a side that does not fit is not
 * honoured, because honouring it means a bubble half off the display. The menu
 * only offers the sides that fit, so the two agree — but the menu is built from
 * a snapshot and she can be dragged after it is opened.
 */
export type SidePreference = Side | 'auto'

/** The order tried when nobody has chosen, and the fallback when a choice does not fit. */
const ORDER: readonly Side[] = ['above', 'below', 'left', 'right']

export interface Placed {
  readonly x: number
  readonly y: number
  readonly side: Side
}

/**
 * How far the box stands off her, and it is NOT one number.
 *
 * It was, and that is what put the tail inside the halo. Above her head there
 * is already something drawn — the ring, about 27px of it — and a single reach
 * measured from her body cannot know that. On the other three sides nothing is
 * drawn over her, so they keep the distance the design chose for the tail.
 *
 * A record rather than a second positional number: `placeBubble(her, box, room,
 * 43, 26)` is two anonymous distances in an order nobody can remember, and
 * getting them the wrong way round puts the bubble further from her sideways
 * than it is above her, which reads as a bug in the drawing rather than in the
 * arithmetic.
 */
export interface Reach {
  /** From her scalp to the tail's tip, clearing the halo. See `haloClearance`. */
  readonly above: number
  /** From her body, on the three sides nothing is drawn over. */
  readonly rest: number
}

/** The reach that applies on one side. */
function reachOn(side: Side, reach: Reach): number {
  return side === 'above' ? reach.above : reach.rest
}

/**
 * The work area, in canvas pixels, intersected with the canvas itself.
 *
 * Both limits are real and neither implies the other. The canvas is a hard
 * boundary — nothing painted outside it exists. The work area is where the
 * SCREEN is, and her window deliberately hangs off the edge of it: the window
 * is much bigger than she is so the bubble has somewhere to go, which means
 * that with her parked in a corner most of the window is off the display.
 *
 * `inset` is the margin kept from the screen's own edges, so a bubble flush
 * against the side of the display does not read as falling off it.
 */
export function roomFor(
  canvas: { readonly width: number; readonly height: number },
  window: { readonly x: number; readonly y: number },
  work: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  inset: number,
): Room {
  return {
    left: Math.max(0, work.x + inset - window.x),
    top: Math.max(0, work.y + inset - window.y),
    right: Math.min(canvas.width, work.x + work.width - inset - window.x),
    bottom: Math.min(canvas.height, work.y + work.height - inset - window.y),
  }
}

function clamp(value: number, min: number, max: number): number {
  // `min` last, so a range narrower than the box pins it to the START of the
  // range rather than the end. Backwards, the box would sit off the far edge —
  // further out than the value being corrected.
  return Math.max(min, Math.min(max, value))
}

/**
 * Where to put a box of this size, given where she is and where the screen is.
 *
 * **Above first**, and that is a choice about speech rather than about space:
 * a bubble over someone's head is the thing everybody already reads as talking.
 * Below is the same gesture upside down and reads almost as well. Left and
 * right come last because a bubble beside her is a label, not a voice — they
 * exist for the case where neither vertical side has room, which is a short
 * display or a very tall passage.
 *
 * Something is always returned. When nothing fits, the preferred side is used
 * and clamped: a bubble slightly over her is legible, and no bubble is not.
 */
/** Where a box of this size would go on one particular side, if it went there. */
function on(
  side: Side,
  her: Body,
  box: { readonly w: number; readonly h: number },
  room: Room,
  reach: Reach,
): { readonly x: number; readonly y: number; readonly fits: boolean } {
  const centredX = clamp(her.left + her.width / 2 - box.w / 2, room.left, room.right - box.w)
  const centredY = clamp(her.top + her.height / 2 - box.h / 2, room.top, room.bottom - box.h)
  const off = reachOn(side, reach)

  if (side === 'above') {
    const y = her.top - off - box.h
    return { x: centredX, y, fits: y >= room.top }
  }
  if (side === 'below') {
    const y = her.top + her.height + off
    return { x: centredX, y, fits: y + box.h <= room.bottom }
  }
  if (side === 'left') {
    const x = her.left - off - box.w
    return { x, y: centredY, fits: x >= room.left }
  }
  const x = her.left + her.width + off
  return { x, y: centredY, fits: x + box.w <= room.right }
}

/** Every side a box of this size could actually be put on, in the standing order. */
export function sidesThatFit(
  her: Body,
  box: { readonly w: number; readonly h: number },
  room: Room,
  reach: Reach,
): readonly Side[] {
  return ORDER.filter((side) => on(side, her, box, room, reach).fits)
}

export function placeBubble(
  her: Body,
  box: { readonly w: number; readonly h: number },
  room: Room,
  reach: Reach,
  prefer: SidePreference = 'auto',
): Placed {
  // A chosen side wins whenever it fits. When it does not, the standing order
  // takes over rather than the choice being forced — a bubble half off the
  // display honours nothing.
  if (prefer !== 'auto') {
    const asked = on(prefer, her, box, room, reach)
    if (asked.fits) return { x: asked.x, y: asked.y, side: prefer }
  }

  for (const side of ORDER) {
    const spot = on(side, her, box, room, reach)
    if (spot.fits) return { x: spot.x, y: spot.y, side }
  }

  // Nothing fits anywhere: above, clamped. A bubble slightly over her is
  // legible, and no bubble is not.
  const last = on('above', her, box, room, reach)
  return {
    x: last.x,
    y: clamp(last.y, room.top, Math.max(room.top, room.bottom - box.h)),
    side: 'above',
  }
}
