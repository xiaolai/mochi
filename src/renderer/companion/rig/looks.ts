/**
 * How each emotion deforms the neutral face.
 *
 * Every Emotion gets an entry, enforced by `Record<Emotion, Look>`. Letting one
 * fall through to neutral would make `caps.presetExpressions` a lie: the
 * backend would claim to support an expression it renders identically to no
 * expression at all, and the caller has no way to discover that.
 *
 * Values are multipliers on the tuned base geometry rather than absolute sizes,
 * so retuning the face in the tuner does not invalidate the table.
 */

import { clamp01, type Emotion } from '@shared/avatar'

export interface Look {
  /** Multiplies the eye's upper arc. */
  readonly eyeUpper: number
  /** Multiplies the eye's lower arc. NEGATIVE turns the eye into a crescent -- see lens.ts. */
  readonly eyeLower: number
  readonly eyeWidth: number
  /** Radians, mirrored per side. Positive brings the inner corners down. */
  readonly eyeTilt: number
  readonly mouthUpper: number
  readonly mouthLower: number
  readonly mouthWidth: number
  /**
   * 0..1 opacity of the mouth. 0 removes it entirely.
   *
   * Only `sleepy` uses it, and only for the resting pose: a sleeping mochi is a
   * shape with two closed eyes, and a mouth left on it reads as awake-but-quiet
   * rather than asleep.
   *
   * This does NOT weaken the layering rule, which says no layer above the
   * mouth may overwrite it, because a gesture holding her jaw shut while audio
   * is playing reads as broken. `paintMouth` therefore takes the LOUDER of this
   * and whatever is actually driving the mouth -- so anything making a sound
   * wins, and the expression can only hide a mouth that is already still.
   */
  readonly mouthAlpha: number
  /** 0..1 extra cheek colour, on top of the resting amount. */
  readonly cheek: number
  /**
   * 0..1 opacity of the catchlight -- the "her eyes lit up" block.
   *
   * A property of the EMOTION rather than a timer, which is what makes "her
   * eyes lit up" mean something: it appears when she is delighted or startled
   * and is absent the rest of the time, so seeing it carries information. A
   * highlight that were simply always on would be a shading detail, and one
   * that blinked on a schedule would be noise.
   *
   * It blends with intensity like everything else here, so the waking perk --
   * `surprised` at 0.6 for 1.4 seconds, in `face.ts` -- shows a partial glint
   * rather than a full one.
   *
   * **It does not fade.** This entry used to say it did, and it was wrong
   * twice over: nothing set the perk at all, and only `squash` runs through a
   * spring -- every other channel of a `Look` is applied on the frame it is
   * set. A hold ENDS an expression; it does not ease it out. Anyone wanting a
   * fade has to interpolate the look itself, which is a change to this whole
   * pipeline rather than a value in this table.
   */
  readonly sparkle: number
  /** -1..1 gaze bias, added to whatever the cursor is doing. Thinking looks up and away. */
  readonly gazeX: number
  readonly gazeY: number
  /** Postural squash. Surprise stretches her up; sleepy lets her spread. */
  readonly squash: number
  readonly lean: number
}

export const NEUTRAL: Look = {
  eyeUpper: 1,
  eyeLower: 1,
  eyeWidth: 1,
  eyeTilt: 0,
  mouthUpper: 1,
  mouthLower: 1,
  mouthWidth: 1,
  mouthAlpha: 1,
  cheek: 0,
  sparkle: 0,
  gazeX: 0,
  gazeY: 0,
  squash: 0,
  lean: 0,
}

export const LOOKS: Readonly<Record<Emotion, Look>> = {
  neutral: NEUTRAL,
  happy: {
    ...NEUTRAL,
    eyeUpper: 1.1,
    // Negative: the bottom edge lifts past the baseline and the eye becomes ^.
    eyeLower: -0.62,
    eyeWidth: 1.06,
    mouthUpper: 0,
    mouthLower: 2.8,
    mouthWidth: 1.35,
    cheek: 0.6,
    sparkle: 1,
    squash: 0.13,
  },
  shy: {
    ...NEUTRAL,
    eyeUpper: 0.72,
    eyeLower: -0.28,
    eyeWidth: 0.96,
    mouthUpper: 0,
    mouthLower: 0.7,
    mouthWidth: 0.66,
    cheek: 1,
    gazeX: -0.38,
    gazeY: 0.28,
    squash: 0.07,
    lean: -0.06,
  },
  sad: {
    ...NEUTRAL,
    eyeUpper: 0.82,
    eyeLower: 1.14,
    eyeTilt: -0.17,
    mouthUpper: 3,
    mouthLower: -0.3,
    mouthWidth: 0.9,
    gazeY: 0.34,
    squash: -0.11,
  },
  angry: {
    ...NEUTRAL,
    eyeUpper: 0.55,
    eyeLower: 0.92,
    eyeWidth: 1.06,
    eyeTilt: 0.28,
    mouthUpper: 2,
    mouthLower: 0,
    mouthWidth: 0.84,
    cheek: 0.28,
    gazeY: -0.14,
    squash: 0.16,
  },
  surprised: {
    ...NEUTRAL,
    eyeUpper: 1.7,
    eyeLower: 1.7,
    eyeWidth: 1.16,
    mouthUpper: 0,
    mouthLower: 2.6,
    mouthWidth: 0.62,
    cheek: 0.12,
    sparkle: 1,
    gazeY: -0.2,
    // -0.16, down from -0.24. This is the waking perk: `main.ts` wears
    // `surprised` the instant she is told to wake, on top of a poke. At -0.24
    // the pair drove the squash target past -0.34, which stretches her to
    // roughly one and a half times her height -- a launch rather than an "oh!".
    squash: -0.16,
  },
  thinking: {
    ...NEUTRAL,
    eyeUpper: 0.9,
    eyeLower: 0.72,
    eyeTilt: 0.09,
    mouthUpper: 1,
    mouthLower: 0.3,
    mouthWidth: 0.58,
    gazeX: -0.52,
    gazeY: -0.42,
    lean: 0.07,
  },
  sleepy: {
    ...NEUTRAL,
    eyeUpper: 0.16,
    eyeLower: 0.16,
    eyeTilt: -0.11,
    mouthUpper: 0,
    mouthLower: 1.5,
    mouthWidth: 0.52,
    // Gone. She is asleep; a mouth is the difference between resting and quiet.
    mouthAlpha: 0,
    cheek: 0.22,
    gazeY: 0.34,
    // 0.09, down from 0.19. `sleepy` is what she wears for the whole time she
    // is asleep, which is most of her life, so it is the pose she is judged on
    // -- and at 0.19 plus a breath she spread to 1.24 times her width and read
    // as a puddle rather than as something resting.
    squash: 0.09,
  },
}

const KEYS = Object.keys(NEUTRAL) as ReadonlyArray<keyof Look>

/**
 * Neutral blended toward the named emotion by intensity.
 *
 * Intensity 0 is exactly neutral for every emotion, which is what lets a signal
 * decay smoothly rather than snapping when it expires.
 */
export function blendLook(emotion: Emotion, intensity: number): Look {
  const target = LOOKS[emotion]
  const t = clamp01(intensity)
  const out = {} as Record<keyof Look, number>
  // `a*(1-t) + b*t`, not `a + (b-a)*t`. The two are equivalent in real
  // arithmetic and not in floating point: the second form returns
  // 1.1000000000000001 rather than 1.1 at t = 1, so a fully applied emotion is
  // never quite the look that was tuned. The endpoints are the values a human
  // chose in the tuner, and they should survive the trip exactly.
  for (const key of KEYS) out[key] = NEUTRAL[key] * (1 - t) + target[key] * t
  return out
}
