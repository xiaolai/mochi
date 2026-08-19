import { describe, expect, it } from 'vitest'
import { beatRect, createBeat, drawBeat, OVERDUE_S, OVERDUE_TEXT } from './beat'

/** Where she stands on her 980x560 canvas at size 100. */
const HER = { left: 443, top: 267, width: 94, height: 73 }

/** The whole canvas on screen, which is the ordinary case. */
const OPEN = { left: 0, top: 0, right: 980, bottom: 560 }

/** One frame at sixty a second, which is what the render loop hands it. */
const FRAME = 1 / 60

/** Run the loop for a while with nothing coming back from her. */
function silence(beat: ReturnType<typeof createBeat>, seconds: number): void {
  for (let t = 0; t < seconds; t += FRAME) beat.step(FRAME, false)
}

describe('opening the beat', () => {
  it('is closed until a turn ends', () => {
    const beat = createBeat()
    expect(beat.state()).toBe('none')
    silence(beat, 5)
    expect(beat.state()).toBe('none')
  })

  it('opens on the frame after the turn ended', () => {
    // Deliberately not inside `turnEnded` itself: the decision needs to see
    // whether she is already making sound, and only `step` is told that.
    const beat = createBeat()
    beat.turnEnded()
    expect(beat.state()).toBe('none')
    expect(beat.step(FRAME, false)).toBe('held')
  })

  it('never opens when she is already speaking', () => {
    // Otherwise a turn ending under her own voice — which is what a barge-in
    // looks like from here — would flash a beat for exactly one frame.
    const beat = createBeat()
    beat.turnEnded()
    expect(beat.step(FRAME, true)).toBe('none')
    expect(beat.step(FRAME, false)).toBe('none')
  })

  it('is not restarted by a second turn ending inside it', () => {
    // Somebody clearing their throat mid-wait would otherwise push `overdue`
    // out of reach for as long as they kept doing it.
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, OVERDUE_S - 0.5)
    beat.turnEnded()
    silence(beat, 0.6)
    expect(beat.state()).toBe('overdue')
  })
})

describe('leaving it', () => {
  it('closes on the first frame the analyser reports her voice', () => {
    // §64 measured `output_audio_buffer.started` arriving with NO audio behind
    // it, on the same two utterances in every arm. The started frame is a
    // promise of audio; this is audio.
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, 1)
    expect(beat.state()).toBe('held')
    expect(beat.step(FRAME, true)).toBe('none')
    expect(beat.heldFor()).toBe(0)
  })

  it('closes out of overdue too, and can open again on the next turn', () => {
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, OVERDUE_S + 0.5)
    expect(beat.state()).toBe('overdue')
    expect(beat.step(FRAME, true)).toBe('none')

    beat.turnEnded()
    expect(beat.step(FRAME, false)).toBe('held')
  })

  it('is cleared outright when they start talking again', () => {
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, 1)
    beat.reset()
    expect(beat.state()).toBe('none')
    silence(beat, 5)
    expect(beat.state()).toBe('none')
  })
})

describe('the wait that never settles', () => {
  it('holds through everything §64 measured before calling it overdue', () => {
    // The worst arm in the sweep is `server_vad` at 900ms: 2220ms P90 from the
    // end of the clip, and this beat opens ~350ms after that. Anything inside
    // the measured band must still read as waiting, not as a failure.
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, 1.99)
    expect(beat.state()).toBe('held')
  })

  it('gives up at three seconds, which is well past the shipped P90', () => {
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, OVERDUE_S + FRAME)
    expect(beat.state()).toBe('overdue')
  })

  it('stays overdue rather than lapsing back into silence', () => {
    // The whole complaint is open-ended silence. A mark that timed itself out
    // would restore exactly that, a few seconds later.
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, 30)
    expect(beat.state()).toBe('overdue')
  })

  it('takes the threshold it was built with', () => {
    const beat = createBeat(1)
    beat.turnEnded()
    silence(beat, 1.1)
    expect(beat.state()).toBe('overdue')
  })
})

describe('the clock it is handed', () => {
  it('survives a frame that reports nonsense', () => {
    // The render loop's delta comes from `requestAnimationFrame` timestamps,
    // which jump when the window is occluded and are absent on the first frame.
    const beat = createBeat()
    beat.turnEnded()
    beat.step(Number.NaN, false)
    expect(beat.state()).toBe('held')
    expect(beat.heldFor()).toBe(0)
  })

  it('does not let one long frame skip the whole wait', () => {
    // A backgrounded window can hand back a delta of several seconds. Clamped,
    // so returning to the tab does not find her already asking them to repeat.
    const beat = createBeat()
    beat.turnEnded()
    beat.step(10, false)
    expect(beat.state()).toBe('held')
  })

  it('fades in rather than snapping into existence', () => {
    const beat = createBeat()
    beat.turnEnded()
    beat.step(FRAME, false)
    const early = beat.opacity()
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(1)
    silence(beat, 0.5)
    expect(beat.opacity()).toBe(1)
  })

  it('has no opacity at all when there is no beat', () => {
    expect(createBeat().opacity()).toBe(0)
  })
})

describe('where it is drawn', () => {
  it('sits centred under her, which is the side the bubble does not prefer', () => {
    // `place.ts` tries `above` first, so preferring `below` keeps the two off
    // the same strip when a persona has the bubble turned on.
    const rect = beatRect(HER)
    expect(rect.x + rect.w / 2).toBe(HER.left + HER.width / 2)
    expect(rect.y).toBeGreaterThan(HER.top + HER.height)
  })

  it('stays under her when the whole canvas is on screen', () => {
    // The ordinary case: her window hangs off the display only when she has
    // been dragged into a corner.
    const rect = beatRect(HER, OPEN)
    expect(rect.y).toBeGreaterThan(HER.top + HER.height)
    expect(rect.x + rect.w / 2).toBe(HER.left + HER.width / 2)
  })

  it('follows her when she moves', () => {
    const a = beatRect(HER)
    const b = beatRect({ ...HER, left: HER.left - 61, top: HER.top + 37 })
    expect(b.x - a.x).toBe(-61)
    expect(b.y - a.y).toBe(37)
  })

  it('goes over her head when she is against the bottom of the display', () => {
    // Her window hangs off the display on purpose, so "inside the canvas" is
    // not the same question as "on screen".
    const atBottom = { left: 0, top: 0, right: 980, bottom: HER.top + HER.height + 4 }
    const rect = beatRect(HER, atBottom)
    expect(rect.y + rect.h).toBeLessThanOrEqual(HER.top)
  })

  it('is pulled back onto the screen when she is against an edge', () => {
    const atRight = { left: 0, top: 0, right: HER.left + HER.width + 6, bottom: 560 }
    const rect = beatRect(HER, atRight)
    expect(rect.x + rect.w).toBeLessThanOrEqual(atRight.right)
    expect(rect.x).toBeGreaterThanOrEqual(atRight.left)
  })

  it('stays inside a room narrower than it is, rather than going left of it', () => {
    const sliver = { left: 200, top: 0, right: 260, bottom: 560 }
    const rect = beatRect(HER, sliver)
    expect(rect.x).toBe(sliver.left)
  })
})

/** A context that records what was asked of it, as `chip.test.ts` does. */
function recorder() {
  const calls: string[] = []
  const ctx = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath() {},
    roundRect() {},
    arc() {},
    fill() {
      calls.push(`fill:${String(ctx.fillStyle)}`)
    },
    fillText(text: string) {
      calls.push(`text:${text}`)
    },
    fillStyle: '' as string,
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    globalAlpha: 1,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx }
}

const COLOURS = { paper: '#f4f2ea', ink: '#2b2c25' }

describe('what it draws', () => {
  it('draws nothing at all when there is no beat', () => {
    // Every frame she is not waiting, which is almost all of them. A zero-alpha
    // paint would still cost a path sixty times a second.
    const { ctx, calls } = recorder()
    drawBeat(ctx, HER, COLOURS, 'none', 1)
    expect(calls).toEqual([])
  })

  it('draws nothing while it is still faded out', () => {
    const { ctx, calls } = recorder()
    drawBeat(ctx, HER, COLOURS, 'held', 0)
    expect(calls).toEqual([])
  })

  it('paints its own opaque surface, because she may be on a photograph', () => {
    const { ctx, calls } = recorder()
    drawBeat(ctx, HER, COLOURS, 'held', 1)
    expect(calls).toContain(`fill:${COLOURS.paper}`)
  })

  it('says nothing while it is only waiting', () => {
    // Three dots and no words. Nothing here knows how long the wait will be,
    // so a bar filling towards an end would be an invention.
    const { ctx, calls } = recorder()
    drawBeat(ctx, HER, COLOURS, 'held', 1)
    expect(calls.some((one) => one.startsWith('text:'))).toBe(false)
  })

  it('asks them to say it again once the wait has stopped being one', () => {
    const { ctx, calls } = recorder()
    drawBeat(ctx, HER, COLOURS, 'overdue', 1)
    expect(calls).toContain(`text:${OVERDUE_TEXT}`)
  })

  it('restores the context it was handed', () => {
    // It shares a canvas with her. A leaked alpha or fillStyle would tint
    // whatever is painted next, which is her face.
    for (const state of ['held', 'overdue'] as const) {
      const { ctx, calls } = recorder()
      drawBeat(ctx, HER, COLOURS, state, 0.5)
      expect(calls[0]).toBe('save')
      expect(calls[calls.length - 1]).toBe('restore')
    }
  })
})
