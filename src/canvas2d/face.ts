/**
 * Her face: cheeks, eyes, the catchlight, and the mouth.
 *
 * Split out of `mochi.ts` so the composition root stays readable, and split at
 * THIS seam on purpose. The layer ORDER is an architectural rule -- idle, then
 * expression, then the mouth, always last -- and an order
 * can only be read off the place the calls are written. So the ordering stays
 * in `paint()` where it is visible in four consecutive lines, and only the
 * implementations moved here.
 *
 * Free functions taking an explicit context rather than methods on a class:
 * none of these hold state, and passing `ctx` in makes it obvious that they
 * paint wherever they are told rather than into somewhere they own.
 */

import { clamp01 } from '../core/vocabulary.js'
import { parseHexRgb } from '../core/colour.js'
import type { FaceSpec } from '../core/spec.js'
import type { Look } from '../core/looks.js'
import { lensOutline, lensHeight, type LensShape } from '../core/lens.js'
import type { Point } from '../core/geometry.js'
import { outlinePath } from './paths.js'

/** Where a feature sits, in canvas space. Supplied by the caller's body frame. */
export type Place = (normalisedX: number, normalisedY: number) => Point

/** How far from the eye's centre the catchlight sits, as a fraction of the eye. */
const GLINT_TRAVEL = 0.45

/** Most of an eye's half-extent the catchlight may take up, in either axis. */
const GLINT_MAX_FILL = 0.55

/** Above 2 the superellipse squares off — which is what makes it read as a block. */
const GLINT_ROUNDNESS = 3.2

/**
 * The same colour at zero alpha, whatever hex form it arrived in.
 *
 * `parseHexRgb` already understands every form the avatar format accepts, so this
 * reuses it rather than adding a fifth place that knows about hex. Falls back
 * to fully transparent black: a cheek that fades to nothing is a cheek nobody
 * notices, which is a better failure than a throw inside the paint loop.
 */
function transparentOf(hex: string): string {
  const rgb = parseHexRgb(hex)
  return rgb === null ? 'rgba(0, 0, 0, 0)' : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`
}

export function paintCheeks(
  ctx: CanvasRenderingContext2D,
  face: FaceSpec,
  look: Look,
  place: Place,
  scale: number,
): void {
  const alpha = Math.min(1, face.cheekAlpha + look.cheek * 0.5)
  if (alpha <= 0.01) return
  // Saved and restored, like the mouth and the glint beside it. Resetting
  // `globalAlpha` to 1 by hand restores a value the caller never set, and
  // leaves `fillStyle` holding this gradient afterwards. It happens to be
  // harmless today only because the one caller wraps the whole face in its own
  // save/restore -- which makes this function's safety a property of somebody
  // else's code, and the exported signature promises otherwise.
  ctx.save()
  for (const side of [-1, 1]) {
    const at = place(side * face.cheekX, face.cheekY)
    const radius = face.cheekR * scale * (1 + look.cheek * 0.18)
    const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius)
    gradient.addColorStop(0, face.colCheek)
    // PARSED, not string-concatenated. `${hex}00` only yields a valid colour
    // when the hex happens to be six digits, and `parseFaceSpec` accepts four
    // forms: `#rgb` and `#rgba` become five- and seven-digit strings that
    // `addColorStop` rejects by throwing, and `#rrggbbaa` silently becomes a
    // different, opaque colour. A user avatar with `#f88` cheeks would have
    // taken the whole render down.
    gradient.addColorStop(1, transparentOf(face.colCheek))
    ctx.globalAlpha = alpha
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.ellipse(at.x, at.y, radius, radius * 0.72, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * The smallest a lid may get. A shut eye is a HAIRLINE, never nothing.
 *
 * An eye that vanishes entirely reads as a dropped frame rather than as a
 * closed eye, which is the one thing the sleeping pose must not look like.
 */
const MIN_LID = 0.04

/**
 * How far one lid is open, given the expression and the blink.
 *
 * ## The floor is on the PRODUCT, and that is the whole of this function
 *
 * It used to be on the blink alone -- `Math.max(0.04, 1 - blink)` -- which
 * holds only while the expression leaves the eye at full height. `sleepy` does
 * not: it takes the arcs to `0.16` before the blink is applied, so a held
 * blink produced `0.16 x 0.04`, six thousandths of an eye, and she slept with
 * no eyes at all rather than with shut ones.
 *
 * That was reachable the day `sleepy` became the rest pose and not before,
 * which is exactly why the guarantee belongs on the number that is drawn
 * rather than on one of its factors. Any expression, any blink: the lid is
 * never thinner than `MIN_LID`.
 */
export function lidScale(look: number, blink: number): number {
  // Normalised before the arithmetic, not after. `Math.max(MIN_LID, ...)` and
  // `Math.abs` both pass NaN straight through, so a non-finite look or blink
  // escaped the floor entirely: `lidScale(NaN, 0)` was NaN and
  // `lidScale(1, -Infinity)` was Infinity — neither of which is a lid.
  if (!Number.isFinite(look)) return MIN_LID
  const shut = Number.isFinite(blink) ? clamp01(blink) : 1
  const open = look * (1 - shut)
  /*
    The floor is on the MAGNITUDE, and the sign survives it.

    `Math.max(MIN_LID, open)` silently discards a NEGATIVE look, and
    `looks.ts` leans on exactly that sign: `happy` sets `eyeLower` to -0.62 and
    `shy` to -0.28 to bow the lower edge above the baseline and make the
    crescent `^ ^` eye. Clamped to +0.04, both were drawn with a flat lower lid,
    so the one expression a child reads fastest never reached the canvas.

    Both halves were right and tested -- `lens.test.ts` proves a negative lower
    makes a crescent, `looks.test.ts` proves the table carries one. Only the
    connector between them was wrong, and the test that would have caught it
    checked `eyeUpper`, which is positive for every emotion.

    A fully shut eye is a POSITIVE hairline whatever the look was: at `blink` 1
    the excursion is zero, and the eye is closed rather than bowed.
  */
  /*
    Sign-preserving at full blink too, and that is the whole of this line.

    Returning a POSITIVE hairline for a negative look made the function jump at
    exactly `blink === 1`: approached from below the value tends to -MIN_LID,
    and at the endpoint it flipped to +MIN_LID. On a narrow crescent that is a
    step of twice the floor, landing on whichever frame happens to sample the
    peak of a blink.

    What a CLOSED eye looks like is not this function's decision. It reports how
    far one lid is open; `lidPair` owns the shape the two of them make, and it
    is the thing that can see both.
  */
  if (open === 0) return look < 0 ? -MIN_LID : MIN_LID
  return Math.sign(open) * Math.max(MIN_LID, Math.abs(open))
}

/**
 * The two lid extents, with the minimum enforced on what is actually DRAWN.
 *
 * `lidScale` floors each lid on its own, and that is not enough. The eye's
 * rendered height is the SUM of the two — `lower` is signed, and a crescent's
 * negative lower bows the bottom edge up toward the top one — so both lids can
 * sit exactly on the floor with opposite signs and cancel to nothing. A happy
 * face late in a blink did precisely that: two lids at the minimum, an eye of
 * zero height, which is the one outcome `MIN_LID` exists to prevent.
 *
 * Two things about the floor are easy to get wrong, and the first attempt got
 * both:
 *
 * It is a fraction of the eye's own RESTING SPAN — `eyeUpper + eyeLower` — and
 * not of the sum of the two magnitudes. Those are the same number for an eye
 * whose lids both bulge outward, and wildly different for a crescent, where the
 * lids nearly cancel by design. Measured against magnitudes, a face drawn with
 * `eyeUpper: 4, eyeLower: -3.8` had a floor larger than its entire open eye, so
 * it was flattened at rest, at blink zero, in the neutral pose.
 *
 * And when the span is short, only the BOTTOM edge moves: the top arc is left
 * exactly where the expression put it. Collapsing to an evenly split hairline
 * instead made the eye jump — a crescent one frame, a flat sliver the next, its
 * midpoint snapping across the eye. Lifting the lower edge to meet the floor is
 * continuous through the moment it crosses the baseline, so the eye passes from
 * crescent to flat to ordinary lens without a visible step.
 *
 * A face with both extents at zero is left alone. That is a designer asking for
 * no eye at all, the same way `eyeGlint: 0` asks for no catchlight.
 */
export function lidPair(
  face: FaceSpec,
  look: Look,
  blink: number,
  scale: number,
): { upper: number; lower: number } {
  const upper = face.eyeUpper * scale * lidScale(look.eyeUpper, blink)
  const lower = face.eyeLower * scale * lidScale(look.eyeLower, blink)
  // Measured against the LARGER extent, not against the span and not against
  // the sum of magnitudes. The span goes to zero for a face drawn with
  // `eyeUpper === -eyeLower`, which left a floor of zero and rendered an eye of
  // literally no pixels; the sum of magnitudes is enormous for any crescent and
  // flattened faces that were never in trouble. The larger extent is a measure
  // of how big the eye IS, which is what a minimum should be a fraction of.
  const floor = Math.max(Math.abs(face.eyeUpper), Math.abs(face.eyeLower)) * scale * MIN_LID
  if (upper + lower >= floor) return { upper, lower }
  return { upper, lower: floor - upper }
}

export function paintEyes(
  ctx: CanvasRenderingContext2D,
  face: FaceSpec,
  look: Look,
  blink: number,
  gaze: Point,
  place: Place,
  scale: number,
): void {
  const halfWidth = face.eyeHw * scale * look.eyeWidth
  const lids = lidPair(face, look, blink, scale)
  const lens: LensShape = {
    halfWidth,
    upper: lids.upper,
    lower: lids.lower,
    tilt: 0,
    roundness: face.eyeRound,
  }
  for (const side of [-1, 1]) {
    const at = place(side * face.eyeX, face.eyeY)
    const dx = gaze.x * halfWidth * face.gazeTravel
    const dy = gaze.y * Math.max(lensHeight(lens), 2) * face.gazeTravel
    const shape: LensShape = { ...lens, tilt: (face.eyeTilt + look.eyeTilt) * side }
    const eye = outlinePath(lensOutline(shape), at.x + dx, at.y + dy)
    ctx.fillStyle = face.colInk
    ctx.fill(eye)
    paintGlint(ctx, face, look, shape, eye, at.x + dx, at.y + dy, scale)
  }
}

/**
 * The catchlight: the white block that makes her eyes look lit up.
 *
 * CLIPPED to the eye it belongs to rather than sized to stay inside it. The
 * eye is a lens whose height collapses to a hairline during a blink and whose
 * width follows the expression, so a highlight sized from the open eye sits
 * outside the shut one -- a white speck floating on her cheek for 130ms,
 * which is long enough to see and short enough to never catch in a still.
 * Clipping makes that unrepresentable instead of a sum of two numbers that
 * have to agree.
 *
 * Placed TOWARD THE LIGHT, not at a tuned corner. `shadowX`/`shadowY` already
 * displace the lit copy of her body, so that vector is where the light is;
 * reading it here means a designer who moves the light gets a highlight that
 * moves with it, rather than one that contradicts their own shading.
 */
function paintGlint(
  ctx: CanvasRenderingContext2D,
  face: FaceSpec,
  look: Look,
  eye: LensShape,
  clip: Path2D,
  x: number,
  y: number,
  scale: number,
): void {
  const alpha = clamp01(look.sparkle)
  if (alpha <= 0.01 || face.eyeGlint <= 0) return

  // The eye occupies [-lower, +upper] about its baseline, and its baseline is
  // NOT its middle -- for a crescent, where `lower` is negative, the whole
  // shape sits above the origin the lens is drawn around. `happy` spans 4.0 to
  // 7.1 with an origin at 0, so a highlight offset from the origin landed
  // almost entirely outside the ink on exactly the face that most needs to
  // look lit. Measured from the eye's own centre, it cannot.
  const centre = (eye.upper - eye.lower) / 2
  const halfSpan = (eye.upper + eye.lower) / 2
  if (halfSpan <= 0) return

  // Sized to FIT the eye, then clipped as the backstop -- both, because they
  // do different jobs. The cap is what keeps a crescent's highlight a gleam
  // rather than a white sliver filling the little of the eye that is visible;
  // the clip is what holds the guarantee when the lid comes down and the eye
  // becomes a hairline the cap was not computed against.
  const radius = Math.min(
    face.eyeGlint * scale,
    halfSpan * GLINT_MAX_FILL,
    eye.halfWidth * GLINT_MAX_FILL,
  )
  if (radius <= 0) return

  // Normalised so the offset is a DIRECTION. The shadow displacement is a few
  // percent of her body, and used raw it would place the highlight a fraction
  // of a pixel from centre.
  const length = Math.hypot(face.shadowX, face.shadowY)
  const ux = length === 0 ? 0 : face.shadowX / length
  const uy = length === 0 ? 1 : face.shadowY / length
  // `- radius` so the block's own body stays inside even before the clip. A
  // guarantee that only holds because something downstream trims it is one
  // nobody can read off this function.
  const localX = ux * Math.max(0, eye.halfWidth - radius) * GLINT_TRAVEL
  const localY = centre + uy * Math.max(0, halfSpan - radius) * GLINT_TRAVEL

  // The eye is rotated about its baseline by `tilt`, so the offset has to
  // turn with it or the highlight slides out of a tilted eye.
  const sin = Math.sin(eye.tilt)
  const cos = Math.cos(eye.tilt)

  ctx.save()
  ctx.clip(clip)
  ctx.globalAlpha = alpha
  ctx.fillStyle = face.colGlint
  ctx.fill(
    outlinePath(
      lensOutline({
        halfWidth: radius,
        upper: radius,
        lower: radius,
        tilt: eye.tilt,
        roundness: GLINT_ROUNDNESS,
      }),
      x + (localX * cos - localY * sin),
      // Canvas y grows downward, so local +y-up is subtracted.
      y - (localX * sin + localY * cos),
    ),
  )
  ctx.restore()
}

export function paintMouth(
  ctx: CanvasRenderingContext2D,
  face: FaceSpec,
  look: Look,
  mouthOpen: number,
  place: Place,
  scale: number,
): void {
  const at = place(0, face.mouthY)
  const open = mouthOpen
  // The LOUDER of the two, never the expression alone. `sleepy` sets
  // `mouthAlpha` to 0 so a resting mochi has no mouth at all -- but AGENTS.md
  // rule 8 forbids any layer above the mouth from overwriting it, and the
  // reason is concrete: a look holding her jaw shut while audio played would
  // read as broken rather than as asleep. Asleep she is not speaking by
  // definition, and "by definition" is exactly the assumption that stops being
  // true one refactor later, so anything driving the mouth outranks the look.
  const alpha = Math.max(clamp01(look.mouthAlpha), open > 0 ? 1 : 0)
  if (alpha <= 0.01) return

  const shape: LensShape = {
    // A mouth widens slightly as it opens; holding the width fixed reads as a
    // letterbox rather than a jaw.
    halfWidth: face.mouthHw * scale * look.mouthWidth * (1 + open * 0.22),
    upper: face.mouthUpper * scale * look.mouthUpper,
    lower: face.mouthLower * scale * look.mouthLower + open * face.mouthOpenGain * scale,
    tilt: 0,
    roundness: face.mouthRound,
  }
  // Saved and restored rather than reset by hand: this runs inside the
  // caller's clip, and leaking a globalAlpha out of here would tint whatever
  // the next frame draws first.
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = face.colInk
  ctx.fill(outlinePath(lensOutline(shape), at.x, at.y))
  ctx.restore()
}
