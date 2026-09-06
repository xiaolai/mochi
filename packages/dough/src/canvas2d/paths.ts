/**
 * Points to a Path2D.
 *
 * Shared because a feature that can be FILLED can also be CLIPPED to, and that
 * is how the catchlight is kept inside the eye. An earlier version drew
 * straight onto the context and left no object to clip against.
 */

import type { Point } from './geometry'

/** Local +y-up has already been flipped by the caller. */
export function toPath(points: readonly Point[]): Path2D {
  const path = new Path2D()
  points.forEach((point, index) => {
    if (index === 0) path.moveTo(point.x, point.y)
    else path.lineTo(point.x, point.y)
  })
  path.closePath()
  return path
}

/** An outline given in +y-up local space, as a canvas-space Path2D at `x, y`. */
export function outlinePath(points: readonly Point[], x: number, y: number): Path2D {
  return toPath(points.map((point) => ({ x: x + point.x, y: y - point.y })))
}
