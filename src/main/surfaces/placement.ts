/**
 * Keeping a window somewhere a person can reach it.
 *
 * Its own module because two callers need the same guarantee and neither owns
 * it: `drag.ts` clamps while the cursor moves her, and `index.ts` clamps after
 * a resize changes how much room she takes. `index.ts` had the documentation
 * block for this function and no function under it — the comment described the
 * abstraction, the abstraction lived inside the drag loop, and the resize path
 * had neither.
 */

import { screen } from 'electron'

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Origin {
  readonly x: number
  readonly y: number
}

/**
 * Keep an origin inside a display that exists.
 *
 * Clamped against the display nearest the window's own CENTRE, not the
 * cursor's. During a drag those agree; a later caller's cursor could be on
 * another screen entirely and would teleport her to it.
 *
 * A window LARGER than the work area is pinned to its top-left rather than
 * clamped. Without that case the two bounds cross — the maximum origin is left
 * of the minimum — and `clamp` returns the maximum, placing her further off
 * screen than the value it was asked to correct. That is the one input for
 * which this function used to do the opposite of its name.
 */
export function containToWorkArea(x: number, y: number, size: Size): Origin {
  const { workArea } = screen.getDisplayNearestPoint({
    x: x + size.width / 2,
    y: y + size.height / 2,
  })
  return {
    x: clamp(x, workArea.x, workArea.x + Math.max(0, workArea.width - size.width)),
    y: clamp(y, workArea.y, workArea.y + Math.max(0, workArea.height - size.height)),
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
