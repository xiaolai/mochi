import type { FaceSpec } from './spec.js'

/**
 * A starting point for a character of your own, and deliberately NOT a good one.
 *
 * This was the default face, from a design where Mochi was reserved and did not
 * ship; a generic body was the only thing an engine could honestly hand out.
 * She ships now and she is the default, so `PLAIN` has the job it was always
 * better suited to: the thing you start from and change.
 *
 * It is built to be visibly a different creature from her, along exactly the
 * axes that identify her:
 *
 * | | Mochi | PLAIN |
 * |---|---|---|
 * | waist | 0.295, low and distinctive | 0.44, a near-symmetric egg |
 * | shoulders | 1.86 / 2.58, asymmetric | 2.2 / 2.2, a plain ellipse |
 * | shading | two tones, lit copy displaced | one flat tone, no displacement |
 * | cheeks | a coral blush at 0.34 | none |
 * | face | low on the body, small eyes | centred, larger eyes |
 *
 * Every one of those is a choice you are expected to replace. Start here, move
 * the numbers, and the result is yours — that is what the format is for, and
 * nothing about it owes anything to her.
 */
export const PLAIN: FaceSpec = {
  size: 100,
  bodyW: 100,
  bodyH: 92,
  waist: 0.44,
  upperShoulder: 2.2,
  lowerShoulder: 2.2,
  gripX: 0.7,
  gripY: 0.7,

  eyeX: 0.34,
  eyeY: 0.55,
  eyeHw: 5.5,
  eyeUpper: 5.5,
  eyeLower: 5.5,
  eyeTilt: 0,
  eyeRound: 2,
  eyeGlint: 1.8,
  gazeTravel: 0.4,

  mouthY: 0.36,
  mouthHw: 7,
  mouthUpper: 0,
  mouthLower: 2.6,
  mouthRound: 2,
  mouthOpenGain: 8,

  cheekAlpha: 0,
  cheekX: 0.6,
  cheekY: 0.4,
  cheekR: 10,

  breathAmp: 0.03,
  breathMs: 3000,
  stiffness: 180,
  damping: 22,

  // Zero: the lit copy sits exactly on the shadow, so the body is one flat
  // tone. The displaced two-tone shading is part of the reserved character.
  shadowX: 0,
  shadowY: 0,

  colBody: '#b9c2cc',
  colShadow: '#a9b3bf',
  colInk: '#333b44',
  colCheek: '#dd9999',
  colGlint: '#ffffff',
}
