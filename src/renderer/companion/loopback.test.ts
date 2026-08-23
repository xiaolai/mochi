import { describe, expect, it } from 'vitest'
import { correlationOf, createLoopback, type Summary } from './loopback'

/** Fill windows until a summary comes back, or give up after a bounded run. */
function drive(
  loop: ReturnType<typeof createLoopback>,
  frames: readonly { her: number; mic: number; speaking?: boolean }[],
): Summary | null {
  let last: Summary | null = null
  for (const frame of frames) {
    const out = loop.observe(frame.her, frame.mic, frame.speaking ?? true)
    if (out !== null) last = out
  }
  return last
}

/** 90 audible frames × 10 windows is one summary. */
function speech(count: number, gain: number, noise = 0): { her: number; mic: number }[] {
  return Array.from({ length: count }, (_, i) => {
    // A phrase shape rather than a constant: a flat signal has no variance and
    // a correlation over it is not a measurement.
    const her = 0.2 + 0.15 * Math.sin(i / 7)
    return { her, mic: her * gain + noise * Math.sin(i / 3.1) }
  })
}

describe('the correlation itself', () => {
  it('is 1 when the microphone is a scaled copy of her', () => {
    const her = [1, 2, 3, 4, 5]
    expect(correlationOf(her, [0.1, 0.2, 0.3, 0.4, 0.5])).toBeCloseTo(1, 6)
  })

  it('is 0 rather than NaN when either side never varies', () => {
    /*
      The case that would otherwise divide by zero and poison every summary
      after it. It is also the least informative window there is — a constant
      says nothing about what it might be driving — so a confident number here
      would be worse than an honest zero.
    */
    expect(correlationOf([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0)
    expect(correlationOf([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0)
    expect(Number.isNaN(correlationOf([1, 1], [1, 1]))).toBe(false)
  })

  it('is negative when they move oppositely', () => {
    expect(correlationOf([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 6)
  })

  it('answers 0 for a window too short to mean anything', () => {
    expect(correlationOf([], [])).toBe(0)
    expect(correlationOf([1], [1])).toBe(0)
  })
})

describe('the window is measured in evidence, not in time', () => {
  it('does not fill on frames where she is silent', () => {
    /*
      §17's addendum is entirely about this. v1 fed a sample on every animation
      frame, silence included, while the verdict required half a 90-frame window
      to be audible — and ordinary speech is phrase, breath, phrase, which
      misses that bar. Window after window was consumed deciding nothing, and
      the detector took ninety seconds to notice an echo cutting her off every
      eleven seconds.
    */
    const loop = createLoopback()
    const quiet = Array.from({ length: 5_000 }, () => ({ her: 0, mic: 0.4, speaking: false }))
    expect(drive(loop, quiet)).toBeNull()
  })

  it('reports once it has enough of her actually speaking', () => {
    const loop = createLoopback()
    const summary = drive(loop, speech(90 * 10, 0.5))
    expect(summary).not.toBeNull()
    expect(summary?.windows).toBe(10)
  })

  it('is unaffected by how much silence sits between her phrases', () => {
    // The property the time-based window did not have: a summary after N
    // audible frames, whatever the wall clock did in between.
    const loop = createLoopback()
    const withGaps = speech(90 * 10, 0.5).flatMap((frame) => [
      frame,
      { her: 0, mic: 0, speaking: false },
      { her: 0, mic: 0, speaking: false },
    ])
    expect(drive(loop, withGaps)?.windows).toBe(10)
  })
})

describe('what it reports', () => {
  it('separates an echoing room from a quiet one', () => {
    /*
      The comparison §17 asks for, in one assertion. On earphones the microphone
      hears the room and not her, so the two series are unrelated; on speakers
      it hears a scaled copy of her through the AEC residue. If this instrument
      cannot tell those apart on synthetic input it cannot tell them apart on
      real input either.
    */
    const speakers = drive(createLoopback(), speech(90 * 10, 0.05))
    const earphones = drive(
      createLoopback(),
      Array.from({ length: 90 * 10 }, (_, i) => ({
        her: 0.2 + 0.15 * Math.sin(i / 7),
        // Unrelated room noise on a different period.
        mic: 0.03 + 0.02 * Math.sin(i / 23.7 + 1.1),
      })),
    )
    expect(speakers?.correlation.median).toBeGreaterThan(0.9)
    expect(Math.abs(earphones?.correlation.median ?? 1)).toBeLessThan(0.9)
  })

  it('reports the residual RATIO as well, because a correlation cannot say how loud', () => {
    // Two signals can track each other perfectly at a thousandth of the
    // amplitude. `semantic_vad` needs something loud enough to look like
    // speech, so the ratio is what says whether there is anything to mistake.
    const loud = drive(createLoopback(), speech(90 * 10, 0.5))
    const faint = drive(createLoopback(), speech(90 * 10, 0.005))
    expect(loud?.correlation.median).toBeCloseTo(faint?.correlation.median ?? 0, 3)
    expect(loud?.residual.median ?? 0).toBeGreaterThan((faint?.residual.median ?? 0) * 50)
  })

  it('carries a spread rather than one number', () => {
    // §17's instruction is to compare distributions between two rooms, and a
    // single median hides the case that matters: an echo that only appears on
    // her loudest phrases.
    const summary = drive(createLoopback(), speech(90 * 10, 0.5))
    expect(summary?.correlation.min).toBeLessThanOrEqual(summary?.correlation.median ?? 0)
    expect(summary?.correlation.max).toBeGreaterThanOrEqual(summary?.correlation.median ?? 0)
  })
})

describe('reset', () => {
  it('throws away a half-filled window', () => {
    // A window spanning a nap is not a measurement of anything.
    const loop = createLoopback()
    drive(loop, speech(90 * 9 + 45, 0.5))
    loop.reset()
    // 45 frames were in flight and 9 windows were banked; both are gone, so a
    // further 9 windows must not be enough.
    expect(drive(loop, speech(90 * 9, 0.5))).toBeNull()
    expect(drive(loop, speech(90, 0.5))).not.toBeNull()
  })
})

describe('it changes nothing', () => {
  it('has no threshold and no verdict in its surface', () => {
    /*
      The property that makes this an instrument rather than v1's detector.
      §17 is explicit that `CORRELATED = 0.6` "has never been checked against
      post-AEC residual on real hardware … That is a measurement, not a
      threshold to nudge." A boolean anywhere in this module's answer would be
      that threshold, wherever the number was written.
    */
    const summary = drive(createLoopback(), speech(90 * 10, 0.5))
    expect(summary).not.toBeNull()
    for (const value of Object.values(summary as unknown as Record<string, unknown>)) {
      expect(typeof value).not.toBe('boolean')
    }
  })
})
