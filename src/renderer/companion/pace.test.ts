import { describe, expect, it } from 'vitest'
import { createPacer, wordAt } from './pace'

/** `howLong` seconds of 60fps frames, with the analyser's answer held. */
function play(pacer: ReturnType<typeof createPacer>, howLong: number, sounding = true): void {
  for (let i = 0; i < howLong * 60; i += 1) pacer.step(1 / 60, sounding)
}

describe('the cursor', () => {
  it('does not move before her audio has started', () => {
    // The text arrives first — §56 — so a cursor that moved on arrival would be
    // partway through a sentence she has not begun.
    const pacer = createPacer()
    pacer.wrote('she has not started speaking yet')
    play(pacer, 3)
    expect(pacer.at()).toBe(0)
  })

  it('moves while she sounds', () => {
    const pacer = createPacer()
    pacer.wrote('x'.repeat(400))
    pacer.began()
    play(pacer, 2)
    expect(pacer.at()).toBeGreaterThan(10)
    expect(pacer.at()).toBeLessThan(60)
  })

  it('does NOT move through a pause', () => {
    // The single biggest source of drift. At a flat wall-clock rate, two seconds
    // between paragraphs runs the cursor thirty characters into unsaid text —
    // and the error is permanent, because nothing later pulls it back.
    const pacer = createPacer()
    pacer.wrote('x'.repeat(400))
    pacer.began()
    play(pacer, 2)
    const before = pacer.at()
    play(pacer, 5, false)
    expect(pacer.at()).toBe(before)
  })

  it('never runs past what has been generated', () => {
    const pacer = createPacer()
    pacer.wrote('short')
    pacer.began()
    play(pacer, 60)
    expect(pacer.at()).toBe('short'.length)
  })

  it('moves through Chinese far more slowly, per glyph', () => {
    const latin = createPacer()
    latin.wrote('x'.repeat(400))
    latin.began()
    play(latin, 4)

    const chinese = createPacer()
    chinese.wrote('字'.repeat(400))
    chinese.began()
    play(chinese, 4)

    const ratio = latin.at() / chinese.at()
    expect(ratio).toBeGreaterThan(2.5)
    expect(ratio).toBeLessThan(5)
  })
})

describe('learning the rate', () => {
  it('speeds up after an utterance it was too slow for', () => {
    // The whole point of closing the loop. §57's seed is a WALL-CLOCK rate and
    // this advances during SOUND, so the seed is guaranteed too slow — and
    // without learning it would stay too slow for ever.
    //
    // 600 characters over 10s of sound is 60/s. The seed reveals 151 of them,
    // so a version that learned from the CURSOR would measure 15.1 — its own
    // rate, handed back to it — and this assertion is what catches that.
    const pacer = createPacer()
    const before = pacer.rate()

    pacer.wrote('x'.repeat(600))
    pacer.began()
    play(pacer, 10)
    pacer.ended()

    expect(pacer.rate()).toBeGreaterThan(before)
  })

  it('learns nothing at all from an utterance she was cut off in', () => {
    // Barge-in is routine (§17). She said far less than was generated, so the
    // natural-end arithmetic would report an enormous rate and then run the
    // cursor to the end of every later sentence.
    const pacer = createPacer()
    const before = pacer.rate()
    pacer.wrote('x'.repeat(5000))
    pacer.began()
    play(pacer, 2)
    pacer.cut()
    expect(pacer.rate()).toBe(before)
  })

  it('keeps what it learned across the next utterance', () => {
    const pacer = createPacer()
    pacer.wrote('x'.repeat(600))
    pacer.began()
    play(pacer, 10)
    pacer.ended()
    const learned = pacer.rate()

    pacer.restart()
    expect(pacer.rate()).toBe(learned)
  })

  it('refuses to learn from an utterance that barely sounded', () => {
    // `ended()` divides by a measured duration. A duration near zero — cut off
    // at once, or a clock that jumped — yields an enormous rate that would then
    // run the cursor to the end of every later sentence.
    const pacer = createPacer()
    const before = pacer.rate()
    pacer.wrote('x'.repeat(600))
    pacer.began()
    play(pacer, 0.2)
    pacer.ended()
    expect(pacer.rate()).toBe(before)
  })

  it('clamps an absurd measurement instead of believing it', () => {
    const pacer = createPacer()
    pacer.wrote('x'.repeat(100_000))
    pacer.began()
    play(pacer, 0.6) // 100k characters in 0.6s of sound: not a speaking rate
    pacer.ended()
    expect(pacer.rate()).toBeLessThanOrEqual(60)
  })

  it('learns nothing from an end that never had a beginning', () => {
    const pacer = createPacer()
    const before = pacer.rate()
    pacer.wrote('x'.repeat(600))
    pacer.ended()
    expect(pacer.rate()).toBe(before)
  })
})

describe('which word to underline', () => {
  it('finds the word around an index', () => {
    const text = 'the little owl taps'
    expect(wordAt(text, 12)).toEqual({ from: 11, to: 14 })
    expect(text.slice(11, 14)).toBe('owl')
  })

  it('takes the whole word from anywhere inside it', () => {
    const text = 'brainstorm something'
    for (const at of [0, 4, 9]) expect(wordAt(text, at)).toEqual({ from: 0, to: 10 })
  })

  it('underlines ONE Chinese glyph, not the rest of the sentence', () => {
    // Chinese is not space-delimited, so "to the next space" would underline
    // everything to the end of the line.
    const text = '今天天气很好'
    expect(wordAt(text, 2)).toEqual({ from: 2, to: 3 })
  })

  it('stops at the boundary between scripts', () => {
    const text = '她说 hello 然后'
    expect(wordAt(text, 4)).toEqual({ from: 3, to: 8 })
    expect(text.slice(3, 8)).toBe('hello')
  })

  it('carries forward from a space to the word she is about to say', () => {
    // Not null. A space is ~70ms at her measured rate, and blinking the
    // underline off for that between every pair of words is a visible flicker.
    expect(wordAt('a b', 1)).toEqual({ from: 2, to: 3 })
    expect(wordAt('one   two', 3)).toEqual({ from: 6, to: 9 })
  })

  it('has nothing to underline past the last word', () => {
    expect(wordAt('trailing   ', 9)).toBeNull()
    expect(wordAt('', 0)).toBeNull()
    expect(wordAt('abc', -1)).toBeNull()
  })

  it('clamps rather than throwing past the end', () => {
    // The cursor is an estimate and the text can be replaced under it. Throwing
    // here would take the render loop down over an off-by-one.
    expect(wordAt('abc', 99)).toEqual({ from: 0, to: 3 })
  })
})

describe('measuring a response as it streams in', () => {
  /**
   * `wrote` walked the whole string on every call. Deltas arrive per token, so
   * an N-character response cost O(N²) glyph iterations — on the frame loop,
   * while she is speaking, where it shows up as her mouth stuttering rather
   * than as a number anybody profiles.
   */
  it('measures a streamed string the same as one written whole', () => {
    // The property that makes the fast path safe. If these ever disagree, the
    // incremental branch is wrong and the mouth is paced by a different number
    // depending on how the text arrived.
    const streamed = createPacer()
    const whole = createPacer()
    const parts = ['Hello', ' there', ', how', ' are you', ' today?']
    let sofar = ''
    for (const part of parts) {
      sofar += part
      streamed.wrote(sofar)
    }
    whole.wrote(sofar)
    streamed.began()
    whole.began()
    play(streamed, 1)
    play(whole, 1)
    expect(streamed.at()).toBe(whole.at())
  })

  it('recomputes when the string is not an extension', () => {
    // A rewrite, a shorter string, a new response: the fast path must not
    // assume the prefix survived.
    const pacer = createPacer()
    pacer.wrote('the first answer entirely')
    pacer.wrote('short')
    const fresh = createPacer()
    fresh.wrote('short')
    pacer.began()
    fresh.began()
    play(pacer, 1)
    play(fresh, 1)
    expect(pacer.at()).toBe(fresh.at())
  })

  it('handles an empty extension without losing the measurement', () => {
    const pacer = createPacer()
    pacer.wrote('some words')
    pacer.wrote('some words')
    const fresh = createPacer()
    fresh.wrote('some words')
    pacer.began()
    fresh.began()
    play(pacer, 1)
    play(fresh, 1)
    expect(pacer.at()).toBe(fresh.at())
  })
})
