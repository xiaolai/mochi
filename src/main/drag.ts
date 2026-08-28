/**
 * Moving her around the desktop.
 *
 * She could not be moved at all until now: her window is frameless, so there is
 * no title bar to grab, and nothing had taken its place. A desktop companion
 * that lands wherever the first launch put her and stays there is furniture
 * bolted to the floor.
 *
 * ## The cursor is polled from MAIN, not accumulated in the renderer
 *
 * This is the whole reason the module exists rather than a `mousemove` handler
 * beside the click one. While dragging a frameless window the cursor routinely
 * leaves the window's bounds — it is moving faster than the window follows —
 * and at that moment the renderer stops receiving events entirely, so she
 * sticks to the edge of wherever the pointer escaped and has to be nudged again
 * to get going. `screen.getCursorScreenPoint()` has no such limit; it answers
 * wherever the cursor is.
 *
 * Carried over from v1, which learned it the hard way, along with the two
 * guards below.
 */

import { screen, type BrowserWindow, type Rectangle } from 'electron'

/** How often a drag repositions the window. One frame at 60Hz. */
const TICK_MS = 16
/**
 * A backstop for a renderer that never says it finished — a crash, a lost
 * mouseup, a reload mid-drag. Without it the interval runs for the life of the
 * process and she follows the cursor around the screen for ever.
 */
const MAX_MS = 60_000

/** Where in the window she was grabbed, so she does not jump on the first tick. */
export interface Grip {
  readonly offsetX: number
  readonly offsetY: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Keep HER on a display that exists — not her window.
 *
 * The distinction is the whole of this function now. Her window is far larger
 * than she is, because the bubble is drawn inside it and has to be able to go
 * above, below or beside her, so with her in a corner most of the window hangs
 * off the display ON PURPOSE. Clamping the window would refuse to let her near
 * any edge and would park her hundreds of pixels inland.
 *
 * `body` is where she is INSIDE the window, sent up by the renderer — the only
 * thing that knows her size and where she stands.
 *
 * Clamped against the display nearest HER centre, not the cursor's and not the
 * window's. During a drag hers and the cursor's agree; the window's centre can
 * be on another display entirely once the overhang is this big.
 *
 * A body LARGER than the work area is pinned to the near edge rather than
 * clamped. Without that case the two bounds cross — the maximum is left of the
 * minimum — and `clamp` returns the maximum, placing her FURTHER off screen
 * than the value it was asked to correct. That is the one input for which this
 * used to do the opposite of its name.
 */
export function containToWorkArea(
  x: number,
  y: number,
  body: { left: number; top: number; width: number; height: number },
  keep: number,
): { x: number; y: number } {
  const { workArea } = screen.getDisplayNearestPoint({
    x: x + body.left + body.width / 2,
    y: y + body.top + body.height / 2,
  })
  // Expressed as the WINDOW origin, because that is what `setPosition` takes.
  // Every line is the work area translated by her inset within the window.
  const minX = workArea.x + keep - body.left
  const maxX = workArea.x + workArea.width - keep - body.left - body.width
  const minY = workArea.y + keep - body.top
  const maxY = workArea.y + workArea.height - keep - body.top - body.height
  return {
    x: clamp(x, minX, Math.max(minX, maxX)),
    y: clamp(y, minY, Math.max(minY, maxY)),
  }
}

/**
 * How much daylight is kept between her and the edge of the display.
 *
 * Zero would let her sit exactly flush with it, which reads as half of her
 * having fallen off. A few pixels is what "in the corner" looks like.
 */
export const KEEP_ON_SCREEN = 4

/**
 * Normalise rather than merely type-check.
 *
 * `clientX`/`clientY` are fractional on a scaled display, and an offset outside
 * the window would fling her off screen on the first tick — the grip is
 * subtracted from the cursor, so a grip of 4000 puts her origin 4000 pixels to
 * the left of the pointer.
 */
export function parseGrip(value: unknown, bounds: Rectangle): Grip | null {
  if (typeof value !== 'object' || value === null) return null
  const { offsetX, offsetY } = value as Record<string, unknown>
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return null
  return {
    offsetX: clamp(Math.round(offsetX as number), 0, bounds.width),
    offsetY: clamp(Math.round(offsetY as number), 0, bounds.height),
  }
}

/**
 * One drag at a time, by nature, so one timer — held here rather than passed
 * around, which means nothing else can forget to clear it.
 */
let timer: NodeJS.Timeout | null = null

export function stopDrag(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

/**
 * Where the window goes, and how high she stands in it, for one cursor position.
 *
 * Expressed entirely in terms of HER. The window and the stance are both
 * derived at the end, which is what makes this reversible: an earlier version
 * subtracted from the CURRENT stance, so once she had been raised she never
 * came back down — dragged to the top and back to the corner, she stayed
 * standing at the top of her canvas with the bubble stuck below her.
 *
 * The two answers are one calculation. **macOS will not put a window's top
 * above the work area** — no overhang there, unlike the other three edges — so
 * whatever the window cannot rise by, she rises by inside it. Her position on
 * screen is what was asked for either way, which is the only thing that makes
 * dragging her to the top of the display feel like anything at all.
 */
export function dragTo(
  cursor: { x: number; y: number },
  /** Where within HER body the pointer went down. Not within the window. */
  gripInHer: { x: number; y: number },
  her: { left: number; width: number; height: number },
  work: { x: number; y: number; width: number; height: number },
  keep: number,
  defaultFeet: number,
  minimumFeet: number,
): { readonly x: number; readonly y: number; readonly feetFromTop: number } {
  // Where she wants to be, kept on the display — a drag cannot put her
  // somewhere with no way back.
  const left = clamp(
    cursor.x - gripInHer.x,
    work.x + keep,
    Math.max(work.x + keep, work.x + work.width - keep - her.width),
  )
  const top = clamp(
    cursor.y - gripInHer.y,
    work.y + keep,
    Math.max(work.y + keep, work.y + work.height - keep - her.height),
  )

  /**
   * She stands as low in her canvas as the default allows, and higher only
   * where the window would otherwise have to rise above the work area.
   *
   * Derived from `defaultFeet` every tick, never from the last answer, so it
   * returns to normal the moment there is room again.
   */
  const feetFromTop = clamp(
    Math.min(defaultFeet, top + her.height - work.y),
    minimumFeet,
    defaultFeet,
  )

  /*
    WHOLE PIXELS, because `setPosition` refuses anything else.

    Her body is `bodyH * BASE_UNIT_SCALE` — 78 x 0.94 = 73.32 — so `top +
    her.height - feetFromTop` is a fraction, and Electron's native binding does
    not truncate it: `setPosition(x, 1436.32)` throws `Error processing argument
    at index 1, conversion failure from`, with nothing after the "from" because a
    double renders as empty there. Measured against a real window: an integer is
    accepted, a float throws that exact message, and so does NaN — which is what
    made it look like a null rather than a rounding problem.

    It threw on EVERY tick of the drag interval, so a single drag produced a wall
    of identical uncaught exceptions and moved her nowhere: the throw happens
    before `onStance`, so nothing downstream ran either.

    Rounded here rather than at the call site because this function's whole job
    is answering where the window goes, and half an answer is a crash.
  */
  return {
    x: Math.round(left - her.left),
    y: Math.round(top + her.height - feetFromTop),
    feetFromTop,
  }
}

export function startDrag(
  grip: Grip,
  liveWindow: () => BrowserWindow | null,
  body: () => { left: number; top: number; width: number; height: number },
  onStance: (feetFromTop: number, origin: { x: number; y: number }) => void,
  defaultFeet: number,
): void {
  stopDrag()
  const deadline = Date.now() + MAX_MS
  // Taken ONCE, against the body as it was when she was grabbed. Recomputing it
  // each tick against a body that this drag is moving would make the grip chase
  // itself the moment the stance changed.
  const held = body()
  const gripInHer = { x: grip.offsetX - held.left, y: grip.offsetY - held.top }

  timer = setInterval(() => {
    const target = liveWindow()
    if (target === null || target.isDestroyed() || Date.now() > deadline) return stopDrag()
    const cursor = screen.getCursorScreenPoint()
    const { workArea } = screen.getDisplayNearestPoint(cursor)
    const to = dragTo(
      cursor,
      gripInHer,
      held,
      workArea,
      KEEP_ON_SCREEN,
      defaultFeet,
      held.height + FLOOR_CLEARANCE,
    )
    target.setPosition(to.x, to.y)
    // WHERE IT NOW IS, on the tick that moved it. The renderer cannot read this
    // for itself — `window.screenX` is a cached rect Chromium does not refresh
    // reliably for a frameless transparent window moved by `setPosition` — so
    // a drag left every screen-relative decision in the renderer computed
    // against wherever she was at launch.
    onStance(to.feetFromTop, { x: to.x, y: to.y })
  }, TICK_MS)
}

/**
 * The gap kept under her feet when she stands at the very top of her canvas.
 *
 * Her own breathing room, in round pixels rather than design units, because
 * this is a floor rather than a layout: a few pixels either way is invisible,
 * and the alternative is threading her scale through the drag.
 */
const FLOOR_CLEARANCE = 10
