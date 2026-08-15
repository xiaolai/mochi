import { describe, expect, it } from 'vitest'
import trace from './__fixtures__/her-voice.json' with { type: 'json' }
import { DEFAULT_ENVELOPE, SILENT, advanceEnvelope, rms, type EnvelopeState } from './envelope'

const DT = trace.sampleMs / 1000
/** Three orders above the measured comfort-noise floor, well below any speech. */
const SPEECH = 1e-3

/** Run the envelope over a series of RMS values and return the mouth openings. */
function run(levels: readonly number[], scale = 1): number[] {
  let state: EnvelopeState = SILENT
  const out: number[] = []
  for (const level of levels) {
    state = advanceEnvelope(level * scale, state, DT)
    out.push(state.mouthOpen)
  }
  return out
}

const share = (values: readonly number[], predicate: (v: number) => boolean): number =>
  values.filter(predicate).length / values.length

describe('rms', () => {
  it('measures a known signal', () => {
    // A full-scale square wave is exactly 1; a sine is 1/sqrt(2).
    expect(rms(Float32Array.from([1, -1, 1, -1]))).toBeCloseTo(1, 6)
    const sine = Float32Array.from({ length: 1000 }, (_, i) => Math.sin((i / 1000) * Math.PI * 2))
    expect(rms(sine)).toBeCloseTo(Math.SQRT1_2, 3)
  })

  it('is zero for silence and for an empty block', () => {
    expect(rms(new Float32Array(64))).toBe(0)
    expect(rms(new Float32Array(0))).toBe(0)
  })

  it('skips non-finite samples instead of returning NaN', () => {
    // One glitched sample would otherwise poison the filter and freeze the
    // mouth for the rest of the session.
    expect(rms(Float32Array.from([1, Number.NaN, -1, Number.POSITIVE_INFINITY]))).toBeCloseTo(1, 6)
  })
})

describe('advanceEnvelope, against her actual voice', () => {
  // The fixture is a real recording: RMS of gpt-realtime's output over WebRTC,
  // captured from a live session. Testing against synthesised tones
  // would prove the arithmetic and nothing about whether she looks right.
  const levels = trace.rms
  const speaking = levels.filter((level) => level >= SPEECH)
  const quiet = levels.filter((level) => level < SPEECH)

  it('the fixture really does contain both speech and gaps', () => {
    // Guarding the instrument. Every assertion below is meaningless if the
    // recording turns out to be all one thing.
    expect(speaking.length).toBeGreaterThan(30)
    expect(quiet.length).toBeGreaterThan(100)
    expect(Math.max(...speaking)).toBeGreaterThan(0.1)
  })

  it('the floor is comfort noise, not digital silence', () => {
    // The measured fact the whole design rests on. Once media is flowing the
    // stream essentially never returns to zero, so a gate is genuinely required
    // -- and it only needs to clear ~1e-4, not the 0.01 that was inherited.
    //
    // "Essentially": one frame in the recording IS exactly zero. Asserting on
    // the SHARE rather than on none of them, because the one that exists is the
    // honest reading of the measurement -- probably a dropped packet, and not a
    // reason to believe the stream goes quiet on purpose.
    expect(Math.max(...quiet)).toBeLessThan(1e-3)
    expect(quiet.filter((level) => level === 0).length / quiet.length).toBeLessThan(0.02)
  })

  it('keeps the mouth shut through the gaps', () => {
    // Judged only on frames well AWAY from speech. The frames just after a
    // syllable are the mouth closing, which is correct and would otherwise be
    // counted as a failure -- the property that matters is that she does not
    // chatter on the noise floor, not that she snaps shut instantly.
    const RELEASE_FRAMES = 10
    const nearSpeech = (index: number): boolean =>
      levels
        .slice(Math.max(0, index - RELEASE_FRAMES), index + RELEASE_FRAMES)
        .some((level) => level >= SPEECH)

    const open = run(levels)
    const settled = open.filter((_, i) => levels[i]! < SPEECH && !nearSpeech(i))
    expect(settled.length).toBeGreaterThan(50)
    expect(Math.max(...settled)).toBeLessThan(0.02)
  })

  it('keeps the mouth moving through the speech', () => {
    const open = run(levels)
    const duringSpeech = open.filter((_, i) => levels[i]! >= SPEECH)
    expect(share(duringSpeech, (v) => v > 0.1)).toBeGreaterThan(0.5)
  })

  it('modulates instead of pinning wide open', () => {
    // The concrete defect in the inherited constants: gain 12 saturated at
    // 0.093 while speech reached 0.137 at p90, so more than a tenth of frames
    // sat at the stop. A mouth at its limit carries no information.
    const open = run(levels)
    const duringSpeech = open.filter((_, i) => levels[i]! >= SPEECH)
    expect(share(duringSpeech, (v) => v > 0.98)).toBeLessThan(0.05)
    // And it does still reach a wide opening on the loudest syllables.
    expect(Math.max(...open)).toBeGreaterThan(0.7)
  })

  it('is scale invariant — the property the fixed gate did not have', () => {
    // The headline. A different voice, a provider change, or somebody adding a
    // volume GainNode upstream all multiply this signal by a constant. An
    // absolute threshold silently changes behaviour; this must not.
    const reference = run(levels)
    for (const scale of [0.1, 0.25, 4, 10]) {
      const scaled = run(levels, scale)
      for (const [i, value] of reference.entries()) {
        expect(scaled[i], `scale ${scale} at frame ${i}`).toBeCloseTo(value, 6)
      }
    }
  })
})

describe('advanceEnvelope, edge cases', () => {
  it('treats a non-finite level as silence rather than propagating it', () => {
    const state = advanceEnvelope(Number.NaN, SILENT, DT)
    expect(Number.isFinite(state.mouthOpen)).toBe(true)
    expect(state.mouthOpen).toBe(0)
  })

  it('recovers after a non-finite level', () => {
    // Fed real-shaped speech rather than a DC level: a constant tone is
    // genuinely ambiguous to a noise-floor tracker, and correctly ends up
    // classified as floor. Speech modulates, which is what lets the estimator
    // find the gaps.
    let state = advanceEnvelope(Number.NaN, SILENT, DT)
    for (const level of trace.rms) state = advanceEnvelope(level, state, DT)
    const speaking = [...trace.rms].sort((a, b) => b - a)[5]!
    state = advanceEnvelope(speaking, state, DT)
    expect(state.mouthOpen).toBeGreaterThan(0.3)
  })

  it('clamps an enormous frame gap rather than decaying the reference to nothing', () => {
    // A backgrounded window delivers dt in seconds. Without the clamp the peak
    // decays to zero and her first syllable back slams the mouth wide.
    let state: EnvelopeState = SILENT
    for (let i = 0; i < 20; i++) state = advanceEnvelope(0.1, state, DT)
    const before = state.peak
    state = advanceEnvelope(0.1, state, 600)
    expect(state.peak).toBeGreaterThan(before * 0.5)
  })

  it('stops reporting speech promptly after she actually stops', () => {
    // The farewell waits on this flag, so its release time is a user-visible
    // duration, not an internal detail.
    //
    // It used to be judged from the reference peak, which decays at 0.4 per
    // second BY DESIGN -- that slow decay is what stops a murmur after a pause
    // reading as a shout. Reused as a speech detector it meant
    // `ln(0.02)/ln(0.4)` = 4.27 seconds of "still talking" after silence, on
    // top of the caller's 500ms debounce. Nothing here caught it, because every
    // other assertion is about the mouth rather than about when the flag falls.
    let state: EnvelopeState = SILENT
    for (const level of trace.rms) state = advanceEnvelope(level, state, DT)
    // Seed a loud phrase so the peak is high and would take seconds to decay.
    for (let i = 0; i < 30; i++) state = advanceEnvelope(0.1, state, DT)
    expect(state.speaking, 'should be speaking mid-phrase').toBe(true)
    const peakAtSilence = state.peak

    let elapsed = 0
    while (state.speaking && elapsed < 5) {
      state = advanceEnvelope(8.4e-5, state, DT)
      elapsed += DT
    }
    expect(state.speaking, 'never stopped within 5s').toBe(false)
    expect(elapsed).toBeLessThan(0.3)
    // The peak is still high at that moment, which is the point: releasing is
    // no longer coupled to it. Without this the test would also pass if someone
    // simply made the peak decay fast, which would break the mouth's scaling.
    expect(state.peak).toBeGreaterThan(peakAtSilence * 0.5)
  })

  it('holds through the dip between two syllables', () => {
    // The other half of the trade. A release that merely reads the current
    // level flickers false in every inter-syllable gap, and the caller counts
    // those as silence.
    let state: EnvelopeState = SILENT
    // Comfort noise FIRST, so the floor settles where a real session puts it.
    // Seeding it from a loud opening frame pins it at speech level, and then
    // nothing ever clears `floor * speechRatio` -- which is the documented
    // "floor estimator seeded high" failure, not the behaviour under test.
    for (let i = 0; i < 100; i++) state = advanceEnvelope(8.4e-5, state, DT)
    for (let i = 0; i < 30; i++) state = advanceEnvelope(0.06, state, DT)
    expect(state.speaking, 'not speaking before the dip').toBe(true)
    // A dip to a tenth of speech level, lasting 100ms -- shorter than the hold.
    for (let i = 0; i < Math.round(0.1 / DT); i++) {
      state = advanceEnvelope(0.006, state, DT)
      expect(state.speaking, 'dropped out mid-word').toBe(true)
    }
  })

  it('never leaves the mouth outside 0..1', () => {
    let state: EnvelopeState = SILENT
    for (const level of [0, 1e-9, 0.5, 1000, -5, 0.02, Number.NaN, 0.9]) {
      state = advanceEnvelope(level, state, DT)
      expect(state.mouthOpen).toBeGreaterThanOrEqual(0)
      expect(state.mouthOpen).toBeLessThanOrEqual(1)
    }
  })

  it('does not open the mouth on a signal that is only ever noise', () => {
    // A session where she never speaks must not produce a twitching mouth.
    let state: EnvelopeState = SILENT
    const opens: number[] = []
    for (let i = 0; i < 300; i++) {
      state = advanceEnvelope(8e-5 + Math.sin(i) * 3e-5, state, DT)
      opens.push(state.mouthOpen)
    }
    expect(Math.max(...opens)).toBeLessThan(0.02)
  })

  it('every default is a ratio or a rate, never a level', () => {
    // The invariant behind scale invariance, asserted structurally: the moment
    // somebody adds an absolute threshold back, this module quietly stops being
    // level-independent and no behavioural test would obviously catch it.
    for (const [key, value] of Object.entries(DEFAULT_ENVELOPE)) {
      expect(Number.isFinite(value), key).toBe(true)
      expect(value, key).toBeGreaterThan(0)
    }
    expect(DEFAULT_ENVELOPE.speechRatio).toBeGreaterThan(1)
    expect(DEFAULT_ENVELOPE.peakHeadroom).toBeGreaterThan(1)
    expect(DEFAULT_ENVELOPE.smoothing).toBeLessThanOrEqual(1)
    expect(DEFAULT_ENVELOPE.maxGateFraction).toBeLessThan(1)
    expect(DEFAULT_ENVELOPE.minPeakFraction).toBeLessThan(1)
  })
})

describe('a gap in the stream', () => {
  const step = (state: EnvelopeState, level: number, frames = 1): EnvelopeState => {
    let next = state
    for (let i = 0; i < frames; i++) next = advanceEnvelope(level, next, 1 / 60)
    return next
  }

  it('keeps hearing her after a frame of digital silence', () => {
    // The failure this guards: exact zero was accepted as a new floor minimum,
    // which reset the estimate to the "no measurement yet" sentinel, so the
    // next frame carrying signal seeded the floor AT SPEAKING LEVEL. Nothing
    // can then clear `floor * speechRatio`, and a multiplicative rise cannot
    // climb out of zero -- she stayed shut through continuous speech, with no
    // error anywhere. A muted mic or one dropped buffer was enough.
    const room = step(SILENT, 0.002, 60)
    const speech = step(room, 0.2, 30)
    expect(speech.speaking).toBe(true)

    const gap = step(room, 0, 1)
    const after = step(gap, 0.2, 30)
    expect(after.speaking).toBe(true)
    expect(after.mouthOpen).toBeGreaterThan(0.1)
  })

  it('survives a long mute rather than only a single dropped frame', () => {
    const room = step(SILENT, 0.002, 60)
    const muted = step(room, 0, 600)
    expect(step(muted, 0.2, 30).speaking).toBe(true)
  })

  it('still takes its first floor reading from the first real frame', () => {
    // Skipping zeros must not stop the estimate from ever starting: leading
    // silence before the mic opens is the ordinary case.
    const leading = step(SILENT, 0, 120)
    expect(leading.floor).toBe(0)
    expect(step(leading, 0.002, 1).floor).toBeCloseTo(0.002, 6)
  })
})
