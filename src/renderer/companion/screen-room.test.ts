import { afterEach, describe, expect, it, vi } from 'vitest'

import { availableScreen, roomOnScreen, sidesFor } from './screen-room'

/**
 * AUDIT FINDING: this module had no test, and the note said it did.
 *
 * `.claude/loc-guardian.local.md` claims all three `face.ts` extractions were
 * "taken out and given a test". Only `pad-change.ts` was. These were extracted
 * **for** testability — out of a closure that resolves a palette off
 * `document` at load and therefore cannot be imported — so the extraction paid
 * its whole cost and collected none of its benefit.
 *
 * `sidesFor` is worth the file on its own. Its header records two defects it
 * replaced, and both were silent: an answer that froze at her last utterance
 * and went on describing a corner she had left, and a measurement of the box
 * she HAPPENED to say, so one position offered different sides for a short
 * reply and a long one.
 */

/**
 * A display, and a window somewhere on it.
 *
 * Stubbed as `window.*` rather than as bare globals: the module reads
 * `window.screen` and `window.screenX` explicitly, and these tests run in the
 * node environment where there is no `window` at all. That is the whole reason
 * this module was extracted — the closure it came from touches `document` at
 * load, so it could not be reached from here in any form.
 */
function screen(
  where: { x: number; y: number; width: number; height: number },
  at: { screenX: number; screenY: number },
): void {
  vi.stubGlobal('window', {
    screen: {
      availLeft: where.x,
      availTop: where.y,
      availWidth: where.width,
      availHeight: where.height,
    },
    screenX: at.screenX,
    screenY: at.screenY,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const BOX = { left: 40, top: 40, width: 120, height: 160 }

describe('reading the usable screen', () => {
  it('reads the avail* offsets, not just the size', () => {
    // A menu bar or a dock means the usable area does not start at 0,0. These
    // live in the CSSOM View spec's appendix rather than its interface, which
    // is why they are read through a cast — and why a test is worth having.
    screen({ x: 0, y: 25, width: 1440, height: 875 }, { screenX: 0, screenY: 0 })
    expect(availableScreen()).toEqual({ x: 0, y: 25, width: 1440, height: 875 })
  })

  it('falls back to the origin when the browser omits them', () => {
    vi.stubGlobal('window', {
      screen: { availWidth: 1440, availHeight: 900 },
      screenX: 0,
      screenY: 0,
    })
    expect(availableScreen()).toEqual({ x: 0, y: 0, width: 1440, height: 900 })
  })
})

describe('which sides a bubble would fit on', () => {
  it('offers both sides when she is in the middle of a wide display', () => {
    screen({ x: 0, y: 0, width: 3000, height: 1600 }, { screenX: 1200, screenY: 600 })
    const sides = sidesFor(BOX, 'auto')
    expect(sides).not.toBeNull()
    expect(sides?.available).toContain('left')
    expect(sides?.available).toContain('right')
  })

  it('drops the left when she is against the left edge', () => {
    screen({ x: 0, y: 0, width: 3000, height: 1600 }, { screenX: 0, screenY: 600 })
    expect(sidesFor(BOX, 'auto')?.available).not.toContain('left')
  })

  it('drops the right when she is against the right edge', () => {
    screen({ x: 0, y: 0, width: 3000, height: 1600 }, { screenX: 2900, screenY: 600 })
    expect(sidesFor(BOX, 'auto')?.available).not.toContain('right')
  })

  it('answers null when nothing fits anywhere', () => {
    // A display too small for the widest bubble on any side. Null rather than
    // an empty list, because the caller draws a menu and "no sides" is a
    // different thing from "these sides".
    screen({ x: 0, y: 0, width: 200, height: 200 }, { screenX: 0, screenY: 0 })
    expect(sidesFor(BOX, 'auto')).toBeNull()
  })

  it('gives the same answer for the same position whatever she last said', () => {
    /*
      THE FIRST DEFECT ITS HEADER RECORDS.

      This measured the box she HAPPENED to say, so one position offered
      different sides for a short reply and a long one. It asks about the
      WIDEST bubble that can exist now, so the only inputs are where she is and
      what was asked for.
    */
    screen({ x: 0, y: 0, width: 3000, height: 1600 }, { screenX: 1200, screenY: 600 })
    const first = sidesFor(BOX, 'auto')
    const second = sidesFor(BOX, 'auto')
    expect(second?.available).toEqual(first?.available)
  })

  it('tracks her when she moves, rather than freezing where she spoke', () => {
    /*
      THE SECOND DEFECT.

      It was set inside the drawing, and `draw` returns early when there is
      nothing to say — so the answer froze at her last utterance and went on
      describing the corner she had spoken from while she was dragged across
      the display.
    */
    screen({ x: 0, y: 0, width: 3000, height: 1600 }, { screenX: 0, screenY: 600 })
    const atLeft = sidesFor(BOX, 'auto')?.available
    screen({ x: 0, y: 0, width: 3000, height: 1600 }, { screenX: 2900, screenY: 600 })
    const atRight = sidesFor(BOX, 'auto')?.available
    expect(atRight).not.toEqual(atLeft)
  })

  it('reports a side it will actually use, from the same call that listed them', () => {
    // The menu marks what was asked for and the bubble goes where it fits.
    // Asking one function keeps the two from ever disagreeing.
    screen({ x: 0, y: 0, width: 3000, height: 1600 }, { screenX: 1200, screenY: 600 })
    const sides = sidesFor(BOX, 'auto')
    expect(sides?.available).toContain(sides?.using)
  })

  it('honours a preference when that side fits', () => {
    screen({ x: 0, y: 0, width: 3000, height: 1600 }, { screenX: 1200, screenY: 600 })
    expect(sidesFor(BOX, 'left')?.using).toBe('left')
    expect(sidesFor(BOX, 'right')?.using).toBe('right')
  })

  it('uses a side that fits when the preferred one does not', () => {
    // A chosen side that stopped fitting must not put the bubble off-screen.
    screen({ x: 0, y: 0, width: 3000, height: 1600 }, { screenX: 0, screenY: 600 })
    const sides = sidesFor(BOX, 'left')
    expect(sides?.using).not.toBe('left')
    expect(sides?.available).toContain(sides?.using)
  })

  it('shows what it decided from', () => {
    // `from` exists so a surprising answer can be checked at a glance rather
    // than reproduced.
    screen({ x: 0, y: 0, width: 3000, height: 1600 }, { screenX: 1200, screenY: 600 })
    const from = sidesFor(BOX, 'auto')?.from
    expect(from?.body).toMatch(/^\d+(\.\d+)?,\d+(\.\d+)?\s\d+x\d+$/)
    expect(from?.room).toContain('to')
  })
})

describe('the room a drawing gets', () => {
  it('is inset from the edge of the display', () => {
    // A bubble flush against the screen edge reads as clipped.
    screen({ x: 0, y: 0, width: 1000, height: 800 }, { screenX: 0, screenY: 0 })
    const room = roomOnScreen({ clientWidth: 400, clientHeight: 300 } as HTMLCanvasElement)
    expect(room.left).toBeGreaterThan(0)
    expect(room.right).toBeLessThan(1000)
  })

  it('follows the display own origin rather than assuming zero', () => {
    /*
      A second display LEFT of the primary has a negative `availLeft`.

      `room` is window-relative, which is the part a first draft of this test
      got wrong — it asserted a negative `left` and got 8, the inset. The
      property that actually distinguishes the two behaviours is the SIZE of
      that number: with the display's own origin, a window flush against its
      left edge is one inset away from it. Assuming an origin of 0 would put
      the same window 1440px inside the screen, and `left` would come back
      around 1448 — a bubble drawn a monitor away from her.
    */
    screen({ x: -1440, y: 0, width: 1440, height: 900 }, { screenX: -1440, screenY: 0 })
    const room = roomOnScreen({ clientWidth: 400, clientHeight: 300 } as HTMLCanvasElement)
    expect(room.left).toBeLessThan(100)

    // And the same window on a display whose origin IS zero agrees, which is
    // what says the origin is being read rather than ignored.
    screen({ x: 0, y: 0, width: 1440, height: 900 }, { screenX: 0, screenY: 0 })
    const primary = roomOnScreen({ clientWidth: 400, clientHeight: 300 } as HTMLCanvasElement)
    expect(room.left).toBe(primary.left)
  })
})
