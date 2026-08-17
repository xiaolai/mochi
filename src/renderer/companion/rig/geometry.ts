/**
 * The mochi's silhouette, as arithmetic.
 *
 * Deliberately canvas-free: these functions return points, and the backend
 * turns points into a Path2D. That is what makes the shape testable without a
 * rasteriser, and it is also what makes hit testing exact -- the polygon that
 * is filled and the polygon that is hit-tested are the same array.
 *
 * Local space throughout: origin at the point where she meets the surface,
 * +y UP. The renderer flips. Heights read as positive numbers here, which is
 * worth the one transform at the boundary.
 *
 * The shape is an OVOID, not a dome, and that came from measuring
 * `rig/__fixtures__/mochi-icon.png` rather than from taste. The first version of this file
 * was a single superellipse planted on a flat base, which put the widest point
 * at the bottom -- and the icon's widest point is at 0.295 of its height, with
 * a rounded underside. Those are different creatures, and the difference is
 * exactly what makes one read as a dumpling and the other as a mochi.
 */

// Imported rather than declared: the window has to be sized for the widest
// frame she can reach, so main needs this number too. Two copies would let the
// window and the shape disagree about how far she leans.
//
// This was a RELATIVE, extension-suffixed import for a specific reason:
// `scripts/make-icons.ts` imported this module under bare `node`, which resolves
// no path aliases -- and switching to `@shared` once broke `pnpm icons` while
// every other gate stayed green, because nothing in `pnpm verify` ran the
// generator.
//
// That generator went to the archive with the v1 rig, so the constraint is gone
// and the alias is correct again. If an icon generator returns and runs outside
// the bundler, this line is the one that breaks first -- and it will break
// silently, so give it a gate that runs the generator rather than restoring the
// relative path and hoping.
import { SHEAR_GAIN } from '@shared/avatar-layout'

export interface Point {
  readonly x: number
  readonly y: number
}

export interface BodyShape {
  readonly halfWidth: number
  readonly height: number
  /**
   * Height of the widest point, as a fraction of height.
   *
   * Measured 0.295 on the icon. At 0 this degenerates to the old flat-based
   * dome; at 0.5 it is a symmetric egg.
   */
  readonly waist: number
  /**
   * Superellipse exponent ABOVE the waist. Measured 1.86.
   *
   * Below 2 is pointier than an ellipse, which is what gives the icon its soft
   * peak rather than a hemispherical top.
   */
  readonly upperShoulder: number
  /**
   * Superellipse exponent BELOW the waist. Measured 2.58.
   *
   * Above 2 is fuller than an ellipse: the underside stays wide and then turns
   * quickly, which is what makes her look like she is resting her weight on the
   * desk instead of balancing on a curve.
   */
  readonly lowerShoulder: number
  /** -1..1. Shear that grows with height, so she leans like dough rather than tipping like a box. */
  readonly lean: number
}

/**
 * Squash, preserving area.
 *
 * `halfWidth * factor` and `height / factor`: the ovoid's area is
 * proportional to the product for fixed exponents, so this is exactly
 * volume-preserving. That is the property that makes it read as dough being
 * compressed rather than as a picture being scaled.
 *
 * The factor is floored well above zero. A squash of -1 would otherwise divide
 * by zero and produce an infinitely tall mochi.
 */
export function squashed(shape: BodyShape, amount: number): BodyShape {
  const safe = Number.isFinite(amount) ? Math.max(-0.9, Math.min(0.9, amount)) : 0
  const factor = 1 + safe
  return { ...shape, halfWidth: shape.halfWidth * factor, height: shape.height / factor }
}

/**
 * Horizontal displacement at a given height above the base.
 *
 * Zero at the base and maximal at the apex, which is what distinguishes a lean
 * from a translation: her contact point stays where it was.
 */
export function shearAt(shape: BodyShape, heightAboveBase: number): number {
  if (shape.height <= 0) return 0
  const t = Math.max(0, Math.min(1, heightAboveBase / shape.height))
  return shape.lean * shape.halfWidth * SHEAR_GAIN * t
}

/** Superellipse half-width at normalised distance `t` from the waist, 0..1. */
function profile(t: number, exponent: number): number {
  const n = Math.max(0.2, exponent)
  return Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.max(0, t)), n)), 1 / n)
}

/**
 * Half-width at a height, as a fraction of halfWidth.
 *
 * Exported because it is the cheapest way to compare this shape against the
 * measured icon: the test walks heights and checks the profile, which pins the
 * silhouette to the artwork rather than to whatever looked right on the day.
 */
export function widthAt(shape: BodyShape, heightFraction: number): number {
  const t = Math.min(1, Math.max(0, heightFraction))
  const waist = Math.min(0.95, Math.max(0, shape.waist))
  if (t >= waist) {
    // No `waist >= 1` guard: the clamp above caps it at 0.95, so the divisor
    // is at least 0.05 by construction. The guard implied a division by zero
    // that this function has already made impossible.
    return profile((t - waist) / (1 - waist), shape.upperShoulder)
  }
  const below = waist <= 0 ? 1 : (waist - t) / waist
  return profile(below, shape.lowerShoulder)
}

/**
 * The closed outline, from the contact point up the right side and back down
 * the left.
 *
 * The base sits exactly on y = 0 and the body occupies y > 0, so "resting on a
 * surface" is a property of the coordinates rather than something the caller
 * has to arrange. Squash therefore grows upward, which is how something resting
 * on a table actually deforms.
 */
export function domeOutline(shape: BodyShape, steps = 96): Point[] {
  const a = Math.max(1e-6, shape.halfWidth)
  const b = Math.max(1e-6, shape.height)
  const waist = Math.min(0.95, Math.max(0, shape.waist))
  // Delegated rather than restated. This was a second copy of the lean formula
  // with the same three factors in the same order, and two copies of an
  // expression are two things that can be tuned apart. The guarded dimensions
  // are what differed, so they go into the shape instead of into the formula.
  const guarded: BodyShape = { ...shape, halfWidth: a, height: b }
  const shear = (y: number): number => shearAt(guarded, y)

  // The right-hand profile, bottom to top. Sampled separately above and below
  // the waist so neither half is starved of points when the waist sits low --
  // and it does sit low, at 0.295.
  const right: Point[] = []
  const lowerSteps = Math.max(8, Math.round(steps * waist))
  const upperSteps = Math.max(8, steps - lowerSteps)

  for (let i = 0; i <= lowerSteps; i++) {
    const t = waist * (i / lowerSteps)
    const y = t * b
    right.push({ x: a * widthAt(shape, t) + shear(y), y })
  }
  for (let i = 1; i <= upperSteps; i++) {
    const t = waist + (1 - waist) * (i / upperSteps)
    const y = t * b
    right.push({ x: a * widthAt(shape, t) + shear(y), y })
  }

  // Mirror back down the left. Both endpoints are dropped: they sit on the
  // axis, so keeping them would duplicate the apex and the contact point and
  // leave a zero-length segment at each -- which some rasterisers render as a
  // stray join.
  const left = right
    .slice(1, -1)
    .reverse()
    .map((point) => ({ x: -(point.x - shear(point.y)) + shear(point.y), y: point.y }))

  return [...right, ...left]
}

/**
 * Where a feature sits, in body-local space.
 *
 * `grip` is the point of this function. At 1 the face deforms exactly as much
 * as the body and looks printed on; at 0 it floats, unaffected. Real features
 * on something soft resist deformation without escaping it, so the placement
 * interpolates between the squashed and unsquashed frames. That single number
 * is most of what makes it read as a face ON something rather than a decal.
 *
 * The lean is measured in that SAME interpolated frame. It used to be taken
 * from the squashed one unconditionally, which quietly broke the contract: a
 * zero-grip feature was placed at its undeformed width and then displaced by a
 * shear computed from the wider, shorter squashed body -- so it moved
 * horizontally during a squash it was supposed to be ignoring. At grip 1 the
 * interpolated frame IS the squashed frame, so nothing about her changes.
 */
export function placeFeature(
  base: BodyShape,
  squashedShape: BodyShape,
  normalisedX: number,
  normalisedY: number,
  gripX: number,
  gripY: number,
): Point {
  const width = base.halfWidth + (squashedShape.halfWidth - base.halfWidth) * clamp(gripX)
  const height = base.height + (squashedShape.height - base.height) * clamp(gripY)
  const y = normalisedY * height
  const frame: BodyShape = { ...squashedShape, halfWidth: width, height }
  return { x: normalisedX * width + shearAt(frame, y), y }
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}
