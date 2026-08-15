/**
 * Dragging her around the desktop.
 *
 * Its own module because it is a self-contained concern with its own timer,
 * its own bounds arithmetic and its own boundary parsing -- and because
 * `index.ts` is meant to be a composition root rather than the place every
 * behaviour ends up living.
 *
 * The state is a single interval handle held here. That is deliberate: a drag
 * is at most one at a time by nature, and giving the timer to the module that
 * owns it means nothing else can forget to clear it.
 */

import { screen, type BrowserWindow, type Rectangle } from 'electron'
import type { DragStartPayload } from '@shared/ipc'
import { clamp, containToWorkArea } from './placement'

/** How often a drag repositions the window. One frame at 60Hz. */
const DRAG_TICK_MS = 16
/** Backstop for a renderer that never sends dragEnd -- a crash, a lost event. */
const DRAG_MAX_MS = 60_000

let dragTimer: NodeJS.Timeout | null = null

export function stopDrag(): void {
  if (!dragTimer) return
  clearInterval(dragTimer)
  dragTimer = null
}

/**
 * Dragging polls the cursor from main rather than accumulating mousemove deltas
 * in the renderer.
 *
 * While dragging a frameless window the cursor routinely leaves the window
 * bounds, at which point the renderer stops receiving events entirely and she
 * sticks to the edge of wherever the pointer escaped. `getCursorScreenPoint`
 * has no such limit.
 */
export function startDrag(offset: DragStartPayload, liveWindow: () => BrowserWindow | null): void {
  stopDrag()
  const deadline = Date.now() + DRAG_MAX_MS
  dragTimer = setInterval(() => {
    const target = liveWindow()
    if (!target || Date.now() > deadline) return stopDrag()
    const cursor = screen.getCursorScreenPoint()
    // Clamped, so a drag cannot put her somewhere with no way back. The tray
    // only toggled visibility, so a window dragged past the edge was gone for
    // the rest of the run and looked exactly like a crash.
    const at = containToWorkArea(
      cursor.x - offset.offsetX,
      cursor.y - offset.offsetY,
      target.getBounds(),
    )
    target.setPosition(at.x, at.y)
  }, DRAG_TICK_MS)
}

/**
 * Normalise rather than merely type-check: clientX/Y are fractional on scaled
 * displays, and an offset outside the window would fling her off-screen.
 */
export function parseDragStart(value: unknown, bounds: Rectangle): DragStartPayload | null {
  if (typeof value !== 'object' || value === null) return null
  const { offsetX, offsetY } = value as Record<string, unknown>
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return null
  return {
    offsetX: clamp(Math.round(offsetX as number), 0, bounds.width),
    offsetY: clamp(Math.round(offsetY as number), 0, bounds.height),
  }
}
