import { describe, expect, it } from 'vitest'
import {
  BLINK_DURATION_MS,
  BLINK_MAX_GAP_MS,
  BLINK_MIN_GAP_MS,
  BREATH_PERIOD_MS,
  IdleLayer,
  blinkAt,
  breathAt,
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
