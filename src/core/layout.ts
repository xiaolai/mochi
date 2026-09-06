/**
 * How big she is, and how much room her deformation needs.
 *
 * ## The direction of the dependency
 *
 * The body is the fixed thing and the CANVAS follows from it. That is the
 * inverse of how this started: the window was 280x280 and the rig fitted her
 * into a fraction of it, which meant the real size was an emergent property of
 * two constants in different files, and "make her smaller" was a change to a
 * fraction rather than to a size. Now `bodyW x bodyH` design units times a
 * scale IS the size, and everything else is computed from it.
 *
 * Host-agnostic: nothing here knows about a window, a screen, or a desktop.
 * What sizes an OS window from these numbers lives in the host application.
 */

import { FACE_BOUNDS, type FaceSpec } from './spec.js'
/**
 * The furthest the squash channel may travel, in either direction.
 *
 * Lives here rather than in the rig because it is a SIZE fact before it is an
 * animation fact: the window has to be big enough for the most deformed frame
 * that can ever be drawn, so whoever sizes the window needs this number. The
 * rig imports it back for the clamp that makes it true.
 *
 * What it cost to leave unbounded: sleepy posture at the top of a breath
 * widened her past the window edge, and the part that did not fit was painted
 * as two flat vertical sides.
 */
export const SQUASH_LIMIT = 0.26

/** The most any look may lean. `looks.ts` is checked against this by a test. */
export const LEAN_LIMIT = 0.1

/** How much of the half-width a full lean displaces the apex by. */
export const SHEAR_GAIN = 0.55

/**
 * Clearance around her worst case, in DESIGN UNITS.
 *
 * In her own units rather than pixels, so it scales with her: at 200% the gap
 * around her looks the same as at 50%, which a pixel margin would not.
 */
export const BREATHING_UNITS = 8

/**
 * Pixels per design unit at 100%.
 *
 * 0.94 puts her resting body at 94 x 73 CSS pixels, which is the chosen
 * default size. Expressed as a scale rather than as the width itself because
 * `bodyW` belongs to the FACE — every avatar declares its own proportions, and
 * a default stated as "94 wide" would silently mean something different for a
 * face that is not 100 units across.
 *
 * 100% is the default rather than an extreme, so the 50–200% range gives room
 * in both directions. She was previously drawn at twice this, which is what
 * 200% now restores.
 */
export const BASE_UNIT_SCALE = 0.94

/**
 * How far into a canvas the character stands, by default.
 *
 * A DEFAULT the host is expected to replace. The number came from one
 * application's window and means nothing here; it survives only as the fallback
 * for a caller that never says where the ground is. Anything with its own
 * layout should call `setFeet` and ignore it.
 *
 * Why the stance is settable at all rather than fixed: a host may not be free
 * to place its window where it likes. macOS pins a window's top edge to the
 * work area, so a fixed standing height meant the character could never be
 * carried close to the top of the display — dragged upward, she stopped dead in
 * mid-air. Letting the host move the stance instead is what fixed that, and it
 * is the general case, not a macOS special case.
 */
export const FEET_FROM_TOP = 340

/**
 * Where she stands inside a canvas of a given height.
 *
 * ONE rule, called by the rig that draws her and by the code that anchors the
 * bubble to her. They used to compute it separately — one as a fraction of the
 * canvas and one as an offset from its bottom — which agree only when the
 * canvas happens to be exactly her layout's height.
 */
export function feetY(cssHeight: number, clearance: number, feetFromTop = FEET_FROM_TOP): number {
  // Clamped, so a canvas smaller than the standing height still rests her on
  // something rather than dropping her through the floor. The tuner sizes its
  // own cells and is the caller that hits this.
  //
  // `clearance` is in PIXELS and therefore scaled — `BREATHING_UNITS` is in her
  // design units, and passing it raw put her 4px low at 50% and 4px high at
  // 150%, which is the whole distance between resting on the ground and
  // hovering over it.
  return Math.min(feetFromTop, cssHeight - clearance)
}

/**
 * What the size setting accepts, as a percentage of `BASE_UNIT_SCALE`.
 *
 * DERIVED from `FACE_BOUNDS.size`, which is where a user-supplied value is
 * refused. That table's own comment states the rule — "One table, read by BOTH
 * the validator and the tuner's sliders. Two copies would let the editor offer
 * a value the loader rejects" — and there had come to be four copies of these
 * three numbers: here, in `persona-change.ts` as `SIZE_BAND`, and in the
 * shelf's size control as `BAND`.
 *
 * The `fallback` is genuinely this module's own: `FACE_BOUNDS` says what is
 * PERMITTED, and what to do with a value that is not a number at all is a
 * question only `clampSizePercent` asks.
 */
export const SIZE_PERCENT = { ...FACE_BOUNDS.size, fallback: 100 } as const

export interface AvatarLayout {
  /** Pixels per design unit. */
  readonly scale: number
  /** The window, and therefore the canvas, in CSS pixels. */
  readonly width: number
  readonly height: number
  /** Where her base sits, as a fraction of the height. */
  readonly ground: number
  /** Her resting body, in CSS pixels. What a person means by "how big is she". */
  readonly bodyWidth: number
  readonly bodyHeight: number
}

/**
 * The widest and tallest she can ever be drawn, in design units.
 *
 * Deliberately conservative on the lean: the shear displaces the apex, where
 * the body is narrowest, so adding it to the full width over-estimates. A
 * window a few pixels too large is invisible; one a few pixels too small
 * crops her, and that is the failure this whole calculation exists to prevent.
 */
export function worstCaseUnits(face: FaceSpec): { width: number; height: number } {
  const width = face.bodyW * (1 + SQUASH_LIMIT)
  return {
    width: width + width * LEAN_LIMIT * SHEAR_GAIN,
    height: face.bodyH / (1 - SQUASH_LIMIT),
  }
}

/** Clamp a stored percentage to something renderable. */
export function clampSizePercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SIZE_PERCENT.fallback
  return Math.min(SIZE_PERCENT.max, Math.max(SIZE_PERCENT.min, value))
}

/**
 * Everything both processes need, from a face and a size.
 *
 * Rounded to whole pixels because a BrowserWindow cannot be 293.7 wide — and
 * if main rounds while the renderer does not, her base drifts off the ground
 * line by a fraction of a pixel and the two disagree about where she is.
 */
export function layoutFor(face: FaceSpec, sizePercent: number): AvatarLayout {
  const scale = BASE_UNIT_SCALE * (clampSizePercent(sizePercent) / 100)
  const worst = worstCaseUnits(face)
  const width = Math.round((worst.width + BREATHING_UNITS * 2) * scale)
  const height = Math.round((worst.height + BREATHING_UNITS * 2) * scale)
  return {
    scale,
    width,
    height,
    // Her base sits one clearance up from the bottom edge.
    ground: (height - BREATHING_UNITS * scale) / height,
    bodyWidth: face.bodyW * scale,
    bodyHeight: face.bodyH * scale,
  }
}

/**
 * The largest scale whose WORST CASE still fits a canvas somebody else sized.
 *
 * For the tuner, which lays out its own grid of cells and cannot be told what
 * size to be. The app never uses this — it sizes the window from `layoutFor`,
 * which is the whole point of the inversion.
 */
export function fitToCanvas(face: FaceSpec, cssWidth: number, cssHeight: number): number {
  // A canvas has to be a positive finite size to be fitted into. It used to
  // take whatever it was given, and every bad answer flowed downstream in a
  // shape nothing tested for: zero produced scale 0, which makes the renderer's
  // ground calculation `0 / 0`, so she was positioned at NaN and vanished with
  // no error; a negative width produced a negative scale, which mirrors her.
  //
  // A zero-sized canvas is not exotic -- an element that is display:none, or
  // measured a frame before layout, reports exactly that.
  if (!isPositive(cssWidth) || !isPositive(cssHeight)) return 0
  const worst = worstCaseUnits(face)
  return Math.min(
    cssWidth / (worst.width + BREATHING_UNITS * 2),
    cssHeight / (worst.height + BREATHING_UNITS * 2),
  )
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}
