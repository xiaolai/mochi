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

export function startDrag(
  grip: Grip,
  liveWindow: () => BrowserWindow | null,
  body: () => { left: number; top: number; width: number; height: number },
): void {
  stopDrag()
  const deadline = Date.now() + MAX_MS
  timer = setInterval(() => {
    const target = liveWindow()
    if (target === null || target.isDestroyed() || Date.now() > deadline) return stopDrag()
    const cursor = screen.getCursorScreenPoint()
    // Clamped, so a drag cannot put her somewhere with no way back. Dragged
    // past an edge she would be gone for the rest of the run and it would look
    // exactly like a crash.
    const at = containToWorkArea(
      cursor.x - grip.offsetX,
      cursor.y - grip.offsetY,
      body(),
      KEEP_ON_SCREEN,
    )
    target.setPosition(at.x, at.y)
  }, TICK_MS)
}
