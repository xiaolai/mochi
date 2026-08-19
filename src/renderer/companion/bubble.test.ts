import { describe, expect, it } from 'vitest'
import { createBubble, runsFor, FADE_AFTER_QUIET_S } from './bubble'

/** A context that records rather than paints. Nothing here needs pixels. */
function recorder() {
  const filled: string[] = []
  const strokes: string[] = []
  const arcs: string[] = []
  const rects: { x: number; y: number; w: number; h: number; alpha: number }[] = []
  const drawn: { text: string; alpha: number }[] = []
  const rules: number[] = []
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    // The tail is a path, not a rounded rect.
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      filled.push(String(ctx.fillStyle))
    },
    fillText(text: string) {
      drawn.push({ text, alpha: ctx.globalAlpha })
    },
    // The icons: Lucide artwork is stroked on a scaled grid, and the problem
    // badge is a pair of arcs.
    translate() {},
    scale() {},
    stroke(path?: unknown) {
      strokes.push(path === undefined ? 'rect' : 'path')
    },
    arc() {
      arcs.push(String(ctx.fillStyle))
    },
    // Rounded rects, so the reading rail can be told from the bubble's own box
    // by its width. Recorded with the alpha in force, which is what separates
    // the rail's track from its thumb.
    roundRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, alpha: ctx.globalAlpha })
    },
    strokeStyle: '' as string,
    lineWidth: 0,
    lineCap: '' as CanvasLineCap,
    lineJoin: '' as CanvasLineJoin,
    measureText: (text: string) => ({ width: text.length * 7 }),
    font: '',
    textBaseline: '' as CanvasTextBaseline,
    fillStyle: '' as string,
    globalAlpha: 1,
  }
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    filled,
    drawn,
    rules,
    strokes,
    arcs,
    rects,
    raw: ctx,
  }
}

const COLOURS = { paper: '#f4f1ea', ink: '#16170f', alarm: '#d1495b' }

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

/** Where she stands on her 980x560 canvas at size 100: centred, feet at 340. */
const HER = { left: 443, top: 267, width: 94, height: 73 }

/** The whole canvas on screen, which is the ordinary case. */
const ROOM = { left: 0, top: 0, right: 980, bottom: 560 }

function paint(
  bubble: ReturnType<typeof createBubble>,
  said: string,
  at: number,
  hovered = false,
  problems = 0,
) {
  const rec = recorder()
  const painted = bubble.draw(rec.ctx, 980, COLOURS, said, at, HER, ROOM, 'auto', hovered, problems)
  return { ...rec, painted, text: rec.drawn.map((one) => one.text).join('') }
}

describe('cutting a line into runs', () => {
  it('splits at where she has got to', () => {
    expect(runsFor('the owl taps', 0, 4)).toEqual([
      { text: 'the ', style: 'said' },
      { text: 'owl taps', style: 'ahead' },
    ])
  })

  it('is all still-to-come when the cursor is before the line', () => {
    expect(runsFor('later text', 100, 4)).toEqual([{ text: 'later text', style: 'ahead' }])
  })

  it('is all said when the cursor is past the line', () => {
    expect(runsFor('earlier text', 0, 900)).toEqual([{ text: 'earlier text', style: 'said' }])
  })

  it('handles a boundary that falls before the line begins', () => {
    // The wrap can put a break anywhere; the boundary does not have to fall on
    // the line being drawn.
    expect(runsFor('owl taps', 4, 2)).toEqual([{ text: 'owl taps', style: 'ahead' }])
  })

  it('never loses or duplicates a character', () => {
    for (const at of [0, 3, 12, -5, 99]) {
      expect(
        runsFor('the owl taps', 0, at)
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

  it('underlines nothing at all', () => {
    // An underline claims WORD-level precision. §60 measured this cursor at
    // −3% to −22%, so the ink boundary — which claims only "about here" — is
    // the strongest thing the estimate can honestly say.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    expect(paint(bubble, LINE, 20).rules).toEqual([])
  })

  it('moves the ink boundary along as the cursor advances', () => {
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

  it('STAYS once she has stopped, however long the silence', () => {
    // The retirement of v1's rule 1, asserted rather than assumed. That rule
    // faded 1.2s after the analyser reported her audio ended, and existed to
    // stop the bubble being retired EARLY — the data channel says "done"
    // seconds before she stops (§19; minutes on a long answer, §57). A bubble
    // that is never retired cannot be retired early.
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    seconds(bubble, 30, FADE_AFTER_QUIET_S + 1)
    expect(paint(bubble, LINE, 10).painted).toBe(true)
  })

  it('does not flicker through a pause mid-utterance', () => {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    seconds(bubble, 3, FADE_AFTER_QUIET_S + 1)
    expect(paint(bubble, LINE, 10).painted).toBe(true)
    seconds(bubble, 1, 0)
    expect(paint(bubble, LINE, 10).painted).toBe(true)
  })

  it('forgets its fade when the bubble is turned off', () => {
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    bubble.clear()
    expect(paint(bubble, LINE, 10).painted).toBe(false)
  })
})

describe('what fits on screen', () => {
  it('shows one page of something very long, not the whole thing', () => {
    // A bubble is a glance, not a transcript. Eight lines of it, and the rest
    // is what the conversations window is for.
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    const long = 'word '.repeat(400)
    // The page marker is drawn text too, and it is not part of what she said.
    const drawn = paint(bubble, long, 1800).drawn.filter((one) => one.text !== '⋯')
    const shown = drawn.map((one) => one.text).join('').length
    expect(shown).toBeGreaterThan(0)
    // Eight lines at this recorder's 7px-per-character measure against the
    // 340px reading column — `LINES * (TEXT_W / 7)`. The old bound said 40 a
    // line, which was the 256px column the canvas used to force.
    expect(shown).toBeLessThanOrEqual(8 * Math.ceil(340 / 7))
  })

  it('keeps her own line in view when the passage is taller than the bubble', () => {
    // Regression, and it shipped. Showing "the last four lines" is not the same
    // as showing HER four lines: a passage with a paragraph break wraps past
    // four, and the last four are then entirely ahead of the cursor.
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    const passage =
      'first line of the story here\n\nsecond paragraph begins\n\nthird one\n\nfourth\n\nfifth'
    const { drawn } = paint(bubble, passage, 10)
    expect(drawn.some((one) => one.alpha === 1)).toBe(true)
  })

  it('HOLDS STILL as she speaks, and flips a page rather than scrolling', () => {
    // The point of the change. Following the cursor line by line makes the
    // text a teleprompter: it moves continuously and the reader's eye chases
    // it. A page holds until she leaves it.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    // Numbered, because `'word '.repeat(n)` renders every page as the same
    // string — a fixture that cannot tell a held page from a turned one.
    const long = Array.from({ length: 300 }, (_, i) => `w${String(i).padStart(3, '0')}`).join(' ')

    const frames = [0, 20, 40, 60, 80].map((at) => paint(bubble, long, at).text)
    // Everything inside the first page is the SAME text, however far the
    // boundary has moved through it.
    expect(new Set(frames).size).toBe(1)

    // Far enough along and the page has turned — one change, not eighty.
    const later = paint(bubble, long, 900).text
    expect(later).not.toBe(frames[0])
  })

  it('says how much more there is, and where in it the reader is', () => {
    // Two earlier attempts at this were rejected against the running app. A `⋯`
    // in the top-left padding read as a SECOND BUBBLE behind the first — it was
    // reported as exactly that. A fade at the edges then sat almost entirely in
    // the ten pixels of padding and said nothing.
    //
    // The rail is identified by its width: everything else rounded here is the
    // bubble's own box or a copy icon on a scaled grid.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    const rail = (said: string, at: number) =>
      paint(bubble, said, at).rects.filter((one) => one.w === 3)

    expect(rail('Short enough.', 5)).toEqual([])
    // Track and thumb, in that order.
    expect(rail('word '.repeat(300), 10).length).toBe(2)
  })

  it('draws the thumb over the track, not instead of it', () => {
    // Without a track the thumb is a floating mark with no scale behind it, and
    // "how much more" goes back to being unanswered.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    const rail = paint(bubble, 'word '.repeat(300), 10).rects.filter((one) => one.w === 3)
    const [track, thumb] = rail
    if (track === undefined || thumb === undefined) throw new Error('expected a track and a thumb')
    expect(thumb.h).toBeLessThan(track.h)
    expect(thumb.alpha).toBeGreaterThan(track.alpha)
    expect(thumb.x).toBe(track.x)
  })

  it('moves the thumb down as she goes, and reaches the bottom at the end', () => {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    const long = 'word '.repeat(300)
    const thumbAt = (at: number) => {
      const rail = paint(bubble, long, at).rects.filter((one) => one.w === 3)
      const [track, thumb] = rail
      if (track === undefined || thumb === undefined) throw new Error('expected a rail')
      return { y: thumb.y, flush: thumb.y + thumb.h - (track.y + track.h) }
    }
    const first = thumbAt(10)
    const last = thumbAt(long.length)
    expect(last.y).toBeGreaterThan(first.y)
    // Flush with the end of the track on the last line, not short of it — the
    // thumb travels `track - thumb`, not the whole track.
    expect(Math.abs(last.flush)).toBeLessThan(0.5)
  })

  it('keeps the rail clear of the control column', () => {
    // The buttons end at `boxWidth - pad + 2`. A rail drawn under them would be
    // invisible exactly when somebody is reaching for the scroll.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    const painted = paint(bubble, 'word '.repeat(300), 10, true)
    const rail = painted.rects.filter((one) => one.w === 3)[0]
    const controls = bubble.controls()
    if (rail === undefined || controls === null) throw new Error('expected a rail and controls')
    expect(rail.x).toBeGreaterThanOrEqual(controls.close.x + controls.close.w)
  })

  it('wraps by measurement, not by counting characters', () => {
    const bubble = createBubble()
    seconds(bubble, 2, 0)
    expect(paint(bubble, 'a '.repeat(80), 100).drawn.length).toBeGreaterThan(1)
  })
})

describe('the way into her conversations', () => {
  function shown(problems = 0, hovered = false) {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    return {
      bubble,
      painted: paint(bubble, 'Hey there, this is what I said.', 30, hovered, problems),
    }
  }

  it('is a control in the bubble, under copy and close', () => {
    // It used to be a chip floating at her shoulder, which put a second
    // speech-bubble glyph beside an actual speech bubble.
    const { bubble } = shown()
    const controls = bubble.controls()
    expect(controls).not.toBeNull()
    if (controls === null) return
    // One column, down the right edge: close, copy, then this.
    expect(controls.history.x).toBe(controls.copy.x)
    expect(controls.copy.x).toBe(controls.close.x)
    expect(controls.close.y).toBeLessThan(controls.copy.y)
    expect(controls.copy.y).toBeLessThan(controls.history.y)
    // Inside the paper, not straddling its edge.
    expect(controls.history.x).toBeGreaterThan(0)
  })

  it('does not overlap the button above it', () => {
    const { bubble } = shown()
    const controls = bubble.controls()
    if (controls === null) throw new Error('expected controls')
    expect(controls.close.y + controls.close.h).toBeLessThanOrEqual(controls.copy.y)
    expect(controls.copy.y + controls.copy.h).toBeLessThanOrEqual(controls.history.y)
  })

  it('stays inside a bubble too short to hold it otherwise', () => {
    // "Yes." is one line. Without a floor on the box height the bottom control
    // hangs off the paper and is drawn over the desktop. `covers` is the
    // bubble's own answer to "is this point on me", which is the thing being
    // asserted rather than an arithmetic restatement of it.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    paint(bubble, 'Yes.', 4)
    const controls = bubble.controls()
    if (controls === null) throw new Error('expected controls')
    for (const corner of [
      [controls.history.x, controls.history.y],
      [controls.history.x + controls.history.w, controls.history.y + controls.history.h],
    ] as const) {
      expect(bubble.covers(corner[0], corner[1])).toBe(true)
    }
  })

  it('reports nothing while the bubble is not on screen, so the chip can take over', () => {
    // This is the whole "one way in at a time" rule: `face.ts` asks exactly
    // this question before it draws the shoulder chip.
    const bubble = createBubble()
    expect(bubble.controls()).toBeNull()
    seconds(bubble, 1, 0)
    paint(bubble, 'Something.', 4)
    expect(bubble.controls()).not.toBeNull()
    bubble.dismiss()
    paint(bubble, 'Something.', 4)
    expect(bubble.controls()).toBeNull()
  })
})

describe('saying that something went wrong', () => {
  function shown(problems: number, hovered: boolean) {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    return paint(bubble, 'Hey there, this is what I said.', 30, hovered, problems)
  }

  it('marks the control WITHOUT waiting to be hovered', () => {
    // Everything else here is hover-only, because permanent chrome on a glance
    // surface is chrome you stop seeing. This is the exception on purpose: the
    // person whose edited file was rejected has no reason to hover.
    expect(shown(1, false).arcs).toContain('#d1495b')
  })

  it('draws the icon under it, so the mark is attached to something', () => {
    // Without this the dot floats in blank paper with no control beneath it.
    const quiet = shown(0, false)
    const troubled = shown(1, false)
    expect(quiet.strokes.length).toBe(0)
    expect(troubled.strokes.length).toBeGreaterThan(0)
  })

  it('marks nothing when nothing is wrong', () => {
    expect(shown(0, false).arcs).not.toContain('#d1495b')
    expect(shown(0, true).arcs).not.toContain('#d1495b')
  })

  it('still marks it while hovered, without drawing the icon twice', () => {
    const troubled = shown(2, true)
    expect(troubled.arcs).toContain('#d1495b')
    // Three controls hovered: history (3 paths), copy (1 rect + 1 path), close
    // (2 paths). An eighth stroke would mean history was drawn twice.
    expect(troubled.strokes.length).toBe(7)
  })
})

describe('the copy button says what happened, and only what happened', () => {
  it('offers to copy on a fresh bubble rather than confirming a copy nobody made', () => {
    // `confirmedAt` used to start at 0, which is a real frame number — the one
    // the bubble opens on. So the tick showed for the first second and a half
    // of every utterance. The two icons differ by their rounded rect: `copy`
    // has one, `check` is a bare path.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    const fresh = paint(bubble, 'Something she said.', 5, true)
    expect(fresh.strokes).toContain('rect')
  })

  it('confirms after an actual copy, then goes back', () => {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    bubble.copied()
    expect(paint(bubble, 'Something she said.', 5, true).strokes).not.toContain('rect')
    // 90 frames later it is offering again.
    seconds(bubble, 2, 0)
    expect(paint(bubble, 'Something she said.', 5, true).strokes).toContain('rect')
  })
})

describe('the reader can go back through what she said', () => {
  /**
   * Every word DIFFERENT, on purpose.
   *
   * The first version of this used `'word '.repeat(300)`, so every line was
   * identical and a one-line shift produced a byte-identical string — the tests
   * for moving by a line and for clamping both passed nothing and failed
   * nothing. A fixture that cannot show the thing being asserted is worse than
   * no fixture.
   */
  const LONG = Array.from({ length: 300 }, (_, i) => `w${String(i)}`).join(' ')

  function shownFrom(bubble: ReturnType<typeof createBubble>, at: number): string {
    return paint(bubble, LONG, at).text
  }

  it('follows her until somebody scrolls, then holds', () => {
    // Two sources for one number would be two sources of truth. The scroll is
    // an OVERRIDE: while nobody has scrolled the page is chosen by where she
    // has got to, and the moment somebody does it stops following.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    shownFrom(bubble, 1200)
    bubble.scrollBy(-3)
    const held = shownFrom(bubble, 1200)
    // She keeps talking; the page does not move with her any more.
    expect(shownFrom(bubble, 1800)).toBe(held)
  })

  it('moves by a line, in the direction asked', () => {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    const start = shownFrom(bubble, 1200)
    bubble.scrollBy(-1)
    const up = shownFrom(bubble, 1200)
    expect(up).not.toBe(start)
    bubble.scrollBy(1)
    expect(shownFrom(bubble, 1200)).toBe(start)
  })

  it('stops at the top instead of banking a debt', () => {
    // A long flick past the beginning must not have to be scrolled back off
    // before the text moves again — the clamped value is written back.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    shownFrom(bubble, 1200)
    bubble.scrollBy(-9999)
    const top = shownFrom(bubble, 1200)
    bubble.scrollBy(1)
    expect(shownFrom(bubble, 1200)).not.toBe(top)
  })

  it('stops at the end the same way', () => {
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    shownFrom(bubble, 10)
    bubble.scrollBy(9999)
    const end = shownFrom(bubble, 10)
    bubble.scrollBy(-1)
    expect(shownFrom(bubble, 10)).not.toBe(end)
  })

  it('goes back to following her when she says something else', () => {
    // Arriving at her next sentence still parked in the middle of the last one
    // is the failure this prevents.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    shownFrom(bubble, 1200)
    bubble.scrollBy(-4)
    const parked = shownFrom(bubble, 1200)
    const next = paint(bubble, 'A different thing entirely, ' + 'said '.repeat(300), 1200).text
    expect(next).not.toBe(parked)
    // And it is following again: her cursor moves the page.
    const later = paint(bubble, 'A different thing entirely, ' + 'said '.repeat(300), 2400).text
    expect(later).not.toBe(next)
  })
})

describe('going to sleep closes it', () => {
  it('stays closed, rather than fading straight back in', () => {
    // `clear` was tried first and did not hold: it zeroes the opacity, and the
    // very next frame fades it back, because `step` knows nothing about sleep.
    // `dismiss` remembers WHICH text was closed.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    const said = 'Something she said before nodding off.'
    expect(paint(bubble, said, 10).painted).toBe(true)

    bubble.dismiss()
    seconds(bubble, 2, 0)
    expect(paint(bubble, said, 10).painted).toBe(false)
  })

  it('and the next thing she says still appears', () => {
    // The reason it remembers the text rather than setting a flag: a flag would
    // have to be cleared by somebody, and whoever forgot would leave her mute.
    const bubble = createBubble()
    seconds(bubble, 1, 0)
    paint(bubble, 'Before.', 5)
    bubble.dismiss()
    expect(paint(bubble, 'Before.', 5).painted).toBe(false)
    expect(paint(bubble, 'After she woke up.', 5).painted).toBe(true)
  })
})
