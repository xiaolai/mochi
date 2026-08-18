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

/** `howMany` seconds of 60fps frames, with `quietFor` held. `begun` is the
 *  utterance's answer to "has THIS response's audio started", not a clock's. */
function seconds(
  bubble: ReturnType<typeof createBubble>,
  howMany: number,
  quietFor: number,
  begun = true,
): void {
  for (let i = 0; i < howMany * 60; i += 1) bubble.step(quietFor, 1 / 60, begun)
}

function paint(bubble: ReturnType<typeof createBubble>, said: string, at: number) {
  const rec = recorder()
  const painted = bubble.draw(rec.ctx, 320, COLOURS, said, at)
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

const LINE = 'one two three four five six seven eight nine ten'

describe('it appears only once her audio has begun', () => {
  it('draws nothing while the text has arrived but her audio has not started', () => {
    // §56: the text lands ahead of `output_audio_buffer.started`. A bubble that
    // appears on arrival appears during the silence BEFORE her — reported as
    // "it flashed while it was not speaking".
    const bubble = createBubble()
    seconds(bubble, 3, 0, /* begun */ false)
    expect(paint(bubble, LINE, 4).painted).toBe(false)
  })

  it('appears once it has', () => {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    const { painted, filled, text } = paint(bubble, LINE, 4)
    expect(painted).toBe(true)
    expect(filled).toContain(COLOURS.paper)
    expect(text).toContain('one two')
  })
})

describe('what she has not said yet', () => {
  it('is on screen from the start, not hidden', () => {
    // The point. Where she is can only be estimated (`pace.ts`), and hiding the
    // future turns estimate error into missing words — a reader cannot catch up
    // to text that is not there.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    expect(paint(bubble, LINE, 4).text).toContain('ten')
  })

  it('is dimmer than what she has said', () => {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    const alphas = paint(bubble, LINE, 20).drawn.map((one) => one.alpha)
    expect(Math.min(...alphas)).toBeLessThan(Math.max(...alphas))
  })

  it('underlines the word the cursor is on', () => {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    expect(paint(bubble, LINE, 20).rules.length).toBeGreaterThan(0)
  })

  it('underlines the first word from the very start', () => {
    // Rather than waiting for the cursor to leave zero, which would leave the
    // opening word of every utterance unmarked while she says it.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    expect(paint(bubble, LINE, 0).rules.length).toBeGreaterThan(0)
  })

  it('moves the underline along as the cursor advances', () => {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    const early = paint(bubble, LINE, 4).drawn.find((one) => one.alpha === 1)?.text ?? ''
    const later = paint(bubble, LINE, 24).drawn.find((one) => one.alpha === 1)?.text ?? ''
    expect(later.length).toBeGreaterThan(early.length)
  })
})

describe('when it goes away, and when it comes back', () => {
  it('stays while she is still making sound', () => {
    const bubble = createBubble()
    seconds(bubble, 10, 0)
    expect(paint(bubble, LINE, 10).painted).toBe(true)
  })

  it('goes only after the sound has been gone for the designed interval', () => {
    // THE design rule: fade 1.2s after the ANALYSER reports her audio ended,
    // not after the data channel says the response is done — the wire is early,
    // and §19 found the lead is not even a constant.
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    bubble.step(FADE_AFTER_QUIET_S - 0.1, 1 / 60, true)
    expect(paint(bubble, LINE, 10).painted).toBe(true)

    seconds(bubble, 2, FADE_AFTER_QUIET_S + 1)
    expect(paint(bubble, LINE, 10).painted).toBe(false)
  })

  it('comes back after a pause instead of staying gone', () => {
    // The fade must not be one-way. A pause between two sentences of one
    // utterance is a pause, and treating it as the end is what left the bubble
    // unable to return for the rest of a two-minute story.
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    seconds(bubble, 2, FADE_AFTER_QUIET_S + 1)
    expect(paint(bubble, LINE, 10).painted).toBe(false)
    seconds(bubble, 1, 0)
    expect(paint(bubble, LINE, 10).painted).toBe(true)
  })

  it('still fades out after the utterance has ended', () => {
    // Regression, and it shipped: the fade was gated on the utterance still
    // being live, so opacity froze wherever it stood — a half-transparent
    // bubble parked on the desktop with nothing left to move it.
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    seconds(bubble, 3, FADE_AFTER_QUIET_S + 1, /* begun, but no longer speaking */ true)
    expect(paint(bubble, LINE, 10).painted).toBe(false)
  })

  it('forgets its fade when the bubble is turned off', () => {
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    bubble.clear()
    expect(paint(bubble, LINE, 10).painted).toBe(false)
  })
})

describe('what fits on screen', () => {
  it('keeps only a window of something very long', () => {
    // A bubble is a glance, not a transcript.
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    const long = 'word '.repeat(400)
    expect(paint(bubble, long, 1800).text.length).toBeLessThan(300)
  })

  it('keeps her own line in view when the passage is taller than the bubble', () => {
    // Regression, and it shipped. Showing "the last four lines" is not the same
    // as showing HER four lines: a passage with a paragraph break wraps past
    // four, and the last four are then entirely ahead of the cursor.
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    const passage =
      'first line of the story here\n\nsecond paragraph begins\n\nthird one\n\nfourth\n\nfifth'
    const { drawn, rules } = paint(bubble, passage, 10)
    expect(drawn.some((one) => one.alpha === 1)).toBe(true)
    expect(rules.length).toBeGreaterThan(0)
  })

  it('wraps by measurement, not by counting characters', () => {
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    expect(paint(bubble, 'a '.repeat(80), 100).drawn.length).toBeGreaterThan(1)
  })
})
