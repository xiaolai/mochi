import { describe, expect, it } from 'vitest'
import { createAttending } from './attending'

/** `howLong` seconds of microphone at a steady level. */
function mic(a: ReturnType<typeof createAttending>, howLong: number, level: number): string {
  let last = a.state()
  for (let i = 0; i < howLong * 60; i += 1) last = a.step(level, 1 / 60)
  return last
}

const LOUD = 0.1
const ROOM = 0.002

describe('knowing they stopped, before the service does', () => {
  it('hears them while they are talking', () => {
    const a = createAttending()
    expect(mic(a, 1, LOUD)).toBe('hearing')
  })

  it('notices the silence in a fraction of what the service takes', () => {
    // §62: the service takes 1026ms at the median to say `speech_stopped`. This
    // is the whole point — the microphone already knew.
    const a = createAttending()
    mic(a, 1, LOUD)
    expect(mic(a, 0.4, ROOM)).toBe('considering')
  })

  it('does not fire between two words', () => {
    // An ordinary gap inside a sentence is well under the threshold. Firing
    // there would make her consider things mid-sentence, repeatedly.
    const a = createAttending()
    mic(a, 1, LOUD)
    expect(mic(a, 0.15, ROOM)).toBe('hearing')
    expect(mic(a, 0.5, LOUD)).toBe('hearing')
  })

  it('stops considering once she answers', () => {
    const a = createAttending()
    mic(a, 1, LOUD)
    expect(mic(a, 0.4, ROOM)).toBe('considering')
    a.answered()
    expect(a.state()).toBe('idle')
  })

  it('does not re-consider a silence that has already been answered', () => {
    const a = createAttending()
    mic(a, 1, LOUD)
    mic(a, 0.4, ROOM)
    a.answered()
    expect(mic(a, 5, ROOM)).toBe('idle')
  })

  it('does not consider when she answered while they were STILL talking', () => {
    // Barge-in: she starts before they finish. When they then stop, there is
    // nothing left to wait for — she is already talking — so considering would
    // put her in a waiting pose during her own reply.
    //
    // This is the case `spent` exists for. A control that removed it left the
    // test above passing, because that path is already blocked by the state
    // machine; this one reaches it.
    const a = createAttending()
    mic(a, 1, LOUD)
    a.answered()
    expect(mic(a, 1, ROOM)).toBe('idle')
  })

  it('considers again when they say something NEW', () => {
    const a = createAttending()
    mic(a, 1, LOUD)
    mic(a, 0.4, ROOM)
    a.answered()
    mic(a, 5, ROOM)

    expect(mic(a, 1, LOUD)).toBe('hearing')
    expect(mic(a, 0.4, ROOM)).toBe('considering')
  })

  it('ignores room noise entirely', () => {
    const a = createAttending()
    expect(mic(a, 3, ROOM)).toBe('idle')
  })
})
