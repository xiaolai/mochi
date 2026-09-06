import type { FaceSpec } from '../core/spec.js'

/**
 * Mochi.
 *
 * A soft green ovoid with a low face, measured against `assets/mochi-icon.png`
 * rather than tuned by eye — `silhouette-vs-icon.test.ts` fails the build if the
 * rendered profile drifts from that artwork at any 5% of her height.
 *
 * ## She is not MIT
 *
 * Everything else in this package is. This directory is not: see
 * `LICENSE.md`. You may use her as she is, including in things you give away.
 * You may not rebrand her, sell her, or present her as your own character.
 *
 * If you want a character of your own, that is what the format is for — start
 * from `PLAIN`, move the numbers, and the result owes nothing to this file.
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
