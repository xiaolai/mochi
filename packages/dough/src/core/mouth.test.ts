import { describe, expect, it } from 'vitest'
import trace from './__fixtures__/her-voice.json' with { type: 'json' }
import { EnvelopeMouth, type MouthSink } from './mouth'

const DT = trace.sampleMs / 1000
const SPEECH = 1e-3

function recorder(): MouthSink & { readonly written: number[] } {
  const written: number[] = []
  return { written, setMouthOpen: (value) => written.push(value) }
}

/** Drive a mouth through the recorded trace and return everything it wrote. */
function speak(mouth: EnvelopeMouth, sink: { readonly written: number[] }): number[] {
  for (const level of trace.rms) mouth.observe(level, DT)
  return sink.written
}

describe('EnvelopeMouth', () => {
  it('writes to the avatar every frame it observes', () => {
    // Every frame, not only when the value changed: the avatar's mouth is a
    // field the renderer reads, and a driver that skips frames leaves the last
    // value standing rather than the current one.
    const sink = recorder()
    const mouth = new EnvelopeMouth(sink)
    for (let i = 0; i < 10; i++) mouth.observe(0.05, DT)
    expect(sink.written).toHaveLength(10)
  })

  it('opens on her speech and closes in her gaps', () => {
    const sink = recorder()
    const written = speak(new EnvelopeMouth(sink), sink)

    const RELEASE = 10
    const nearSpeech = (index: number): boolean =>
      trace.rms.slice(Math.max(0, index - RELEASE), index + RELEASE).some((l) => l >= SPEECH)

    const speaking = written.filter((_, i) => trace.rms[i]! >= SPEECH)
    const settled = written.filter((_, i) => trace.rms[i]! < SPEECH && !nearSpeech(i))

    expect(speaking.filter((v) => v > 0.1).length / speaking.length).toBeGreaterThan(0.5)
    expect(Math.max(...settled)).toBeLessThan(0.02)
  })

  it('never writes a value outside 0..1', () => {
    const sink = recorder()
    const mouth = new EnvelopeMouth(sink)
    for (const level of [0, 1e-9, 0.5, 1000, -5, Number.NaN, 0.9, Number.POSITIVE_INFINITY]) {
      mouth.observe(level, DT)
    }
    for (const value of sink.written) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('end() shuts the mouth at once', () => {
    const sink = recorder()
    const mouth = new EnvelopeMouth(sink)
    for (const level of trace.rms.slice(0, 120)) mouth.observe(level, DT)
    mouth.end()
    expect(sink.written.at(-1)).toBe(0)
  })

  it('end() keeps the calibration, so the next turn does not recalibrate', () => {
    // The floor and peak belong to this voice on this connection, not to this
    // turn. Throwing them away at every boundary makes her first syllable back
    // either slam or sit closed while the estimate catches up -- and the seam
    // between turns is exactly where nobody wants a visible artefact.
    const loud = [...trace.rms].sort((a, b) => b - a)[10]!

    const warm = recorder()
    const warmed = new EnvelopeMouth(warm)
    speak(warmed, warm)
    warmed.end()
    warmed.observe(loud, DT)
    const afterEnd = warm.written.at(-1)!

    const cold = recorder()
    new EnvelopeMouth(cold).observe(loud, DT)
    const fromScratch = cold.written.at(-1)!

    // A warmed driver already knows how loud she gets, so one loud frame moves
    // it much further than the same frame does on a driver starting blind.
    expect(afterEnd).toBeGreaterThan(fromScratch)
  })

  it('is scale invariant end to end, not just inside the envelope', () => {
    // Asserted at the mouth rather than at the envelope, because this is the
    // value that reaches the avatar and it is the one that has to survive a
    // voice change, a provider change, or a volume GainNode upstream.
    const reference = (() => {
      const sink = recorder()
      return speak(new EnvelopeMouth(sink), sink)
    })()
    for (const scale of [0.05, 8]) {
      const sink = recorder()
      const mouth = new EnvelopeMouth(sink)
      for (const level of trace.rms) mouth.observe(level * scale, DT)
      for (const [i, value] of reference.entries()) {
        expect(sink.written[i], `scale ${scale} frame ${i}`).toBeCloseTo(value, 6)
      }
    }
  })

  it('does not move the mouth when there is only comfort noise', () => {
    const sink = recorder()
    const mouth = new EnvelopeMouth(sink)
    for (let i = 0; i < 300; i++) mouth.observe(9e-5 + Math.sin(i) * 3e-5, DT)
    expect(Math.max(...sink.written)).toBeLessThan(0.02)
  })
})
