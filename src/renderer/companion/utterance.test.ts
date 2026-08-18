import { describe, expect, it } from 'vitest'
import { createUtterance } from './utterance'

/** `howMany` seconds of 60fps frames, with `quietFor` held. */
function seconds(u: ReturnType<typeof createUtterance>, howMany: number, quietFor: number): void {
  for (let i = 0; i < howMany * 60; i += 1) u.step(quietFor, 1 / 60)
}

describe('the cursor moves only for THIS item, while it sounds', () => {
  it('does not move before her audio has started', () => {
    // §56: the text lands ahead of `output_audio_buffer.started`, so a cursor
    // that moved on arrival would already be mid-sentence before she opened
    // her mouth.
    const u = createUtterance()
    u.add('Once upon a time there was a small green mochi.', 'i1')
    seconds(u, 3, 0)
    expect(u.at()).toBe(0)
    expect(u.begun()).toBe(false)
  })

  it('moves once her audio for that item begins', () => {
    const u = createUtterance()
    u.add('x'.repeat(400), 'i1')
    u.speaks('i1')
    seconds(u, 2, 0)
    expect(u.at()).toBeGreaterThan(10)
    expect(u.at()).toBeLessThan(60)
  })

  it('does not let the PREVIOUS item’s audio drive this one', () => {
    // The bug this gating exists for: the second item's text arrives while the
    // first is still playing, so "there is sound" is true and belongs to
    // somebody else.
    const u = createUtterance()
    u.add('the long story begins here', 'i2')
    seconds(u, 4, 0)
    expect(u.at()).toBe(0)

    u.speaks('i2')
    seconds(u, 2, 0)
    expect(u.at()).toBeGreaterThan(0)
  })

  it('freezes through a pause rather than running on', () => {
    const u = createUtterance()
    u.add('x'.repeat(400), 'i1')
    u.speaks('i1')
    seconds(u, 2, 0)
    const before = u.at()
    seconds(u, 5, 9)
    expect(u.at()).toBe(before)
  })

  it('never runs past what has been generated', () => {
    const u = createUtterance()
    u.add('short.', 'i1')
    u.speaks('i1')
    seconds(u, 60, 0)
    expect(u.at()).toBe('short.'.length)
  })
})

describe('one item at a time', () => {
  it('replaces everything when a new item arrives', () => {
    const u = createUtterance()
    u.add('what she said before', 'i1')
    u.speaks('i1')
    seconds(u, 2, 0)

    u.add('what she says now', 'i2')
    expect(u.text()).toBe('what she says now')
    expect(u.itemId()).toBe('i2')
    expect(u.at()).toBe(0)
  })

  it('keeps accumulating while the same item streams', () => {
    // The control. An `add` that reset on every call would pass the test above
    // and turn every utterance into a one-delta flicker.
    const u = createUtterance()
    for (const word of ['Hi, ', "I'm back, ", "how's everything going?"]) u.add(word, 'i1')
    expect(u.text()).toBe("Hi, I'm back, how's everything going?")
  })

  it('ignores an ending that belongs to some other item', () => {
    const u = createUtterance()
    u.add('still going', 'i1')
    u.speaks('i1')
    seconds(u, 1, 0)
    u.finished('i0', false)
    seconds(u, 1, 0)
    expect(u.at()).toBeGreaterThan(0)
  })
})

describe('the learned rate belongs to the voice', () => {
  it('survives a new utterance of the SAME voice', () => {
    // One voice's speed is stable, so the calibration carries — that is the
    // whole reason `Pacer.restart()` preserves it.
    const u = createUtterance()
    u.add('x'.repeat(900), 'i1')
    u.speaks('i1')
    seconds(u, 10, 0)
    u.finished('i1', false) // a natural end: it learns here
    const learned = u.at()
    expect(learned).toBeGreaterThan(0)

    u.add('x'.repeat(900), 'i2')
    u.speaks('i2')
    seconds(u, 2, 0)
    const fast = u.at()

    // A fresh utterance of a voice known to be fast covers more ground in two
    // seconds than the seed would.
    const seed = createUtterance()
    seed.add('x'.repeat(900), 'j1')
    seed.speaks('j1')
    seconds(seed, 2, 0)
    expect(fast).toBeGreaterThan(seed.at())
  })

  it('is DROPPED when a different character is worn', () => {
    // A persona change is a voice change, and §60's seed was measured on
    // `alloy`, which this app never speaks with. Carrying one voice's rate into
    // another is not a small error.
    const u = createUtterance()
    u.add('x'.repeat(900), 'i1')
    u.speaks('i1')
    seconds(u, 10, 0)
    u.finished('i1', false)

    u.wear()
    u.add('x'.repeat(900), 'i2')
    u.speaks('i2')
    seconds(u, 2, 0)

    const seed = createUtterance()
    seed.add('x'.repeat(900), 'j1')
    seed.speaks('j1')
    seconds(seed, 2, 0)
    expect(u.at()).toBe(seed.at())
  })

  it('forgets the utterance on the screen when the character changes', () => {
    const u = createUtterance()
    u.add('the last character said this', 'i1')
    u.wear()
    expect(u.text()).toBe('')
    expect(u.itemId()).toBeNull()
  })
})
