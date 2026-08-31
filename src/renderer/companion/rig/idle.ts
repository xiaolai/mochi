/**
 * The idle layer: breathing, blinking, and the small motion that separates
 * "alive" from "a picture that sometimes moves".
 *
 * Pure functions of time. The backend asks what the idle layer wants at a
 * given instant and gets an answer; nothing here holds a frame loop, a clock,
 * or a random number generator it did not receive. That is what makes a blink
 * schedule testable at all -- the alternative is a test that waits.
 *
 * Ported unchanged from mochi. The asymmetric blink and the Poisson gap are
 * both experiment, not preference, and re-deriving them would mean re-watching
 * a metronome blink for thirty seconds to rediscover why it looks wrong.
 */

import type { MonotonicMs } from '@shared/avatar'

export const BREATH_PERIOD_MS = 3400

/**
 * Blink gap bounds.
 *
 * Drawn from an exponential distribution rather than picked uniformly: real
 * blinks are a Poisson process, and a uniform gap reads as a metronome within
 * about thirty seconds of watching. The bounds clamp the tail -- an exponential
 * will happily produce a four-second gap or a ninety-second one, and both look
 * wrong.
 */
export const BLINK_MIN_GAP_MS = 2200
export const BLINK_MAX_GAP_MS = 6200

/** How long the lid takes to close and open again. */
export const BLINK_DURATION_MS = 130

/**
 * Fraction of the blink spent closing, the rest opening.
 *
 * Not symmetric: a real eyelid shuts faster than it opens, and matching that
 * is most of what makes a blink read as one rather than as a flicker.
 */
const BLINK_CLOSE_FRACTION = 0.35

/**
 * Fraction of a breath spent inhaling, the rest exhaling.
 *
 * Not symmetric, for the reason `BLINK_CLOSE_FRACTION` is not, and the
 * mechanism is the same shape: inspiration is muscular and expiration is
 * elastic recoil, so a resting breath goes in faster than it comes out. Around
 * 1:1.5 at rest, which is this number.
 *
 * The gentle end of the plausible range, deliberately. A blink is over in 130ms
 * and has to be sharp to read at all; a breath runs for 3.4 SECONDS, so the
 * asymmetry has all the time it needs, and pushing it further makes the inhale
 * read as a gasp -- an event, which is exactly what an idle layer must not
 * produce.
 */
const BREATH_IN_FRACTION = 0.4

export interface IdlePose {
  /** 0..1, where 1 is fully shut. */
  readonly blink: number
  /**
   * 0..1, where 0 is resting and 1 is fully inhaled. Never negative.
   *
   * ONE-SIDED, and the sign is the whole of it -- see `breathAt`. The resting
   * silhouette is a floor she returns to rather than a midpoint she oscillates
   * about.
   */
  readonly breath: number
}

/**
 * How far the drift may take her, in fractions of her body.
 *
 * ## Small on purpose, and this is the whole point of it
 *
 * A companion who is alive is not a companion who goes anywhere. These are a
 * few pixels at her drawn size -- `shift` is about 2.6px on a 94px body -- and
 * that is the intended reading: somebody standing still, shifting their weight,
 * rather than somebody pacing.
 *
 * The clips are the loud half of the vocabulary and they were tuned louder
 * still after a first complaint that read as "too small". It was not: the
 * motions were coarse because they were the ONLY thing moving, so she was a
 * still image punctuated by gestures. Continuous micro-motion is what a still
 * image is missing, and once it exists the gestures can be quiet again.
 */
export const DRIFT = { lean: 0.02, shift: 0.026, lift: 0.009 } as const

/**
 * Periods that do not divide each other, in milliseconds.
 *
 * Three sines summed per channel, at spans chosen to be mutually incommensurate
 * -- their least common multiple is hours, so the pattern never visibly
 * repeats. One sine per channel would be a metronome, which is the same defect
 * `BLINK_MIN_GAP_MS` exists to avoid and reads the same way: after about half a
 * minute the eye locks onto the period and she stops looking alive.
 *
 * Deliberately NOT random. A random walk needs state, cannot be asked "where
 * are you at time t", and makes a frame a function of every frame before it --
 * so a throttled window comes back somewhere else entirely. Everything in this
 * file is a pure function of the clock, and that is what makes it testable
 * without waiting.
 */
const DRIFT_MS = {
  lean: [11_300, 6_700, 19_900],
  shift: [13_700, 8_300, 23_100],
  lift: [5_900, 9_700, 17_300],
} as const

/** Where in her small orbit she is, at `now`. */
export interface Drift {
  readonly lean: number
  readonly shift: number
  readonly lift: number
}

function wobble(now: number, periods: readonly number[]): number {
  // Weighted so the longest span carries the movement and the shortest only
  // roughens it. Equal weights read as a tremor rather than as a body.
  const weights = [0.6, 0.28, 0.12]
  let sum = 0
  for (const [index, period] of periods.entries()) {
    sum += (weights[index] ?? 0) * Math.sin((2 * Math.PI * now) / period)
  }
  return sum
}

/**
 * The continuous, going-nowhere motion of somebody who is simply present.
 *
 * `scale` is how much of it applies -- 1 awake, less asleep. Sleep keeps a
 * trace rather than none for the reason the breath is kept: a companion who
 * stops moving altogether reads as a crash, which is the one thing the resting
 * state must not look like.
 */
export function driftAt(now: MonotonicMs, scale = 1): Drift {
  if (!Number.isFinite(now) || !Number.isFinite(scale)) return { lean: 0, shift: 0, lift: 0 }
  const k = Math.max(0, Math.min(1, scale))
  return {
    lean: DRIFT.lean * k * wobble(now, DRIFT_MS.lean),
    shift: DRIFT.shift * k * wobble(now, DRIFT_MS.shift),
    // Never below the ground: a bob that dipped would put her feet through the
    // surface she is standing on. Half above the line, oscillating about it.
    lift: Math.max(0, DRIFT.lift * k * (0.5 + 0.5 * wobble(now, DRIFT_MS.lift))),
  }
}

/**
 * The breath, as a fraction of a full inhale. 0 at rest, 1 fully inhaled.
 *
 * Raised cosines rather than ramps: the turnaround at each end is gradual, and
 * a linear ramp gives the body a visible tick at the top. One cycle per period,
 * starting and ending at rest, peaking at `BREATH_IN_FRACTION` of the way
 * through.
 *
 * TWO half-cosines rather than one whole one, because the halves are different
 * lengths -- see `BREATH_IN_FRACTION`. Each meets the other with zero slope, at
 * the peak and at rest alike, so neither join is visible; at a fraction of 0.5
 * the pair collapses exactly to the single cosine this replaced.
 *
 * ## ONE-SIDED, and that is the point of it
 *
 * This was a plain sine over -1..1, and the negative half was the defect. The
 * breath is summed into `squash` (see `mochi.ts`), which is an area-preserving
 * trade: positive spreads her, negative stretches her taller and NARROWER. So
 * for half of every cycle she wore a fraction of the same deformation `sad`
 * (-0.11) and `surprised` (-0.16) are made of -- measured at 42% of `sad`'s
 * crown-sharpening at the extreme, on the same axis.
 *
 * That reads as her head going pointy on a 3.4-second loop, and it corresponds
 * to nothing a body does: inhaling expands, exhaling returns to rest. Nothing
 * makes you taller and thinner than resting.
 *
 * The crown is where it showed first because it sharpens FASTER than the body
 * lengthens -- width a fixed distance below the apex scales as
 * `f^(1 + 1/upperShoulder)`, about `f^1.54` at the tuned 1.86, against `f^-1`
 * for the height. Halving the amplitude alone would therefore not have fixed
 * it, only slowed it down; removing the negative half does, by construction.
 *
 * The consequence worth stating: the silhouette measured against
 * `rig/__fixtures__/mochi-icon.png` is now a FLOOR she returns to once per
 * cycle, rather than a midpoint she is above half the time.
 */
export function breathAt(now: MonotonicMs, periodMs: number = BREATH_PERIOD_MS): number {
  if (!Number.isFinite(now) || !(periodMs > 0)) return 0
  // Wrapped into 0..1 rather than fed straight to a trig function, because the
  // curve is piecewise now and the branch is chosen by phase. `%` keeps the
  // sign of its left operand in JS, so the second modulo is what stops a
  // negative timestamp landing in the wrong half.
  const phase = (((now % periodMs) + periodMs) % periodMs) / periodMs
  const rising = phase < BREATH_IN_FRACTION
  const t = rising
    ? phase / BREATH_IN_FRACTION
    : (phase - BREATH_IN_FRACTION) / (1 - BREATH_IN_FRACTION)
  return rising ? (1 - Math.cos(Math.PI * t)) / 2 : (1 + Math.cos(Math.PI * t)) / 2
}

/**
 * Lid closure during a blink that began at `startedAt`.
 *
 * Returns 0 outside the blink, so a caller can ask unconditionally. The
 * envelope is continuous at every boundary -- at elapsed 0 the rising ramp is
 * already 0, at `closeMs` both branches give 1, at `durationMs` the falling
 * ramp has reached 0 -- so a blink cannot clip at its edges.
 */
export function blinkAt(
  now: MonotonicMs,
  startedAt: MonotonicMs,
  durationMs: number = BLINK_DURATION_MS,
): number {
  if (!Number.isFinite(now) || !Number.isFinite(startedAt) || !(durationMs > 0)) return 0
  const elapsed = now - startedAt
  if (elapsed < 0 || elapsed > durationMs) return 0

  const closeMs = durationMs * BLINK_CLOSE_FRACTION
  if (elapsed <= closeMs) return elapsed / closeMs
  return 1 - (elapsed - closeMs) / (durationMs - closeMs)
}

/**
 * The gap until the next blink.
 *
 * `random` is injected rather than taken from Math.random so a test can pin the
 * schedule. An exponential mapped through the clamp: most gaps land in the
 * first half of the range, which is what makes the rhythm feel unplanned.
 */
export function nextBlinkGap(random: () => number): number {
  const uniform = random()
  const bounded = Number.isFinite(uniform) ? Math.min(1, Math.max(0, uniform)) : 0.5
  const exponential = -Math.log(1 - bounded * 0.99)
  const span = BLINK_MAX_GAP_MS - BLINK_MIN_GAP_MS
  return BLINK_MIN_GAP_MS + Math.min(span, (exponential / 4.6) * span)
}

/**
 * The idle layer, holding only the blink schedule.
 *
 * Deliberately not a frame loop: it is asked what it wants and answers. The
 * backend owns time, which is the only way the same code can run in a render
 * loop and in a test that advances a number.
 */
export class IdleLayer {
  private nextBlinkAt: MonotonicMs
  private blinkStartedAt: MonotonicMs | null = null

  constructor(
    startedAt: MonotonicMs,
    private readonly random: () => number = Math.random,
  ) {
    // Scheduled from the caller's clock, not from zero: seeding from 0 would
    // put the first blink in the past whenever startup takes longer than the
    // minimum gap, and she would blink the instant she appeared.
    this.nextBlinkAt = startedAt + nextBlinkGap(random)
  }

  /**
   * `periodMs` is a PARAMETER rather than a constant read from this module.
   *
   * `FaceSpec.breathMs` is a validated, bounded, tuner-exposed field, and for a
   * while nothing read it: this method called `breathAt(now)` and took the
   * module default. The two happened to agree at 3400, so every gate stayed
   * green and the only symptom was a slider that did nothing -- which presents
   * to a designer as "I set this and the app ignored it", the same failure the
   * bounds table exists to prevent.
   */
  pose(now: MonotonicMs, periodMs: number = BREATH_PERIOD_MS): IdlePose {
    if (!Number.isFinite(now)) return { blink: 0, breath: 0 }

    if (this.blinkStartedAt === null && now >= this.nextBlinkAt) {
      // From the SCHEDULED time, not from now. With sparse frames -- a
      // backgrounded window renders at 1fps -- starting from `now` slides every
      // blink later by however long the gap between frames was, and the rhythm
      // drifts. Starting from the schedule means a blink whose whole duration
      // fell between two frames is simply not seen, which is correct: you
      // cannot render what you had no frames for.
      this.blinkStartedAt = this.nextBlinkAt
    }

    let blink = 0
    if (this.blinkStartedAt !== null) {
      blink = blinkAt(now, this.blinkStartedAt)
      if (now - this.blinkStartedAt > BLINK_DURATION_MS) {
        this.blinkStartedAt = null
        this.nextBlinkAt = now + nextBlinkGap(this.random)
      }
    }
    return { blink, breath: breathAt(now, periodMs) }
  }

  /**
   * Abandon any blink in progress and re-arm.
   *
   * Called when idle is switched off and on again. Without it a blink frozen
   * half-closed at the moment idle stopped would resume from the middle, which
   * looks like a twitch.
   */
  reset(now: MonotonicMs): void {
    this.blinkStartedAt = null
    this.nextBlinkAt = (Number.isFinite(now) ? now : 0) + nextBlinkGap(this.random)
  }
}
