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

describe('what it draws', () => {
  it('draws nothing before she has said anything', () => {
    const bubble = createBubble()
    const { ctx, drawn } = recorder()
    expect(bubble.draw(ctx, 320, COLOURS)).toBe(false)
    expect(drawn).toEqual([])
  })

  it('shows the fragments as they arrive', () => {
    const bubble = createBubble()
    bubble.add('hello ', 'r1')
    bubble.add('there', 'r1')
    const { ctx, drawn } = recorder()

    expect(bubble.draw(ctx, 320, COLOURS)).toBe(true)
    expect(drawn.join('')).toContain('hello there')
  })

  it('paints an opaque surface under the words', () => {
    // Rule 2 of the design: anything carrying words gets its own opaque
    // surface, because she may sit on anything — a photograph included. A
    // translucent bubble has no contrast ratio at all, because there is no
    // telling what is behind it.
    const bubble = createBubble()
    bubble.add('words', 'r1')
    const { ctx, filled } = recorder()
    bubble.draw(ctx, 320, COLOURS)
    expect(filled).toContain(COLOURS.paper)
  })

  it('wraps by measurement, not by counting characters', () => {
    // The text is routinely CJK, where one character is roughly twice the width
    // of a Latin one. A count-based wrap is wrong in one direction or the other,
    // and this recorder charges per character precisely so a count-based
    // implementation would still pass — the assertion is on the measured width.
    const bubble = createBubble()
    bubble.add('a'.repeat(120), 'r1')
    const { ctx, drawn } = recorder()
    bubble.draw(ctx, 320, COLOURS)

    expect(drawn.length).toBeGreaterThan(1)
    for (const line of drawn) expect(line.length * 7).toBeLessThanOrEqual(320 - 40)
  })
})

describe('when it goes away', () => {
  it('stays while she is still making sound, however long the wire has been quiet', () => {
    // THE rule. The design says: fade 1.2s after the ANALYSER reports her audio
    // ended, not after the data channel says the response is done — the wire is
    // early. §19 later found the gap is not even a constant, which makes this
    // more necessary rather than less.
    const bubble = createBubble()
    bubble.add('a long sentence she is still speaking', 'r1')

    // Ten seconds of frames, with the analyser reporting sound the whole time.
    for (let i = 0; i < 600; i += 1) bubble.step(0, 1 / 60)

    const { ctx } = recorder()
    expect(bubble.draw(ctx, 320, COLOURS)).toBe(true)
  })

  it('goes only after the sound has been gone for the designed interval', () => {
    const bubble = createBubble()
    bubble.add('done speaking now', 'r1')

    // Quiet, but not yet long enough.
    bubble.step(FADE_AFTER_QUIET_S - 0.1, 1 / 60)
    const early = recorder()
    expect(bubble.draw(early.ctx, 320, COLOURS)).toBe(true)

    // Past the threshold, and long enough for the fade itself to finish.
    for (let i = 0; i < 120; i += 1) bubble.step(FADE_AFTER_QUIET_S + 1, 1 / 60)
    const late = recorder()
    expect(bubble.draw(late.ctx, 320, COLOURS)).toBe(false)
  })

  it('comes back when she starts again', () => {
    const bubble = createBubble()
    bubble.add('first', 'r1')
    bubble.step(0, 1 / 60) // she sounds, so there is something to be finished with
    for (let i = 0; i < 120; i += 1) bubble.step(FADE_AFTER_QUIET_S + 1, 1 / 60)
    expect(bubble.draw(recorder().ctx, 320, COLOURS)).toBe(false)

    bubble.add('second', 'r1')
    const back = recorder()
    expect(bubble.draw(back.ctx, 320, COLOURS)).toBe(true)
    // And the old utterance did not come back with it.
    expect(back.drawn.join('')).not.toContain('first')
  })

  it('does not fade in the window before her audio has started', () => {
    // §56: the first delta lands 0–320ms ahead of `output_audio_buffer.started`,
    // so there is a window where the text is on screen and the analyser still
    // reports a long silence — the silence BEFORE her, not a pause in her.
    //
    // Asserted on the alpha rather than on visibility, because a partial fade
    // still draws: shipped, this reached the desktop at alpha 0.24 while
    // `draw()` returned true throughout. A visibility assertion would have been
    // green for the whole bug.
    const bubble = createBubble()
    bubble.add("Hi, I'm back", 'r1')
    for (let i = 0; i < 30; i += 1) bubble.step(9, 1 / 60)

    const { ctx, raw } = recorder()
    expect(bubble.draw(ctx, 320, COLOURS)).toBe(true)
    expect(raw.globalAlpha).toBe(1)
  })

  it('still fades once she has actually sounded and then stopped', () => {
    // The control for the test above: the wait-for-sound rule must not become
    // "never fade". Identical frames, with one sounding frame in front of them.
    //
    // Stopped PART way through the fade on purpose. Run to completion, `draw`
    // returns early on the emptied text and never writes an alpha at all — so
    // the assertion would read the recorder's initial 1 and pass against a
    // bubble that had faded, which is the opposite of what it claims to check.
    const bubble = createBubble()
    bubble.add("Hi, I'm back", 'r1')
    bubble.step(0, 1 / 60)
    for (let i = 0; i < 10; i += 1) bubble.step(9, 1 / 60)

    const { ctx, raw } = recorder()
    expect(bubble.draw(ctx, 320, COLOURS)).toBe(true)
    expect(raw.globalAlpha).toBeLessThan(1)
  })

  it('forgets the last utterance when the bubble is turned off', () => {
    // Otherwise wearing a character without a bubble, then one with it, shows
    // the previous character's last sentence.
    const bubble = createBubble()
    bubble.add('what she said before', 'r1')
    bubble.clear()

    const { ctx, drawn } = recorder()
    expect(bubble.draw(ctx, 320, COLOURS)).toBe(false)
    expect(drawn).toEqual([])
  })

  it('drops the last utterance when a NEW response id arrives', () => {
    // The boundary comes from the text stream, not from her audio. §56 measured
    // the first delta landing 0–320ms before `output_audio_buffer.started` in
    // 6 of 6 responses — enough for a whole one-word reply — so a boundary taken
    // from audio-start discards the opening words. (§19 is a DIFFERENT pair:
    // the two endings. It was briefly miscited here for exactly this.)
    const bubble = createBubble()
    bubble.add('previous', 'r1')
    bubble.add('current', 'r2')
    const { ctx, drawn } = recorder()
    bubble.draw(ctx, 320, COLOURS)
    expect(drawn.join('')).toContain('current')
    expect(drawn.join('')).not.toContain('previous')
  })

  it('does NOT drop the utterance when the same id keeps streaming', () => {
    // The control for the test above. Without it, an `add` that cleared on
    // every call would pass that one — it shows only the newest fragment either
    // way — and the bubble would be a one-delta flicker rather than a sentence.
    const bubble = createBubble()
    for (const [word, id] of [
      ['Hi, ', 'r1'],
      ["I'm back, ", 'r1'],
      ["how's everything going?", 'r1'],
    ] as const) {
      bubble.add(word, id)
    }
    const { ctx, drawn } = recorder()
    bubble.draw(ctx, 320, COLOURS)
    expect(drawn.join('')).toContain("Hi, I'm back, how's everything going?")
  })

  it('keeps only the tail of something very long', () => {
    // A bubble is a glance, not a transcript. Unbounded growth here is a window
    // that fills with text and never empties.
    const bubble = createBubble()
    for (let i = 0; i < 200; i += 1) bubble.add('word ', 'r1')
    const { ctx, drawn } = recorder()
    bubble.draw(ctx, 320, COLOURS)
    expect(drawn.join('').length).toBeLessThan(300)
  })
})
