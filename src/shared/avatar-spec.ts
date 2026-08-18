/**
 * A face, as data.
 *
 * This is the plugin format. A user-designed avatar is a JSON file of these
 * numbers -- no code, no assets, nothing executable -- and the tuner in
 * `scripts/face-tuner` is its editor: what its "copy" button emits is exactly this
 * shape. Design a mochi you like, save the file, drop it in the avatars folder.
 *
 * ## Why data and not a code plugin
 *
 * The obvious "plugin" is a JS module implementing `AvatarBackend`, and that
 * seam does exist (see the note at the bottom). It is not what a downloaded
 * avatar gets to be. The renderer holds the IPC bridge that moves her window
 * and disables click-through, and will later hold her audio stream; handing
 * arbitrary downloaded code into that process trades a very large amount of
 * authority for a different-shaped blob. Data cannot escalate.
 *
 * ## Why every field is bounded, not merely typed
 *
 * These numbers arrive from a file somebody else wrote. Type-checking alone
 * accepts `waist: 50` or `bodyW: -1`, which do not throw -- they render a shape
 * that is wrong in a way no error mentions, or divide by something near zero
 * and produce a mochi the size of the screen. Every field therefore declares a
 * range, and the range is checked at the boundary rather than defended against
 * in the geometry.
 */

export interface FaceSpec {
  /**
   * How big she is on screen, as a percentage of the base scale.
   *
   * Part of the FACE, because "how she looks" includes how much room she takes
   * — and because leaving it out made it a code change: `showFace` hardcoded
   * `size: 100`, so somebody who wanted a smaller mochi had to edit
   * TypeScript, rebuild, and hope. That is the exact thing this format exists
   * to stop.
   *
   * 100 puts her `bodyW` of 100 units at `BASE_UNIT_SCALE` — about 94 CSS
   * pixels, which is also the size v1's design handoff specified for her
   * window.
   */
  readonly size: number
  /** FULL width, in design units. */
  readonly bodyW: number
  /** FULL height. She rests on the surface, so this is not a half-extent. */
  readonly bodyH: number
  /** Height of the widest point, 0..0.95. Measured 0.295 on the icon. */
  readonly waist: number
  /** Superellipse exponent above the waist. Below 2 is pointier than an ellipse. */
  readonly upperShoulder: number
  /** Superellipse exponent below the waist. Above 2 is fuller than an ellipse. */
  readonly lowerShoulder: number
  /** How much the face follows the body's deformation. Under 1 resists it. */
  readonly gripX: number
  readonly gripY: number

  readonly eyeX: number
  readonly eyeY: number
  readonly eyeHw: number
  readonly eyeUpper: number
  readonly eyeLower: number
  readonly eyeTilt: number
  /** Superellipse exponent for the eyes. 2 is a round dot; below sharpens. */
  readonly eyeRound: number
  /**
   * Half-extent of the catchlight -- the white block that makes an eye look lit.
   *
   * 0 draws none, which is the honest way to opt out: a face with no highlight
   * is a design choice, and expressing it as a size means it needs no flag.
   */
  readonly eyeGlint: number
  readonly gazeTravel: number

  readonly mouthY: number
  readonly mouthHw: number
  readonly mouthUpper: number
  readonly mouthLower: number
  readonly mouthRound: number
  /** How far a mouthOpen of 1 pushes the lower arc down. */
  readonly mouthOpenGain: number

  readonly cheekAlpha: number
  readonly cheekX: number
  readonly cheekY: number
  readonly cheekR: number

  readonly breathAmp: number
  readonly breathMs: number
  readonly stiffness: number
  readonly damping: number

  /** Displacement of the LIT copy of the silhouette, as a fraction of her size. */
  readonly shadowX: number
  readonly shadowY: number

  readonly colBody: string
  readonly colShadow: string
  readonly colInk: string
  readonly colCheek: string
  /** The catchlight. Not hardcoded white: an ink that is not near-black wants its own. */
  readonly colGlint: string
}

type NumericKey = {
  [K in keyof FaceSpec]: FaceSpec[K] extends number ? K : never
}[keyof FaceSpec]

export type ColourKey = {
  [K in keyof FaceSpec]: FaceSpec[K] extends string ? K : never
}[keyof FaceSpec]

export interface Bound {
  readonly min: number
  readonly max: number
  /** Granularity a slider should offer. Not enforced -- a spec may be finer. */
  readonly step: number
}

/**
 * The permitted range of every numeric field.
 *
 * One table, read by BOTH the validator and the tuner's sliders. Two copies
 * would let the editor offer a value the loader rejects, which presents to a
 * user as "I designed this and the app ignored it".
 *
 * Wider than the tuner's comfortable range in places: these are the bounds of
 * what is safe to render, not of what looks good. Taste is the designer's.
 */
export const FACE_BOUNDS: Readonly<Record<NumericKey, Bound>> = {
  // The same band `clampSizePercent` enforces in `avatar-layout`, stated here
  // because this is where a user-supplied value is refused.
  size: { min: 50, max: 200, step: 5 },
  bodyW: { min: 20, max: 400, step: 1 },
  bodyH: { min: 20, max: 400, step: 1 },
  // Not 1: at the very top the shape degenerates to a spike with no underside.
  waist: { min: 0, max: 0.95, step: 0.005 },
  // Not below 1: the superellipse becomes concave and self-intersects.
  upperShoulder: { min: 1, max: 8, step: 0.02 },
  lowerShoulder: { min: 1, max: 8, step: 0.02 },
  gripX: { min: 0, max: 1, step: 0.01 },
  gripY: { min: 0, max: 1, step: 0.01 },

  eyeX: { min: 0, max: 1, step: 0.005 },
  eyeY: { min: 0, max: 1, step: 0.005 },
  eyeHw: { min: 0, max: 60, step: 0.5 },
  eyeUpper: { min: -60, max: 60, step: 0.5 },
  eyeLower: { min: -60, max: 60, step: 0.5 },
  eyeTilt: { min: -1.5, max: 1.5, step: 0.01 },
  eyeRound: { min: 0.5, max: 8, step: 0.05 },
  // Unbounded above by the eye on purpose: the highlight is CLIPPED to the eye
  // it sits in, so an oversized one turns the whole eye white rather than
  // escaping it. That is a legitimate look, and no range check has to know the
  // eye's size to permit it.
  eyeGlint: { min: 0, max: 30, step: 0.1 },
  gazeTravel: { min: 0, max: 2, step: 0.01 },

  mouthY: { min: 0, max: 1, step: 0.005 },
  mouthHw: { min: 0, max: 80, step: 0.5 },
  mouthUpper: { min: -60, max: 60, step: 0.25 },
  mouthLower: { min: -60, max: 60, step: 0.25 },
  mouthRound: { min: 0.5, max: 8, step: 0.05 },
  mouthOpenGain: { min: 0, max: 100, step: 0.5 },

  cheekAlpha: { min: 0, max: 1, step: 0.01 },
  cheekX: { min: 0, max: 1.5, step: 0.01 },
  cheekY: { min: 0, max: 1, step: 0.01 },
  cheekR: { min: 0, max: 80, step: 0.5 },

  breathAmp: { min: 0, max: 0.5, step: 0.005 },
  // Not 0: the breath divides by the period.
  breathMs: { min: 200, max: 20_000, step: 50 },
  // Not 0: a spring with no stiffness never returns.
  stiffness: { min: 1, max: 2000, step: 5 },
  damping: { min: 0.1, max: 200, step: 1 },

  shadowX: { min: -1, max: 1, step: 0.002 },
  shadowY: { min: -1, max: 1, step: 0.002 },
}

/**
 * Every colour field, as an exhaustive table rather than a list.
 *
 * `Record<ColourKey, true>` is the whole point: a list typed `ColourKey[]` is
 * satisfied by ANY subset, so adding a sixth colour to `FaceSpec` compiled
 * cleanly while the parser stayed unaware of it -- and the parser then reported
 * the new field as "not a field of an avatar" and cast a face missing it to
 * `FaceSpec` anyway. The built-in itself would have failed to load, and the
 * tests would not have caught it because they derive their expectations from
 * this same array.
 *
 * `FACE_BOUNDS` above is exhaustive over the numeric keys for exactly this
 * reason. The colours were the half of the format that had no such guard.
 */
const COLOUR_FIELDS: Readonly<Record<ColourKey, true>> = {
  colBody: true,
  colShadow: true,
  colInk: true,
  colCheek: true,
  colGlint: true,
}

export const COLOUR_KEYS = Object.keys(COLOUR_FIELDS) as readonly ColourKey[]

/** `#rgb` and `#rrggbb`, with or without alpha. Nothing else — see parseFaceSpec. */
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** Long enough for any label a person writes, short enough not to be a payload. */
const NAME_MAX = 80

/**
 * A value, rendered for an error message, without throwing.
 *
 * `JSON.stringify` throws on a BigInt -- so the error path itself could throw,
 * and `parseFaceSpec` would break the one promise its signature makes: that it
 * returns a verdict. Disk JSON cannot carry a BigInt, but the parameter is
 * `unknown` and the export is public, so the contract has to hold for whatever
 * arrives, not for what is expected to.
 */
function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'object' && value !== null)
    return Array.isArray(value) ? 'an array' : 'an object'
  return String(value)
}

export type ParseResult =
  | { readonly ok: true; readonly face: FaceSpec }
  | { readonly ok: false; readonly problems: readonly string[] }

/**
 * Turn something read off disk into a face, or say exactly what is wrong.
 *
 * Reports EVERY problem rather than the first. Someone hand-editing an avatar
 * file wants the whole list; failing on the first field turns one round of
 * fixing into five, and they have no way to see the rest until each is cleared.
 *
 * Colours are restricted to hex. CSS accepts a great deal more -- `url(...)`,
 * `image-set(...)`, custom properties -- and a colour string reaches
 * `fillStyle`, which is the one place in this format where a value is
 * interpreted rather than measured.
 */
export function parseFaceSpec(value: unknown): ParseResult {
  try {
    return readFaceSpec(value)
  } catch (error) {
    // The signature promises a VERDICT for any `unknown`, and reading a
    // property is not guaranteed to be safe: a getter or a Proxy can throw, and
    // then the one function whose job is to decide whether something is a face
    // takes the caller down with it. Today's inputs are `JSON.parse` output and
    // structured-cloned IPC payloads, neither of which can carry a getter --
    // which is exactly why nothing would have found this until the day some
    // caller passed a live object.
    return { ok: false, problems: [`the avatar could not be read: ${String(error)}`] }
  }
}

function readFaceSpec(value: unknown): ParseResult {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, problems: ['the avatar file must contain a JSON object'] }
  }
  const source = value as Record<string, unknown>
  const face: Record<string, number | string> = {}

  for (const [key, bound] of Object.entries(FACE_BOUNDS)) {
    const raw = source[key]
    if (raw === undefined) {
      problems.push(`${key} is missing`)
      continue
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      problems.push(`${key} must be a finite number, got ${describe(raw)}`)
      continue
    }
    if (raw < bound.min || raw > bound.max) {
      problems.push(`${key} must be between ${bound.min} and ${bound.max}, got ${raw}`)
      continue
    }
    face[key] = raw
  }

  for (const key of COLOUR_KEYS) {
    const raw = source[key]
    if (raw === undefined) {
      problems.push(`${key} is missing`)
      continue
    }
    if (typeof raw !== 'string' || !HEX.test(raw)) {
      problems.push(`${key} must be a hex colour like #8ec8a8, got ${describe(raw)}`)
      continue
    }
    face[key] = raw
  }

  // `name` is a label for whoever is editing the file. It is deliberately NOT
  // part of `FaceSpec` -- nothing renders it, and `resolveAvatar` identifies an
  // avatar by filename -- but it is still validated, because "accepted and
  // discarded" and "accepted, wrong, and discarded" look identical from the
  // outside. A `name` of `12345` used to pass silently; now it is a problem
  // reported alongside every other, which is the promise this parser makes.
  if ('name' in source) {
    const name = source['name']
    if (typeof name !== 'string' || name.trim() === '') {
      problems.push(`name must be a non-empty label, got ${describe(name)}`)
    } else if (name.length > NAME_MAX) {
      problems.push(`name must be at most ${NAME_MAX} characters`)
    }
  }

  // Unknown keys are reported, not rejected. A typo like `eyeWith` is silently
  // ignored otherwise, and the designer sees their change do nothing.
  const known = new Set([...Object.keys(FACE_BOUNDS), ...COLOUR_KEYS])
  for (const key of Object.keys(source)) {
    if (!known.has(key) && key !== 'name') problems.push(`${key} is not a field of an avatar`)
  }

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, face: face as unknown as FaceSpec }
}

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

  breathAmp: 0.045,
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
