import { describe, expect, it } from 'vitest'
import { createBubble, FADE_AFTER_QUIET_S } from './bubble'

/** A context that records rather than paints. Nothing here needs pixels. */
function recorder() {
  const filled: string[] = []
  const drawn: string[] = []
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    roundRect() {},
    fill() {
      filled.push(String(ctx.fillStyle))
    },
    fillText(text: string) {
      drawn.push(text)
    },
    measureText: (text: string) => ({ width: text.length * 7 }),
    font: '',
    textBaseline: '' as CanvasTextBaseline,
    fillStyle: '' as string,
    globalAlpha: 1,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, filled, drawn, raw: ctx }
}

const COLOURS = { paper: '#f4f2ea', ink: '#2b2c25' }

/** One second of frames at 60fps, with `quietFor` held at the given value. */
function seconds(bubble: ReturnType<typeof createBubble>, howMany: number, quietFor: number): void {
  for (let i = 0; i < howMany * 60; i += 1) bubble.step(quietFor, 1 / 60)
}

/** Everything currently on screen, joined. */
function shown(bubble: ReturnType<typeof createBubble>): string {
  const { ctx, drawn } = recorder()
  bubble.draw(ctx, 320, COLOURS)
  return drawn.join('')
}

describe('what it draws', () => {
  it('draws nothing before she has said anything', () => {
    const bubble = createBubble()
    const { ctx, drawn } = recorder()
    expect(bubble.draw(ctx, 320, COLOURS)).toBe(false)
    expect(drawn).toEqual([])
  })

  it('paints an opaque surface under the words', () => {
    // Rule 2 of the design: anything carrying words gets its own opaque
    // surface, because she may sit on anything — a photograph included. A
    // translucent bubble has no contrast ratio at all, because there is no
    // telling what is behind it.
    const bubble = createBubble()
    bubble.add('words and more words', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 1, 0)

    const { ctx, filled, raw } = recorder()
    expect(bubble.draw(ctx, 320, COLOURS)).toBe(true)
    expect(filled).toContain(COLOURS.paper)
    expect(raw.globalAlpha).toBe(1)
  })
})

describe('it appears when she speaks, not when the text arrives', () => {
  it('shows nothing while the text has arrived but her audio has not started', () => {
    // §56: the text lands ahead of `output_audio_buffer.started`. A bubble that
    // appears on arrival appears during the silence BEFORE her — reported as
    // "it flashed while it was not speaking".
    const bubble = createBubble()
    bubble.add('Once upon a time there was a small green mochi.', 'r1')
    seconds(bubble, 3, 0) // sound in the room, but not hers for this response

    const { ctx, drawn } = recorder()
    expect(bubble.draw(ctx, 320, COLOURS)).toBe(false)
    expect(drawn).toEqual([])
  })

  it('appears once her audio for THAT response begins', () => {
    const bubble = createBubble()
    bubble.add('Once upon a time there was a small green mochi.', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 1, 0)

    expect(shown(bubble)).toContain('Once upon')
  })

  it('does not let the PREVIOUS utterance’s audio drive this one', () => {
    // The reported bug, exactly. She answered in two responses: the second's
    // text arrived while the first was still playing, the gap between them read
    // as "she has gone quiet", and the bubble faded and emptied — so it was
    // gone for the whole minute she then spent reading the story.
    const bubble = createBubble()
    bubble.add('the long story begins here and continues for some time', 'r2')

    // r1 is still sounding. None of this is r2's.
    seconds(bubble, 4, 0)
    expect(shown(bubble)).toBe('')

    // The gap between r1 finishing and r2 starting.
    seconds(bubble, 2, 5)
    expect(shown(bubble)).toBe('')

    // Now r2's own audio starts — and the story is still all there, from its
    // beginning. Two seconds, because the reveal is paced: one buys about
    // fifteen characters (§57), which is `the long story `.
    bubble.speaks('r2')
    seconds(bubble, 2, 0)
    expect(shown(bubble)).toContain('the long story begins')
  })
})

describe('it is paced by her voice, not by the wire', () => {
  it('reveals gradually rather than all at once', () => {
    // §57: a 1101-character story is in hand within seconds and takes 72.7s to
    // read. Shown on arrival, the bubble displays the last paragraph for the
    // whole two minutes she spends on the first.
    const story = 'a'.repeat(1200)
    const bubble = createBubble()
    bubble.add(story, 'r1')
    bubble.speaks('r1')

    seconds(bubble, 2, 0)
    const early = shown(bubble).length
    seconds(bubble, 2, 0)
    const later = shown(bubble).length

    // Something, but nowhere near all of it — at ~15 chars/s, two seconds is
    // about thirty characters, not twelve hundred.
    expect(early).toBeGreaterThan(10)
    expect(early).toBeLessThan(60)
    expect(later).toBeGreaterThan(early)
  })

  it('reveals Chinese far more slowly per glyph, because she speaks it so', () => {
    // §57 measured 4.1 chars/s against 15.1 — the same mouth, a third of the
    // characters. Asserted as a RATIO so it tests the script-awareness rather
    // than restating the two constants back to themselves.
    const latin = createBubble()
    latin.add('x'.repeat(400), 'r1')
    latin.speaks('r1')
    seconds(latin, 4, 0)

    const chinese = createBubble()
    chinese.add('字'.repeat(400), 'r1')
    chinese.speaks('r1')
    seconds(chinese, 4, 0)

    const ratio = shown(latin).length / shown(chinese).length
    expect(ratio).toBeGreaterThan(2.5)
    expect(ratio).toBeLessThan(5)
  })

  it('never runs past the end of what she has actually generated', () => {
    const bubble = createBubble()
    bubble.add('short.', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 30, 0)
    expect(shown(bubble)).toBe('short.')
  })
})

describe('when it goes away, and when it comes back', () => {
  it('stays while she is still making sound', () => {
    // THE design rule: fade 1.2s after the ANALYSER reports her audio ended,
    // not after the data channel says the response is done — the wire is early,
    // and §19 found the lead is not even a constant.
    const bubble = createBubble()
    bubble.add('a long sentence she is still speaking', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 10, 0)

    const { ctx } = recorder()
    expect(bubble.draw(ctx, 320, COLOURS)).toBe(true)
  })

  it('goes only after the sound has been gone for the designed interval', () => {
    const bubble = createBubble()
    bubble.add('done speaking now', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 2, 0)

    bubble.step(FADE_AFTER_QUIET_S - 0.1, 1 / 60)
    expect(shown(bubble)).not.toBe('')

    seconds(bubble, 2, FADE_AFTER_QUIET_S + 1)
    expect(shown(bubble)).toBe('')
  })

  it('comes back after a pause instead of losing the sentence', () => {
    // The fade must not destroy the text. A pause between two sentences of one
    // utterance is a pause, and emptying on it is what left the bubble unable
    // to return for the rest of a two-minute story.
    const bubble = createBubble()
    bubble.add('the first half and then the second half of one long thought', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 2, 0)
    const before = shown(bubble)
    expect(before).not.toBe('')

    seconds(bubble, 2, FADE_AFTER_QUIET_S + 1) // she pauses; it fades out
    expect(shown(bubble)).toBe('')

    seconds(bubble, 1, 0) // she resumes
    expect(shown(bubble)).toContain(before)
  })

  it('drops the last utterance when a NEW response id arrives', () => {
    // The boundary comes from the text stream, not from her audio. §56 measured
    // the first delta landing 0–320ms before `output_audio_buffer.started` in
    // 6 of 6 responses — enough for a whole one-word reply — so a boundary taken
    // from audio-start discards the opening words. (§19 is a DIFFERENT pair:
    // the two endings. It was briefly miscited here for exactly this.)
    const bubble = createBubble()
    bubble.add('what she said before', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 2, 0)
    expect(shown(bubble)).toContain('what she said')

    bubble.add('what she says now', 'r2')
    bubble.speaks('r2')
    seconds(bubble, 2, 0)
    const now = shown(bubble)
    expect(now).toContain('what she says now')
    expect(now).not.toContain('before')
  })

  it('does NOT drop the utterance when the same id keeps streaming', () => {
    // The control for the test above. Without it, an `add` that cleared on
    // every call would pass that one — it shows only the newest fragment either
    // way — and the bubble would be a one-delta flicker rather than a sentence.
    const bubble = createBubble()
    for (const word of ['Hi, ', "I'm back, ", "how's everything going?"]) {
      bubble.add(word, 'r1')
    }
    bubble.speaks('r1')
    seconds(bubble, 4, 0)
    expect(shown(bubble)).toContain("Hi, I'm back, how's everything going?")
  })

  it('forgets the last utterance when the bubble is turned off', () => {
    // Otherwise wearing a character without a bubble, then one with it, shows
    // the previous character's last sentence.
    const bubble = createBubble()
    bubble.add('what she said before', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 2, 0)
    bubble.clear()

    const { ctx, drawn } = recorder()
    expect(bubble.draw(ctx, 320, COLOURS)).toBe(false)
    expect(drawn).toEqual([])
  })
})

describe('what fits on screen', () => {
  it('keeps only the tail of something very long', () => {
    // A bubble is a glance, not a transcript. Unbounded growth here is a window
    // that fills with text and never empties.
    const bubble = createBubble()
    bubble.add('word '.repeat(400), 'r1')
    bubble.speaks('r1')
    seconds(bubble, 300, 0)
    expect(shown(bubble).length).toBeLessThan(300)
  })

  it('wraps by measurement, not by counting characters', () => {
    // The recorder charges per character precisely so a count-based
    // implementation would still pass — the assertion is on the measured width.
    const bubble = createBubble()
    bubble.add('a'.repeat(120), 'r1')
    bubble.speaks('r1')
    seconds(bubble, 20, 0)

    const { ctx, drawn } = recorder()
    bubble.draw(ctx, 320, COLOURS)
    expect(drawn.length).toBeGreaterThan(1)
    for (const line of drawn) expect(line.length * 7).toBeLessThanOrEqual(320 - 40)
  })
})
