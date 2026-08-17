import { describe, expect, it } from 'vitest'
import { createBubble, runsFor, FADE_AFTER_QUIET_S } from './bubble'

/** A context that records rather than paints. Nothing here needs pixels. */
function recorder() {
  const filled: string[] = []
  const drawn: { text: string; alpha: number }[] = []
  const rules: number[] = []
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    roundRect() {},
    fill() {
      filled.push(String(ctx.fillStyle))
    },
    fillText(text: string) {
      drawn.push({ text, alpha: ctx.globalAlpha })
    },
    fillRect(_x: number, _y: number, w: number) {
      // The underline. Its width is the assertion that a word was marked.
      rules.push(w)
    },
    measureText: (text: string) => ({ width: text.length * 7 }),
    font: '',
    textBaseline: '' as CanvasTextBaseline,
    fillStyle: '' as string,
    globalAlpha: 1,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, filled, drawn, rules, raw: ctx }
}

const COLOURS = { paper: '#f4f2ea', ink: '#2b2c25' }

/** `howMany` seconds of 60fps frames, with `quietFor` held. */
function seconds(bubble: ReturnType<typeof createBubble>, howMany: number, quietFor: number): void {
  for (let i = 0; i < howMany * 60; i += 1) bubble.step(quietFor, 1 / 60)
}

function paint(bubble: ReturnType<typeof createBubble>) {
  const rec = recorder()
  const painted = bubble.draw(rec.ctx, 320, COLOURS)
  return { ...rec, painted, text: rec.drawn.map((one) => one.text).join('') }
}

describe('cutting a line into runs', () => {
  it('splits at the word being said', () => {
    expect(runsFor('the owl taps', 0, 4, 7)).toEqual([
      { text: 'the ', style: 'said' },
      { text: 'owl', style: 'saying' },
      { text: ' taps', style: 'ahead' },
    ])
  })

  it('is all still-to-come when the cursor is before the line', () => {
    expect(runsFor('later text', 100, 4, 7)).toEqual([{ text: 'later text', style: 'ahead' }])
  })

  it('is all said when the cursor is past the line', () => {
    expect(runsFor('earlier text', 0, 900, 903)).toEqual([{ text: 'earlier text', style: 'said' }])
  })

  it('handles a word straddling the start of the line', () => {
    // The wrap can put a break anywhere; the underlined word does not have to
    // begin on the line it is being drawn on.
    expect(runsFor('owl taps', 4, 2, 7)).toEqual([
      { text: 'owl', style: 'saying' },
      { text: ' taps', style: 'ahead' },
    ])
  })

  it('never loses or duplicates a character', () => {
    for (const [from, to] of [
      [0, 0],
      [3, 3],
      [0, 12],
      [-5, 2],
      [8, 99],
    ] as const) {
      expect(
        runsFor('the owl taps', 0, from, to)
          .map((one) => one.text)
          .join(''),
      ).toBe('the owl taps')
    }
  })
})

describe('it appears when she speaks, not when the text arrives', () => {
  it('shows nothing while the text has arrived but her audio has not started', () => {
    // §56: the text lands ahead of `output_audio_buffer.started`. A bubble that
    // appears on arrival appears during the silence BEFORE her — reported as
    // "it flashed while it was not speaking".
    const bubble = createBubble()
    bubble.add('Once upon a time there was a small green mochi.', 'r1')
    seconds(bubble, 3, 0)
    expect(paint(bubble).painted).toBe(false)
  })

  it('appears once her audio for THAT response begins', () => {
    const bubble = createBubble()
    bubble.add('Once upon a time.', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 1, 0)

    const { painted, filled, text } = paint(bubble)
    expect(painted).toBe(true)
    expect(filled).toContain(COLOURS.paper)
    expect(text).toContain('Once upon a time.')
  })

  it('does not let the PREVIOUS utterance’s audio drive this one', () => {
    // The reported bug. She answered in two responses: the second's text
    // arrived while the first was still playing, the gap between them read as
    // "she has gone quiet", and the bubble faded and emptied — so it was gone
    // for the whole minute she then spent reading the story.
    const bubble = createBubble()
    bubble.add('the long story begins here', 'r2')
    seconds(bubble, 4, 0) // r1 still sounding; none of it is r2's
    expect(paint(bubble).painted).toBe(false)
    seconds(bubble, 2, 5) // the gap between them
    expect(paint(bubble).painted).toBe(false)

    bubble.speaks('r2')
    seconds(bubble, 1, 0)
    expect(paint(bubble).text).toContain('the long story begins here')
  })
})

describe('what she has not said yet', () => {
  it('is on screen from the start, not hidden', () => {
    // The point. Where she is can only be estimated (`pace.ts`), and hiding the
    // future turns estimate error into missing words — a reader cannot catch up
    // to text that is not there.
    const bubble = createBubble()
    bubble.add('one two three four five six seven eight', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 0.5, 0)

    const { text } = paint(bubble)
    expect(text).toContain('eight')
  })

  it('is dimmer than what she has said', () => {
    const bubble = createBubble()
    bubble.add('one two three four five six seven eight nine ten', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 1, 0)

    const { drawn } = paint(bubble)
    const alphas = drawn.map((one) => one.alpha)
    expect(Math.min(...alphas)).toBeLessThan(Math.max(...alphas))
  })

  it('underlines the word she is on', () => {
    const bubble = createBubble()
    bubble.add('one two three four five six seven eight nine ten', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 1, 0)
    expect(paint(bubble).rules.length).toBeGreaterThan(0)
  })

  it('underlines the first word from the moment she starts', () => {
    // Rather than waiting for the cursor to leave zero, which would leave the
    // opening word of every utterance unmarked while she says it.
    const bubble = createBubble()
    bubble.add('one two three', 'r1')
    bubble.speaks('r1')
    bubble.step(0, 1 / 60)
    expect(paint(bubble).rules.length).toBeGreaterThan(0)
  })

  it('moves the underline along as she speaks', () => {
    const bubble = createBubble()
    bubble.add('alpha bravo charlie delta echo foxtrot golf hotel india', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 1, 0)
    const early = paint(bubble).drawn.find((one) => one.alpha === 1)?.text ?? ''
    seconds(bubble, 2, 0)
    const later = paint(bubble).drawn.find((one) => one.alpha === 1)?.text ?? ''
    expect(later.length).toBeGreaterThan(early.length)
  })
})

describe('when it goes away, and when it comes back', () => {
  it('stays while she is still making sound', () => {
    const bubble = createBubble()
    bubble.add('a long sentence she is still speaking', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 10, 0)
    expect(paint(bubble).painted).toBe(true)
  })

  it('goes only after the sound has been gone for the designed interval', () => {
    // THE design rule: fade 1.2s after the ANALYSER reports her audio ended,
    // not after the data channel says the response is done — the wire is early,
    // and §19 found the lead is not even a constant.
    const bubble = createBubble()
    bubble.add('done speaking now', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 2, 0)

    bubble.step(FADE_AFTER_QUIET_S - 0.1, 1 / 60)
    expect(paint(bubble).painted).toBe(true)

    seconds(bubble, 2, FADE_AFTER_QUIET_S + 1)
    expect(paint(bubble).painted).toBe(false)
  })

  it('comes back after a pause instead of losing the sentence', () => {
    // The fade must not destroy the text. A pause between two sentences of one
    // utterance is a pause, and emptying on it is what left the bubble unable
    // to return for the rest of a two-minute story.
    const bubble = createBubble()
    bubble.add('the first half and then the second half of one long thought', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 2, 0)
    expect(paint(bubble).painted).toBe(true)

    seconds(bubble, 2, FADE_AFTER_QUIET_S + 1)
    expect(paint(bubble).painted).toBe(false)

    seconds(bubble, 1, 0)
    expect(paint(bubble).text).toContain('the first half')
  })

  it('drops the last utterance when a NEW response id arrives', () => {
    const bubble = createBubble()
    bubble.add('what she said before', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 2, 0)
    expect(paint(bubble).text).toContain('what she said before')

    bubble.add('what she says now', 'r2')
    bubble.speaks('r2')
    seconds(bubble, 2, 0)
    const now = paint(bubble).text
    expect(now).toContain('what she says now')
    expect(now).not.toContain('before')
  })

  it('does NOT drop the utterance when the same id keeps streaming', () => {
    // The control. An `add` that cleared on every call would pass the test
    // above — it shows only the newest fragment either way — and the bubble
    // would be a one-delta flicker rather than a sentence.
    const bubble = createBubble()
    for (const word of ['Hi, ', "I'm back, ", "how's everything going?"]) {
      bubble.add(word, 'r1')
    }
    bubble.speaks('r1')
    seconds(bubble, 1, 0)
    expect(paint(bubble).text).toContain("Hi, I'm back, how's everything going?")
  })

  it('forgets the last utterance when the bubble is turned off', () => {
    const bubble = createBubble()
    bubble.add('what she said before', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 2, 0)
    bubble.clear()
    expect(paint(bubble).painted).toBe(false)
  })

  it('still fades out AFTER the utterance has ended', () => {
    // Regression, and it shipped: the fade was gated on the utterance still
    // being live, so the moment `.stopped` arrived the opacity froze wherever
    // it happened to be — a half-transparent bubble parked on the desktop with
    // nothing left to move it. Caught on screen, not by this suite, which is
    // why the assertion is here now.
    const bubble = createBubble()
    bubble.add('all done now', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 2, 0)
    bubble.finished('r1', false)

    seconds(bubble, 3, FADE_AFTER_QUIET_S + 1)
    expect(paint(bubble).painted).toBe(false)
  })

  it('shows the whole utterance in full ink once she has finished it', () => {
    // A natural end is the one moment the true position is known: she said all
    // of it. Without taking that, the last clause stays dimmed while the bubble
    // fades out over it — the estimate's error made permanent at the one point
    // it did not have to be.
    const bubble = createBubble()
    bubble.add('a sentence rather longer than one second of speech would cover', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 1, 0)
    expect(paint(bubble).drawn.some((one) => one.alpha < 1)).toBe(true)

    bubble.finished('r1', false)
    bubble.step(0, 1 / 60)
    expect(paint(bubble).drawn.every((one) => one.alpha === 1)).toBe(true)
  })

  it('ignores an ending that belongs to some other utterance', () => {
    const bubble = createBubble()
    bubble.add('still going', 'r1')
    bubble.speaks('r1')
    seconds(bubble, 1, 0)
    bubble.finished('r0', false) // a straggler from the previous response
    seconds(bubble, 1, 0)
    expect(paint(bubble).painted).toBe(true)
  })
})

describe('what fits on screen', () => {
  it('keeps her own line in view when the passage is taller than the bubble', () => {
    // Regression, and it shipped. Showing "the last four lines" is not the same
    // as showing HER four lines: a passage with a paragraph break wraps past
    // four, and the last four are then entirely ahead of the cursor — every
    // word dimmed, no underline, for the length of a paragraph. Seen on screen.
    const bubble = createBubble()
    bubble.add(
      'first line of the story here\n\nsecond paragraph begins\n\nthird one\n\nfourth\n\nfifth',
      'r1',
    )
    bubble.speaks('r1')
    seconds(bubble, 1, 0)

    const { drawn, rules } = paint(bubble)
    // Something in full ink, and an underline somewhere: she is on screen.
    expect(drawn.some((one) => one.alpha === 1)).toBe(true)
    expect(rules.length).toBeGreaterThan(0)
  })

  it('keeps only a window of something very long', () => {
    // A bubble is a glance, not a transcript. Unbounded growth here is a window
    // that fills with text and never empties.
    const bubble = createBubble()
    bubble.add('word '.repeat(400), 'r1')
    bubble.speaks('r1')
    seconds(bubble, 60, 0)
    expect(paint(bubble).text.length).toBeLessThan(300)
  })

  it('wraps by measurement, not by counting characters', () => {
    // The recorder charges per character precisely so a count-based
    // implementation would still pass — the assertion is on the measured width.
    const bubble = createBubble()
    bubble.add('a '.repeat(80), 'r1')
    bubble.speaks('r1')
    seconds(bubble, 2, 0)

    const { drawn } = paint(bubble)
    expect(drawn.length).toBeGreaterThan(1)
  })
})
