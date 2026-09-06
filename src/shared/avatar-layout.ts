/**
 * Where her WINDOW goes, given how big she is.
 *
 * The sizing itself moved to `@hando/dough` — it is a property of the character
 * rather than of Electron, and the package needs it to draw her at all. What
 * stays here is the half that is genuinely about a desktop window: the padding
 * around her, the status line under her, and the fixed canvas the app ships.
 *
 * The engine half is re-exported rather than re-imported at every call site, so
 * the nineteen files that read this module did not have to change.
 */

export {
  SQUASH_LIMIT,
  LEAN_LIMIT,
  BREATHING_UNITS,
  BASE_UNIT_SCALE,
  FEET_FROM_TOP,
  SIZE_PERCENT,
  worstCaseUnits,
  clampSizePercent,
  layoutFor,
  fitToCanvas,
} from '@hando/dough'

import { FEET_FROM_TOP } from '@hando/dough'

/**
 * What has to fit around her body, in CSS pixels on each side.
 *
 * Her window is a shape on the desktop rather than a rectangle she sits in, so
 * the only number that matters is how much room the things drawn AROUND her
 * need — the chip at her shoulder, the held beat, the status line, and a speech
 * bubble when there is one. Everything else is empty pixels.
 */
export interface Pad {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** The window that fits her body plus that padding, and nothing more. */
export function windowFitting(
  body: { readonly width: number; readonly height: number },
  pad: Pad,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.ceil(body.width + pad.left + pad.right)),
    height: Math.max(1, Math.ceil(body.height + pad.top + pad.bottom)),
  }
}

/**
 * Where to put that window so HER position on the screen does not change.
 *
 * The whole point of resizing her window is that she is the fixed thing and the
 * window is not. Resizing without this moves her, because a window grows from
 * its origin — and she would slide across the desktop every time she started
 * speaking, which is worse than a window that is too big.
 */
export function originHolding(
  herOnScreen: { readonly x: number; readonly y: number },
  pad: Pad,
): { x: number; y: number } {
  return { x: Math.round(herOnScreen.x - pad.left), y: Math.round(herOnScreen.y - pad.top) }
}

/**
 * Where her body is on screen, from the two facts that are certain.
 *
 * ## Neither process can answer this alone, and one of them used to pretend to
 *
 * Main knows the window's origin, authoritatively, from `getBounds()`. It does
 * NOT reliably know her offset inside it: that arrives by message, and pairing
 * an offset from one message with bounds from another put her 443px from a
 * corner she had been 4px from.
 *
 * The renderer knows her offset for certain — it is the layout it is drawing —
 * and appeared to know the window's position too, from `window.screenX`. That
 * was the trap. A renderer's screen coordinates are a cached rect Chromium
 * refreshes on notifications it does not reliably receive for a frameless
 * transparent window moved by `setPosition`; it answered `0` for a window main
 * had placed at 1957,1058, and went on answering `0` after the window was
 * shown. Main believed it and moved her to 443,267 — `fullPad`'s own offsets
 * from an origin nobody had ever seen.
 *
 * ## So each side gives the half it holds
 *
 * The offset comes in the fit message; the origin is read in the handler that
 * receives it. Both from one moment, and neither is a coordinate the process
 * supplying it has to infer.
 */
export function herPositionFrom(
  windowOrigin: { readonly x: number; readonly y: number },
  offsetInWindow: { readonly left: number; readonly top: number },
): { x: number; y: number } {
  return { x: windowOrigin.x + offsetInWindow.left, y: windowOrigin.y + offsetInWindow.top }
}

/**
 * The pad that reproduces the old fixed window exactly.
 *
 * Used while a bubble is up, because the bubble's own rectangle is computed deep
 * inside `bubble.ts` at draw time and asking for it here would be a second place
 * that geometry lives. `WINDOW_W` x `WINDOW_H` is the measured worst case — a
 * whole bubble beside her at 200% — so it is right, it is merely generous, and
 * it is generous only while she is actually speaking.
 */
export function fullPad(body: { readonly width: number; readonly height: number }): Pad {
  const left = Math.round(WINDOW_W / 2 - body.width / 2)
  const top = Math.round(FEET_FROM_TOP - body.height)
  return {
    left,
    top,
    right: WINDOW_W - left - Math.round(body.width),
    bottom: WINDOW_H - top - Math.round(body.height),
  }
}

/**
 * How far under her the status line sits, and how much room it needs.
 *
 * A fraction of her height rather than a pixel count, because `size` is a
 * persona field. One source, read by `placeStatus` in the renderer and by the
 * pad that has to leave room for what it places — two numbers here would drift
 * into a status line that hangs off the bottom of her own window.
 */
export const STATUS_UNDER = 0.22
export const STATUS_ROOM = 24

export const WINDOW_W = 980
export const WINDOW_H = 560
