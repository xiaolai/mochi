/**
 * Centring the creature, rather than the canvas she is drawn on.
 *
 * ## The measurement that made this necessary
 *
 * A 40px theme swatch, sampled: the canvas sits dead centre of its 52px button
 * — 6.0px above, 6.0px below — and the mochi inside it has **16.5px of air
 * above her and 2.0px below**. She is centred by every rule the layout applies
 * and visibly low in every tile.
 *
 * It is not a bug in the rig. `fitToCanvas` scales her so the WORST CASE pose
 * fits — `worstCaseUnits` covers a surprised squash and a full lean — and then
 * stands her one breathing unit off the bottom. A neutral face uses about 86 of
 * the 144 units that budget reserves, and all of the slack ends up over her
 * head. On her own window that is correct: she stands on a floor, and the room
 * above is what she breathes and leans into. In a 40px tile there is no floor
 * and no animation, so the reserved space reads as a mistake.
 *
 * ## Why measure rather than compute
 *
 * The slack depends on the pose. `sleepy` sits lower than `surprised`, a leaning
 * `shy` is off to one side, and a custom `FaceSpec` can change every proportion
 * — so a constant offset would be right for one tile in eight. The alpha
 * channel is the only thing that knows where she actually landed.
 *
 * ## Why not move the canvas instead
 *
 * A CSS shift on the element moves her out of the box that holds her: the
 * correction here is 7.25px and the swatch has 6px of slack, so she would hang
 * over the button's edge. The rig also resets the context transform on every
 * frame (`paint` calls `applyTransform` first), so a translate applied by the
 * caller is wiped before anything is drawn. Drawing offscreen and blitting the
 * result into place is the one arrangement that leaves the rig untouched.
 */

export interface Bounds {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

/**
 * The box the painted pixels actually occupy, or null if nothing was painted.
 *
 * Alpha, not colour: she is drawn on a transparent canvas and her ink is nearly
 * black, so a lightness threshold would clip her eyes out of her own outline.
 *
 * The threshold is deliberately low. Antialiasing puts a fringe of very low
 * alpha around every edge, and treating that as empty crops a pixel off each
 * side — which is invisible at 108px and a twentieth of her at 40px.
 */
export function paintedBounds(
  alpha: (x: number, y: number) => number,
  width: number,
  height: number,
): Bounds | null {
  let top = -1
  let bottom = -1
  let left = width
  let right = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha(x, y) < 8) continue
      if (top === -1) top = y
      bottom = y
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  return top === -1 ? null : { top, bottom, left, right }
}

/**
 * How far to move that box to centre it, rounded to whole pixels.
 *
 * WHOLE pixels because the result is a `drawImage` offset: a fractional one
 * resamples every edge she has, which at these sizes is the difference between
 * a drawn line and a grey smear.
 *
 * Null bounds — nothing painted — is an offset of nothing rather than a throw.
 * A face that draws nothing is already reported by the caller as a dashed hole.
 */
export function centreOffset(
  bounds: Bounds | null,
  width: number,
  height: number,
): { readonly dx: number; readonly dy: number } {
  if (bounds === null) return { dx: 0, dy: 0 }
  const spare = {
    x: width - (bounds.right - bounds.left + 1),
    y: height - (bounds.bottom - bounds.top + 1),
  }
  return {
    dx: Math.round(spare.x / 2 - bounds.left),
    dy: Math.round(spare.y / 2 - bounds.top),
  }
}
