/**
 * How much screen there is, and which sides of her a bubble would fit on.
 *
 * Pulled out of the `showFace` closure for the same reason as `her-geometry`:
 * a module that resolves a palette off `document` at load cannot be imported
 * by a test, and "which sides fit" is a decision worth being able to check.
 *
 * `availableScreen` reads `availLeft`/`availTop` through a narrow cast. They
 * are real and implemented but live in the CSSOM View spec's appendix rather
 * than its interface, and widening `Screen` globally would let a typo compile
 * anywhere else in the app.
 */

/** How close to the edge of the display a bubble may sit. */
const SCREEN_INSET = 8

import { BUBBLE_REACH, WIDEST_BUBBLE } from './bubble'
import {
  type Room,
  type Side,
  type SidePreference,
  placeBubble,
  roomFor,
  sidesThatFit,
} from './place'
import { WINDOW_H, WINDOW_W, fullPad } from '@shared/avatar-layout'
/**
 * Where the bubble may go, in canvas pixels — read from the DOM, not from main.
 *
 * `screenX`/`screenY` and `screen.avail*` are standard and available here, so
 * the renderer already knows where its window sits and where the usable
 * screen is. Asking main for it would be a message, a cache and a staleness
 * question, for an answer the page can read directly on the frame it needs it.
 *
 * Read every frame rather than on a move event: she is dragged by main
 * repositioning the window, so there is no event here to hang it on, and the
 * read is two properties.
 */
/**
 * Which sides the menu may offer, asked EVERY frame and about the widest
 * bubble that can exist.
 *
 * ## What it replaces, and the two things that were wrong with it
 *
 * This was `bubble.offered()`, set inside the drawing. `draw` returns early
 * when there is nothing to say — `if (text === '') return false` — without
 * touching it, so the answer froze at her last utterance and stopped tracking
 * her the moment she went quiet. Dragged across the display, the menu went on
 * describing the corner she had spoken from.
 *
 * And it measured the box she HAPPENED to say, so the same position offered
 * different sides for a short reply and a long one.
 *
 * ## Why the geometry is the big window's, not the one she is in
 *
 * With nothing on screen her window is about 146px wide, and no bubble fits
 * beside her in that at any position — which is exactly why the question used
 * to be asked only while a bubble was already up and the window was already
 * big. The menu is about where her NEXT words go, so it asks against the
 * window she will have when she has some: `fullPad`, which is what
 * `padNeeded` returns the instant there is text.
 *
 * ## The window origin is TOLD, not read
 *
 * This used to read `window.screenX`/`screenY` and said they were "sound here,
 * because she is only shown once she has been fitted, so by the time this runs
 * the window is on screen and reporting its real position." `face.ts` says the
 * opposite about the same API and backs it with a measurement — "a cached rect
 * Chromium refreshes on notifications it does not reliably get for a frameless
 * transparent window moved by `setPosition`... it reported `0` for a window main
 * had placed at 1957,1058 — including after the window was shown."
 *
 * Two comments, one API, and only one of them measured. Measured again on
 * 2026-08-28: main placed her at 2384,1299 and fitted to 2384,1326, and the
 * renderer reported 1299 — minutes later, still 1299. It does not catch up.
 *
 * 27px is what a fit costs. A DRAG is unbounded: main moves her with
 * `setPosition` on every tick, so after crossing the screen this computed the
 * room from wherever she was at launch — advertising sides that do not fit and
 * sizing the room against the wrong edge.
 *
 * So the origin is passed IN. `face.ts` already reached this answer for the
 * same problem — "the renderer sends the half it genuinely knows" and main
 * pairs it with `getBounds()` — and this is the other direction of it: main
 * knows where the window is, so main says.
 */
export function sidesFor(
  box: { left: number; top: number; width: number; height: number },
  bubbleSide: SidePreference,
  /**
   * Where main last put the window, in screen coordinates.
   *
   * NULL before main has said, which is the one case `window.screenX` is
   * actually good for: nothing has moved the window yet, so the value it
   * cached at load is still true.
   */
  windowOrigin: { x: number; y: number } | null,
): {
  available: readonly Side[]
  using: Side
  /** What it decided from, so a surprising answer can be checked at a glance. */
  from: { body: string; box: string; room: string }
} | null {
  const full = fullPad({ width: box.width, height: box.height })
  // Where the big window would sit to leave her exactly where she is.
  const at = windowOrigin ?? { x: window.screenX, y: window.screenY }
  const origin = {
    x: at.x + box.left - full.left,
    y: at.y + box.top - full.top,
  }
  const room = roomFor(
    { width: WINDOW_W, height: WINDOW_H },
    origin,
    availableScreen(),
    SCREEN_INSET,
  )
  const her = { left: full.left, top: full.top, width: box.width, height: box.height }
  const available = sidesThatFit(her, WIDEST_BUBBLE, room, BUBBLE_REACH)
  if (available.length === 0) return null
  /*
    What it WOULD use, from the same call that listed them.

    The menu marks what was asked for and the bubble goes where it fits, and
    those differ whenever a chosen side stopped fitting. `placeBubble` is the
    one function that decides, so asking it here rather than reading back what
    the last drawing chose keeps the two from ever disagreeing.
  */
  return {
    available,
    using: placeBubble(her, WIDEST_BUBBLE, room, BUBBLE_REACH, bubbleSide).side,
    from: {
      body: `${String(her.left)},${String(her.top)} ${String(her.width)}x${String(her.height)}`,
      box: `${String(WIDEST_BUBBLE.w)}x${String(WIDEST_BUBBLE.h)}`,
      room: `${String(room.left)},${String(room.top)} to ${String(room.right)},${String(room.bottom)}`,
    },
  }
}

/**
 * The usable screen, read once for the two callers that need it.
 *
 * `roomOnScreen` places the bubble that is being drawn; `sidesForTheMenu`
 * asks what could be drawn. Two copies of this read would be two answers to
 * where the screen ends, and the menu would be entitled to disagree with the
 * drawing about it.
 */
export function availableScreen(): { x: number; y: number; width: number; height: number } {
  return {
    // `availLeft`/`availTop` are real and implemented, and are missing from
    // the DOM lib's `Screen` — they are in the CSSOM View spec's appendix
    // rather than its interface. Read through a narrow cast rather than
    // widening `Screen` globally, which would let a typo elsewhere compile.
    x: (window.screen as unknown as { availLeft?: number }).availLeft ?? 0,
    y: (window.screen as unknown as { availTop?: number }).availTop ?? 0,
    width: window.screen.availWidth,
    height: window.screen.availHeight,
  }
}

/**
 * The room around the window the bubble is actually drawn into.
 *
 * Takes the origin for `sidesFor`'s reason, and this is the half that shows: it
 * places the bubble, the shoulder chip and their hit regions, so a stale origin
 * puts the chip somewhere a click does not land and can flip the bubble to a
 * side with no room on it.
 */
export function roomOnScreen(
  canvas: HTMLCanvasElement,
  windowOrigin: { x: number; y: number } | null,
): Room {
  return roomFor(
    { width: canvas.clientWidth, height: canvas.clientHeight },
    windowOrigin ?? { x: window.screenX, y: window.screenY },
    availableScreen(),
    SCREEN_INSET,
  )
}
