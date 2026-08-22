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
  it('completes one cycle per period', () => {
    expect(breathAt(0)).toBeCloseTo(0, 6)
    expect(breathAt(BREATH_PERIOD_MS / 4)).toBeCloseTo(1, 6)
    expect(breathAt(BREATH_PERIOD_MS * 0.75)).toBeCloseTo(-1, 6)
    expect(breathAt(BREATH_PERIOD_MS)).toBeCloseTo(0, 6)
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

describe('the drift — being alive while going nowhere', () => {
  it('stays inside its declared reach, over an hour of it', () => {
    /*
      The reach is reserved in her window before she can use it (`builtInReach`
      sums it with the clips), so a drift that could exceed its own constant
      would walk her into the edge of a transparent rectangle — intermittently,
      at whatever moment three sines happened to agree.
    */
    for (let t = 0; t < 3_600_000; t += 97) {
      const d = driftAt(t)
      expect(Math.abs(d.lean), `lean at ${String(t)}`).toBeLessThanOrEqual(DRIFT.lean + 1e-9)
      expect(Math.abs(d.shift), `shift at ${String(t)}`).toBeLessThanOrEqual(DRIFT.shift + 1e-9)
      expect(d.lift, `lift at ${String(t)}`).toBeLessThanOrEqual(DRIFT.lift + 1e-9)
    }
  })

  it('never puts her feet below the ground', () => {
    // A bob that dipped would push her through the surface she stands on.
    for (let t = 0; t < 200_000; t += 61) expect(driftAt(t).lift).toBeGreaterThanOrEqual(0)
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
