import { describe, expect, it } from 'vitest'
import {
  BLINK_DURATION_MS,
  BLINK_MAX_GAP_MS,
  BLINK_MIN_GAP_MS,
  BREATH_PERIOD_MS,
  DRIFT,
  IdleLayer,
  blinkAt,
  breathAt,
  driftAt,
  nextBlinkGap,
} from './idle'

describe('breathAt', () => {
  it('completes one cycle per period, resting at both ends', () => {
    expect(breathAt(0)).toBeCloseTo(0, 6)
    expect(breathAt(BREATH_PERIOD_MS * 0.4)).toBeCloseTo(1, 6)
    expect(breathAt(BREATH_PERIOD_MS)).toBeCloseTo(0, 6)
    // And it repeats, rather than only being right on the first pass.
    expect(breathAt(BREATH_PERIOD_MS * 1.4)).toBeCloseTo(1, 6)
    expect(breathAt(BREATH_PERIOD_MS * 3)).toBeCloseTo(0, 6)
  })

  it('goes in faster than it comes out', () => {
    /*
      Inspiration is muscular and expiration is elastic recoil, so a resting
      breath is not symmetric in time. Stated as WHERE the peak falls rather
      than as the constant's value, so this survives the fraction being retuned
      and fails if the curve is ever flattened back to one cosine.
    */
    const SAMPLES = 2000
    let peakAt = 0
    let peak = -1
    for (let i = 0; i < SAMPLES; i++) {
      const value = breathAt((BREATH_PERIOD_MS * i) / SAMPLES)
      if (value > peak) {
        peak = value
        peakAt = i / SAMPLES
      }
    }
    expect(peak).toBeCloseTo(1, 6)
    expect(peakAt).toBeLessThan(0.5)
    // The exhale is the long tail: half way through the cycle she is still most
    // of the way inhaled. A symmetric breath would be back at exactly 1 here.
    expect(breathAt(BREATH_PERIOD_MS / 2)).toBeGreaterThan(0.75)
    expect(breathAt(BREATH_PERIOD_MS / 2)).toBeLessThan(1)
  })

  it('turns without a corner, at the peak and at the wrap alike', () => {
    /*
      The curve is piecewise, and the join is where a tick comes from. Both
      halves are built to meet with ZERO SLOPE, so what has to be asserted is
      the slope, not the value -- a corner is perfectly continuous, and a check
      on the gap between neighbouring samples sails straight past one. This test
      was written that way first and passed against a pair of linear ramps.

      So: the second difference. Across a smooth turn adjacent steps are nearly
      equal; at a corner the step reverses in one sample. Sampled across the
      whole cycle rather than near the two joins, because "where is the join"
      is exactly the thing a future retune moves.
    */
    const SAMPLES = 4000
    const step = (i: number): number =>
      breathAt((BREATH_PERIOD_MS * i) / SAMPLES) - breathAt((BREATH_PERIOD_MS * (i - 1)) / SAMPLES)

    let worstStep = 0
    let worstBend = 0
    let previous = step(1)
    for (let i = 2; i <= SAMPLES; i++) {
      const current = step(i)
      worstStep = Math.max(worstStep, Math.abs(current))
      worstBend = Math.max(worstBend, Math.abs(current - previous))
      previous = current
    }
    // Continuous: the steepest point of a raised cosine over 40% of the cycle
    // is about 3.9 per unit phase, so ~0.001 per sample at this resolution.
    expect(worstStep).toBeLessThan(0.005)
    // Smooth: the cosine bends by ~2e-6 per sample here. Two linear ramps
    // meeting at the peak reverse by ~1e-3, five hundred times more.
    expect(worstBend).toBeLessThan(1e-5)
  })

  it('never goes negative, at any phase of any period', () => {
    /*
      The assertion the whole shape exists for, and it is stated over the whole
      cycle rather than at the old trough alone -- a sine shifted by any other
      amount would still pass a single-point check.

      A negative breath drives `squash` negative, and negative squash stretches
      her taller and NARROWER: it is the deformation `sad` and `surprised` are
      made of, at a fraction of their strength. Her crown went pointy once every
      3.4 seconds for exactly this reason. Rest is a floor, not a midpoint.
    */
    for (const periodMs of [200, BREATH_PERIOD_MS, 20_000]) {
      for (let i = 0; i <= 400; i++) {
        const at = (periodMs * i) / 100
        const breath = breathAt(at, periodMs)
        expect(breath, `t=${at} of ${periodMs}ms`).toBeGreaterThanOrEqual(0)
        expect(breath, `t=${at} of ${periodMs}ms`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('returns zero for nonsense rather than NaN', () => {
    expect(breathAt(Number.NaN)).toBe(0)
    expect(breathAt(100, 0)).toBe(0)
    expect(breathAt(100, -1)).toBe(0)
  })
})

describe('blinkAt', () => {
  it('is continuous at both edges, so a blink cannot clip', () => {
    expect(blinkAt(0, 0)).toBe(0)
    expect(blinkAt(BLINK_DURATION_MS, 0)).toBeCloseTo(0, 6)
  })

  it('reaches fully shut partway through', () => {
    const closeMs = BLINK_DURATION_MS * 0.35
    expect(blinkAt(closeMs, 0)).toBeCloseTo(1, 6)
  })

  it('shuts faster than it opens', () => {
    // Not symmetric, and this is most of what makes it read as a blink rather
    // than a flicker. The lid is past halfway down before it is a third of the
    // way through the blink.
    const quarter = blinkAt(BLINK_DURATION_MS * 0.25, 0)
    const threeQuarters = blinkAt(BLINK_DURATION_MS * 0.75, 0)
    expect(quarter).toBeGreaterThan(0.5)
    expect(threeQuarters).toBeLessThan(0.5)
  })

  it('is zero outside the blink so a caller can ask unconditionally', () => {
    expect(blinkAt(-10, 0)).toBe(0)
    expect(blinkAt(BLINK_DURATION_MS + 1, 0)).toBe(0)
  })
})

describe('nextBlinkGap', () => {
  it('stays inside the bounds for any input', () => {
    for (const u of [0, 0.25, 0.5, 0.75, 0.999, 1]) {
      const gap = nextBlinkGap(() => u)
      expect(gap).toBeGreaterThanOrEqual(BLINK_MIN_GAP_MS)
      expect(gap).toBeLessThanOrEqual(BLINK_MAX_GAP_MS)
    }
  })

  it('survives a random source that misbehaves', () => {
    expect(nextBlinkGap(() => Number.NaN)).toBeGreaterThanOrEqual(BLINK_MIN_GAP_MS)
    expect(nextBlinkGap(() => 5)).toBeLessThanOrEqual(BLINK_MAX_GAP_MS)
  })

  it('is skewed short, not uniform', () => {
    // A uniform gap reads as a metronome within about thirty seconds of
    // watching. The exponential puts most gaps in the first half of the range.
    const samples = Array.from({ length: 400 }, (_, i) => nextBlinkGap(() => i / 400))
    const midpoint = (BLINK_MIN_GAP_MS + BLINK_MAX_GAP_MS) / 2
    const short = samples.filter((gap) => gap < midpoint).length
    expect(short).toBeGreaterThan(samples.length * 0.6)
  })
})

describe('IdleLayer', () => {
  it('does not blink the instant she appears', () => {
    // Seeding from zero would put the first blink in the past whenever startup
    // took longer than the minimum gap.
    const layer = new IdleLayer(100_000, () => 0.5)
    expect(layer.pose(100_000).blink).toBe(0)
  })

  it('blinks once the gap has elapsed', () => {
    const layer = new IdleLayer(0, () => 0.5)
    const gap = nextBlinkGap(() => 0.5)
    expect(layer.pose(gap + BLINK_DURATION_MS * 0.35).blink).toBeCloseTo(1, 3)
  })

  it('anchors a blink to its scheduled time, not to the frame that noticed it', () => {
    // With sparse frames — a backgrounded window renders at 1fps — starting
    // from `now` would slide every blink later by the frame gap and the rhythm
    // would drift.
    const layer = new IdleLayer(0, () => 0.5)
    const gap = nextBlinkGap(() => 0.5)
    // One frame arrives long after the blink was due: it is already over.
    expect(layer.pose(gap + BLINK_DURATION_MS + 1).blink).toBe(0)
  })

  it('schedules a fresh gap after each blink', () => {
    const layer = new IdleLayer(0, () => 0.5)
    const gap = nextBlinkGap(() => 0.5)
    layer.pose(gap + BLINK_DURATION_MS + 1)
    expect(layer.pose(gap + BLINK_DURATION_MS + 2).blink).toBe(0)
  })

  it('reset abandons a blink in progress rather than resuming it', () => {
    // A blink frozen half-closed when idle stopped would otherwise resume from
    // the middle, which looks like a twitch.
    const layer = new IdleLayer(0, () => 0.5)
    const gap = nextBlinkGap(() => 0.5)
    const mid = gap + BLINK_DURATION_MS * 0.35
    expect(layer.pose(mid).blink).toBeGreaterThan(0.5)
    layer.reset(mid)
    expect(layer.pose(mid).blink).toBe(0)
  })

  it('returns a flat pose for a non-finite clock', () => {
    const layer = new IdleLayer(0, () => 0.5)
    expect(layer.pose(Number.NaN)).toEqual({ blink: 0, breath: 0 })
  })
})

/**
 * The worst sample over a sweep, and WHERE it was.
 *
 * ## Why the assertion is outside the loop
 *
 * These sweeps take tens of thousands of samples, and an `expect()` per sample
 * is tens of thousands of matcher objects plus a template string built eagerly
 * whether or not anything fails. Idle that costs about a quarter-second; on a
 * loaded machine it ran past vitest's 5s deadline and the suite went red with
 * **a timeout, which says nothing about the drift** — the same failure this
 * repository already fixed once in a wiring guard (`ed89492`), which is what
 * makes it a class rather than an incident.
 *
 * Nothing is sampled less finely to pay for it: the sweeps are unchanged and
 * the property is unchanged. Only the reporting moved, and it got better — a
 * failure now names the WORST offender over the whole hour instead of the first
 * one, which is the sample somebody tuning a constant actually needs.
 */
function worstOver(
  span: number,
  step: number,
  measure: (t: number) => number,
): { value: number; at: number } {
  let value = Number.NEGATIVE_INFINITY
  let at = 0
  for (let t = 0; t < span; t += step) {
    const one = measure(t)
    if (one > value) {
      value = one
      at = t
    }
  }
  return { value, at }
}

describe('the drift — being alive while going nowhere', () => {
  it('stays inside its declared reach, over an hour of it', () => {
    /*
      The reach is reserved in her window before she can use it (`builtInReach`
      sums it with the clips), so a drift that could exceed its own constant
      would walk her into the edge of a transparent rectangle — intermittently,
      at whatever moment three sines happened to agree.
    */
    const channels = [
      { name: 'lean', bound: DRIFT.lean, of: (t: number) => Math.abs(driftAt(t).lean) },
      { name: 'shift', bound: DRIFT.shift, of: (t: number) => Math.abs(driftAt(t).shift) },
      { name: 'lift', bound: DRIFT.lift, of: (t: number) => driftAt(t).lift },
    ]
    for (const channel of channels) {
      const worst = worstOver(3_600_000, 97, channel.of)
      expect(worst.value, `${channel.name} peaks at t=${String(worst.at)}`).toBeLessThanOrEqual(
        channel.bound + 1e-9,
      )
    }
  })

  it('never puts her feet below the ground', () => {
    // A bob that dipped would push her through the surface she stands on.
    // Negated so the same worst-case helper finds the DEEPEST dip.
    const deepest = worstOver(200_000, 61, (t) => -driftAt(t).lift)
    expect(-deepest.value, `lowest lift at t=${String(deepest.at)}`).toBeGreaterThanOrEqual(0)
  })

  it('does not repeat inside a minute, which is what stops it reading as a loop', () => {
    /*
      One sine per channel would be a metronome — the same defect the Poisson
      blink gap exists to avoid, and it reads the same way: after about half a
      minute the eye locks onto the period and she stops looking alive.

      Sampled a second apart and compared against the same offset a minute
      later. If any channel were periodic at a minute or less these would match.
    */
    let identical = 0
    for (let t = 0; t < 60_000; t += 1_000) {
      const a = driftAt(t)
      const b = driftAt(t + 60_000)
      if (Math.abs(a.shift - b.shift) < 1e-4 && Math.abs(a.lean - b.lean) < 1e-4) identical += 1
    }
    expect(identical).toBeLessThan(3)
  })

  it('is small enough to be presence rather than movement', () => {
    // The whole point of it. At her drawn width these are single-digit pixels;
    // a drift you can measure by eye is a character who is pacing.
    expect(DRIFT.shift).toBeLessThan(0.04)
    expect(DRIFT.lean).toBeLessThan(0.04)
    expect(DRIFT.lift).toBeLessThan(0.02)
  })

  it('is a pure function of the clock, so a throttled window resumes in place', () => {
    // No state, no random walk. A frame is a function of `now` alone, which is
    // what lets a window that was backgrounded for ten minutes come back
    // exactly where the clock says it should be rather than somewhere else.
    expect(driftAt(1_234_567)).toEqual(driftAt(1_234_567))
  })

  it('answers zero for nonsense rather than NaN', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(driftAt(bad)).toEqual({ lean: 0, shift: 0, lift: 0 })
    }
    expect(driftAt(1000, Number.NaN)).toEqual({ lean: 0, shift: 0, lift: 0 })
  })

  it('keeps a trace of itself asleep, rather than none', () => {
    // A companion who stops moving altogether reads as a crash, which is the
    // one thing the resting state must not look like.
    const awake = driftAt(4_321, 1)
    const resting = driftAt(4_321, 0.2)
    expect(Math.abs(resting.shift)).toBeLessThan(Math.abs(awake.shift))
    expect(Math.abs(resting.shift)).toBeGreaterThan(0)
  })
})
