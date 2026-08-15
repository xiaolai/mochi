/**
 * Telling her own echo apart from a person talking.
 *
 * The three cases are the whole point, and the third is why this measures
 * correlation rather than level: somebody interrupting her makes the microphone
 * loud WHILE she is talking, which is exactly what echo looks like to a
 * threshold — and they are the one person who must never be muted.
 */

import { describe, expect, it } from 'vitest'
import { CORRELATED, WINDOW, correlation, createLoopbackDetector, type Pair } from './loopback'

/** Her envelope: speech is bursty, so this is not a constant. */
function herVoice(n: number): number {
  return 0.2 + 0.25 * Math.abs(Math.sin(n / 3))
}

/** Speakers: the microphone hears her, quieter and with a little room noise. */
function echoing(count: number): Pair[] {
  return Array.from({ length: count }, (_, n) => ({
    her: herVoice(n),
    mic: herVoice(n) * 0.3 + 0.01,
  }))
}

/** Earphones, quiet room: the microphone sits on its floor and stays there. */
function silent(count: number): Pair[] {
  return Array.from({ length: count }, (_, n) => ({
    her: herVoice(n),
    // Not a constant: a real floor wanders. It just does not wander with HER.
    mic: 0.01 + 0.004 * Math.abs(Math.sin(n / 7.3)),
  }))
}

/** Earphones, somebody answering over her: loud microphone, unrelated shape. */
function interrupted(count: number): Pair[] {
  return Array.from({ length: count }, (_, n) => ({
    her: herVoice(n),
    mic: 0.3 + 0.2 * Math.abs(Math.sin(n / 11.7 + 1.1)),
  }))
}

describe('what the two envelopes say about the room', () => {
  it('scores her own echo as the same sound', () => {
    expect(correlation(echoing(WINDOW))!).toBeGreaterThan(CORRELATED)
  })

  it('scores a quiet room as no echo', () => {
    expect(correlation(silent(WINDOW))!).toBeLessThan(CORRELATED)
  })

  it('scores somebody talking OVER her as no echo', () => {
    // The case a level threshold gets wrong. The microphone is louder here than
    // in the echoing case, and muting on loudness would silence the one person
    // who is trying to interrupt.
    const score = correlation(interrupted(WINDOW))!
    expect(score).toBeLessThan(CORRELATED)
    // And it is louder. Stated so the test fails if the fixture stops being
    // the hard case it was written to be.
    const loudest = Math.max(...interrupted(WINDOW).map((p) => p.mic))
    expect(loudest).toBeGreaterThan(Math.max(...echoing(WINDOW).map((p) => p.mic)))
  })

  it('says nothing when she has barely spoken', () => {
    // `null`, not `false`. "No echo" and "nobody has looked yet" are different
    // answers, and a detector that confuses them reports confidently about a
    // session that has not made a sound.
    expect(correlation([])).toBeNull()
    expect(correlation(silent(4))).toBeNull()
    // Her being silent is not evidence either, however many frames of it.
    const quiet = Array.from({ length: WINDOW }, () => ({ her: 0, mic: 0.4 }))
    expect(correlation(quiet)).toBeNull()
  })

  it('does not count the pauses between her phrases as evidence', () => {
    // The gap between two sentences is silence on both sides, and two silences
    // step together perfectly. Counting them makes ANY room look like echo:
    // the microphone drops when she stops simply because she stopped.
    //
    // Here her level is constant while she is actually audible, so once the
    // pauses are excluded there is nothing left to correlate -- which is the
    // honest answer. Include them and the pattern reads as a clean +1.
    const withPauses: Pair[] = Array.from({ length: WINDOW * 2 }, (_, n) => {
      const speaking = n % 2 === 0
      return { her: speaking ? 0.4 : 0, mic: speaking ? 0.012 : 0 }
    })
    expect(correlation(withPauses)).toBeNull()
  })

  it('says nothing when an envelope never moves', () => {
    // A flat line has no correlation to report. Dividing by its zero variance
    // yields NaN, which compares false against every threshold and so reads as
    // "no echo" while meaning "no answer".
    const flat = Array.from({ length: WINDOW }, () => ({ her: 0.3, mic: 0.1 }))
    expect(correlation(flat)).toBeNull()
  })
})

describe('the detector over a live session', () => {
  const feed = (pairs: readonly Pair[], into: ReturnType<typeof createLoopbackDetector>): void => {
    for (const pair of pairs) into.sample(pair.her, pair.mic)
  }

  it('withholds a verdict until it has heard a window', () => {
    const detector = createLoopbackDetector()
    feed(echoing(WINDOW - 1), detector)
    expect(detector.verdict()).toBeNull()
    feed(echoing(1), detector)
    expect(detector.verdict()).toBe(true)
  })

  it('holds its answer through a window that decides nothing', () => {
    // A pause is not evidence of anything, and re-deciding on it would flip the
    // microphone open in the middle of her sentence.
    const detector = createLoopbackDetector()
    feed(echoing(WINDOW), detector)
    expect(detector.verdict()).toBe(true)
    feed(
      Array.from({ length: WINDOW }, () => ({ her: 0, mic: 0 })),
      detector,
    )
    expect(detector.verdict()).toBe(true)
  })

  it('changes its mind when the room does', () => {
    // Plugging earphones in mid-conversation. The next full window disagrees
    // and the verdict follows it.
    const detector = createLoopbackDetector()
    feed(echoing(WINDOW), detector)
    expect(detector.verdict()).toBe(true)
    feed(silent(WINDOW), detector)
    expect(detector.verdict()).toBe(false)
  })

  it('forgets everything when the devices change under it', () => {
    const detector = createLoopbackDetector()
    feed(echoing(WINDOW), detector)
    detector.reset()
    expect(detector.verdict()).toBeNull()
  })
})
