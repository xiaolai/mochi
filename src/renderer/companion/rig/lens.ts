/**
 * The lens: the region between an upper edge and a lower edge.
 *
 * One primitive for both the eyes and the mouth, and that unification is the
 * design rather than a saving. Because both edges are independently signed, a
 * single shape covers every state the face needs:
 *
 *   upper +, lower +   a dot, or an open mouth
 *   upper ~0, lower ~0 a closed sliver -- a blink
 *   upper +, lower -   a crescent -- the ^ ^ happy eye
 *   upper -, lower +   a frown
 *
 * A NEGATIVE lower is the trick worth naming: it curves the bottom edge upward
 * past the baseline, which is what turns an eye into a smile without a second
 * asset and without a special case. Lip-sync and expression therefore drive one
 * code path, so a mouth cannot be open according to one and shut according to
 * the other.
 *
 * Each edge is half a SUPERELLIPSE, not a quadratic. The first version used
 * quadratics and every eye came out a pointed almond, because two quadratics
 * meeting at the corners always meet at an angle -- there is no value of the
 * parameters that produces a round dot. A superellipse at `roundness` 2 is an
 * ellipse, so the two halves join with a shared vertical tangent and the corner
 * disappears; below 2 it sharpens toward a leaf, above 2 it squares off.
 *
 * Local space, origin at the lens centre, +y UP -- the same convention as
 * geometry.ts.
 */

import type { Point } from './geometry'

export interface LensShape {
  readonly halfWidth: number
  /** How far the top edge bulges above the baseline. Negative dips it below. */
  readonly upper: number
  /** How far the bottom edge dips below the baseline. Negative lifts it above. */
  readonly lower: number
  /** Radians. Mirror it per side so both inner corners move the same way. */
  readonly tilt: number
  /** Superellipse exponent. 2 is an ellipse; below sharpens, above squares off. */
  readonly roundness: number
}

function rotate(x: number, y: number, sin: number, cos: number): Point {
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

export function lensOutline(lens: LensShape, steps = 28): Point[] {
  const hw = Math.max(0, lens.halfWidth)
  const k = Math.max(0.5, lens.roundness)
  const power = 2 / k
  const sin = Math.sin(lens.tilt)
  const cos = Math.cos(lens.tilt)

  const points: Point[] = []
  // Right, over the top, to left; then left, under the bottom, back to right.
  // Parametrised by angle rather than by x so the samples stay evenly spread
  // around the curve instead of bunching at the ends.
  const half = (extent: number, from: number, to: number): void => {
    for (let i = 0; i <= steps; i++) {
      const t = from + (to - from) * (i / steps)
      const c = Math.cos(t)
      const s = Math.sin(t)
      const x = hw * Math.sign(c) * Math.pow(Math.abs(c), power)
      const y = extent * Math.sign(s) * Math.pow(Math.abs(s), power)
      points.push(rotate(x, y, sin, cos))
    }
  }
  // Over the top with `upper`, then under the bottom with `lower`. On the lower
  // sweep sin(t) is negative, so the formula already flips the sign -- passing
  // `lower` unnegated is what makes a POSITIVE lower dip below the baseline and
  // a negative one bow above it.
  half(lens.upper, 0, Math.PI)
  half(lens.lower, Math.PI, Math.PI * 2)
  return points
}

/**
 * Peak vertical extent, used to offset gaze so the pupil moves within the eye
 * rather than by a fraction of nothing when the lid is nearly shut.
 */
export function lensHeight(lens: LensShape): number {
  return Math.max(Math.abs(lens.upper), Math.abs(lens.lower))
}
