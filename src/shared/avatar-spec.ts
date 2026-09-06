/**
 * The built-in Mochi, and nothing else.
 *
 * The FORMAT moved to `@hando/dough` — `FaceSpec`, its bounds table and its
 * parser are a general description of a soft-bodied face, and the engine is
 * open. What stayed here is the one point in that space which IS the character:
 * these constants are reserved, and `BRAND.md` says so.
 *
 * The format is re-exported so that the app's call sites — and the avatars
 * store, which loads user faces through the same path — did not have to change.
 */

export { FACE_BOUNDS, COLOUR_KEYS, parseFaceSpec, type FaceSpec } from '@hando/dough'

import type { FaceSpec } from '@hando/dough'

/**
 * The built-in mochi, measured against `rig/__fixtures__/mochi-icon.png`.
 *
 * Loaded through the SAME path a user avatar takes -- see `main/store/avatars`.
 * Giving the built-in a private shortcut is how the plugin path rots: it stops
 * being exercised, and the first person to try their own avatar discovers the
 * breakage instead of us.
 *
 * The shading is worth stating because the obvious thing to write is wrong. The
 * icon's interior luminance is BIMODAL -- 86% at 0.725 and 14% at 0.675, with
 * nothing between -- so there is no gradient and no specular highlight, just
 * two flat tones. The darker one is the silhouette displaced up and to the
 * right, leaving a band uncovered along the lower-left edge (fitted IoU 0.928).
 */
export const MOCHI: FaceSpec = {
  size: 100,
  bodyW: 100,
  bodyH: 78,
  waist: 0.295,
  upperShoulder: 1.86,
  lowerShoulder: 2.58,
  gripX: 0.82,
  gripY: 0.82,

  eyeX: 0.3,
  eyeY: 0.46,
  // 4, not the 5 these were tuned at. Two separate reductions land on the eyes
  // -- the body itself is now drawn at 80% (see rig/mochi.ts) and these are 80%
  // of what they were -- so in absolute pixels they end up near 64% of the
  // first version. That compounding is intended, not an accident of two edits:
  // the eyes read as too heavy for her at BOTH sizes.
  eyeHw: 4,
  eyeUpper: 4,
  eyeLower: 4,
  eyeTilt: 0,
  eyeRound: 2,
  eyeGlint: 1.4,
  gazeTravel: 0.42,

  mouthY: 0.24,
  mouthHw: 9,
  mouthUpper: 0,
  mouthLower: 3.2,
  mouthRound: 2,
  mouthOpenGain: 9,

  cheekAlpha: 0.34,
  cheekX: 0.62,
  cheekY: 0.33,
  cheekR: 12,

  // 0.024, down from 0.045, and the two numbers are not comparable: 0.045 was a
  // HALF-amplitude either side of rest, so the body swung 0.09 peak to peak --
  // 9% of her height and 9% of her width, on a 94 x 73px body. This is the
  // whole excursion, in one direction, from a resting shape she now returns to.
  breathAmp: 0.024,
  breathMs: 3400,
  stiffness: 190,
  damping: 20,

  shadowX: 0.059,
  shadowY: 0.102,

  colBody: '#8ec8a8',
  colShadow: '#7dbd99',
  colInk: '#24463a',
  colCheek: '#ef8f86',
  colGlint: '#ffffff',
}

/**
 * ## The OTHER seam
 *
 * This format describes a face the built-in rig can draw: a soft body with two
 * eyes and a mouth. It covers a real design space -- the silhouette exponents
 * alone range from a squat cushion to a teardrop -- but it cannot describe a
 * cat, a sprite sheet, or a rigged 3D model.
 *
 * Those go through `AvatarBackend` in `./avatar`, which is the code seam and is
 * already the only thing the renderer's call sites know about. A second backend
 * is a class, not a change to any caller. VRM is the intended first one, and it
 * is trusted code shipped with the app rather than a file a user dropped in a
 * folder -- which is the distinction that keeps this format data-only.
 */
