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

export interface IdlePose {
  /** 0..1, where 1 is fully shut. */
  readonly blink: number
  /** -1..1. Positive is inhaled. */
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
 * A sine rather than a triangle: the turnaround at each end of a breath is
 * gradual, and a linear ramp gives the body a visible tick at the top.
 */
export function breathAt(now: MonotonicMs, periodMs: number = BREATH_PERIOD_MS): number {
  if (!Number.isFinite(now) || !(periodMs > 0)) return 0
  return Math.sin((2 * Math.PI * now) / periodMs)
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

  pose(now: MonotonicMs): IdlePose {
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
    return { blink, breath: breathAt(now) }
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
