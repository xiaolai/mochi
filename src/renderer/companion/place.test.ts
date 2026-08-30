import { describe, expect, it } from 'vitest'
import { placeBubble, roomFor, sidesThatFit, type Body, type Reach, type Room } from './place'

/** Her, in the middle of a 700x560 canvas, standing with her feet at 340. */
const HER: Body = { left: 303, top: 267, width: 94, height: 73 }
const BOX = { w: 404, h: 164 }
/**
 * Above her and beside her are different distances, and that asymmetry is the
 * point: above her head there is a halo, and on the other three sides there is
 * nothing. See `Reach` in `place.ts`, and `BUBBLE_REACH` for the real values.
 */
const REACH: Reach = { above: 43, rest: 26 }

/** The whole canvas is on screen. */
const OPEN: Room = { left: 10, top: 10, right: 690, bottom: 550 }

describe('translating the screen into canvas pixels', () => {
  const CANVAS = { width: 700, height: 560 }
  const WORK = { x: 0, y: 30, width: 2560, height: 1410 }

  it('is the whole canvas when the window is well inside the screen', () => {
    const room = roomFor(CANVAS, { x: 800, y: 500 }, WORK, 8)
    expect(room).toEqual({ left: 0, top: 0, right: 700, bottom: 560 })
  })

  it('cuts off the part of the window that hangs past the screen', () => {
    // Her window is deliberately much larger than she is, so with her parked in
    // a corner most of it is off the display. That overhang is not somewhere a
    // bubble may go.
    const room = roomFor(CANVAS, { x: 2100, y: 1000 }, WORK, 8)
    expect(room.right).toBe(2560 - 8 - 2100)
    expect(room.bottom).toBe(30 + 1410 - 8 - 1000)
    expect(room.left).toBe(0)
  })

  it('cuts the other two edges when the window hangs off the top left', () => {
    const room = roomFor(CANVAS, { x: -200, y: -100 }, WORK, 8)
    expect(room.left).toBe(0 + 8 + 200)
    expect(room.top).toBe(30 + 8 + 100)
  })

  it('never reports a boundary outside the canvas', () => {
    // Nothing painted outside the canvas exists, however much screen there is.
    const room = roomFor(CANVAS, { x: 800, y: 500 }, WORK, 0)
    expect(room.right).toBeLessThanOrEqual(CANVAS.width)
    expect(room.bottom).toBeLessThanOrEqual(CANVAS.height)
  })
})

describe('which side she is spoken from', () => {
  it('above her, when there is room — because that is what speech looks like', () => {
    const placed = placeBubble(HER, BOX, OPEN, REACH)
    expect(placed.side).toBe('above')
    expect(placed.y + BOX.h).toBe(HER.top - REACH.above)
  })

  it('centred on her horizontally', () => {
    const placed = placeBubble(HER, BOX, OPEN, REACH)
    expect(placed.x + BOX.w / 2).toBe(HER.left + HER.width / 2)
  })

  it('below her when the screen runs out above — she is at the top of the display', () => {
    // The case the old code could not express at all: the bubble was
    // unconditionally above, so here it sat in the strip beside the menu bar.
    const squeezed: Room = { ...OPEN, top: 260 }
    const placed = placeBubble(HER, BOX, squeezed, REACH)
    expect(placed.side).toBe('below')
    expect(placed.y).toBe(HER.top + HER.height + REACH.rest)
  })

  it('beside her only when neither above nor below will do', () => {
    // A SHORT box, because a full-width one cannot go beside her at all — see
    // the arithmetic below. A one-line reply on a shallow screen can.
    const short = { w: 200, h: 40 }
    const shallow: Room = { left: 0, top: 240, right: 700, bottom: 380 }
    const placed = placeBubble(HER, short, shallow, REACH)
    expect(placed.side).toBe('left')
    expect(placed.x + short.w).toBe(HER.left - REACH.rest)
  })

  it('to her right when there is no room on her left either', () => {
    const short = { w: 200, h: 40 }
    const shallow: Room = { left: 280, top: 240, right: 900, bottom: 380 }
    const placed = placeBubble(HER, short, shallow, REACH)
    expect(placed.side).toBe('right')
    expect(placed.x).toBe(HER.left + HER.width + REACH.rest)
  })

  it('stands off further above her than beside her, because the halo is there', () => {
    // The asymmetry is the whole reason `Reach` is a record rather than a
    // number. One distance measured from her body cannot know that something is
    // ALREADY DRAWN over her head, and with a single reach the tail landed
    // inside the ring — in the shipped build, not in a proposal.
    expect(REACH.above).toBeGreaterThan(REACH.rest)
    const above = placeBubble(HER, BOX, OPEN, REACH)
    const below = placeBubble(HER, BOX, { ...OPEN, top: 260 }, REACH)
    expect(HER.top - (above.y + BOX.h)).toBe(REACH.above)
    expect(below.y - (HER.top + HER.height)).toBe(REACH.rest)
  })

  it('never goes beside her for a FULL-WIDTH bubble, and that is arithmetic', () => {
    // Worth pinning down rather than leaving as a surprise. Beside her needs
    // `her.width + 2 * (box.w + reach)` of window — 954 for a full box, against
    // the 700 she has. And it is not a gap worth closing: vertical placement
    // needs about 530 pixels of work area around her, so on any real display
    // one of above or below always has room, and the beside branches only ever
    // serve a short reply on a shallow screen.
    const shallow: Room = { left: 0, top: 240, right: 700, bottom: 380 }
    expect(placeBubble(HER, BOX, shallow, REACH).side).toBe('above')
  })
})

describe('staying on the screen', () => {
  it('slides left rather than hanging off the right edge', () => {
    // Her parked 24px from the right of the display. A bubble centred on her
    // hangs well past it; the window is wide enough for the box to slide back.
    const atRight: Room = { left: 0, top: 0, right: 420, bottom: 560 }
    const placed = placeBubble(HER, BOX, atRight, REACH)
    expect(placed.x + BOX.w).toBeLessThanOrEqual(atRight.right)
    expect(placed.x + BOX.w / 2).toBeLessThan(HER.left + HER.width / 2)
  })

  it('slides right rather than hanging off the left edge', () => {
    const atLeft: Room = { left: 280, top: 0, right: 700, bottom: 560 }
    const placed = placeBubble(HER, BOX, atLeft, REACH)
    expect(placed.x).toBeGreaterThanOrEqual(atLeft.left)
  })

  it('pins to the near edge when the room is narrower than the box', () => {
    // Not to the FAR edge. Clamped the other way round, a box wider than its
    // room lands further off screen than the value being corrected — the same
    // crossed-bounds trap `containToWorkArea` documents.
    const narrow: Room = { left: 100, top: 0, right: 300, bottom: 560 }
    const placed = placeBubble(HER, BOX, narrow, REACH)
    expect(placed.x).toBe(narrow.left)
  })

  it('still answers when nothing fits anywhere', () => {
    // A bubble slightly over her is legible. No bubble is not.
    const none: Room = { left: 300, top: 300, right: 400, bottom: 340 }
    const placed = placeBubble(HER, BOX, none, REACH)
    expect(Number.isFinite(placed.x)).toBe(true)
    expect(Number.isFinite(placed.y)).toBe(true)
    expect(placed.side).toBe('above')
  })
})

describe('when somebody has chosen a side', () => {
  /** Her window is 980 wide so a whole bubble fits beside her — 94 + 2 x 430. */
  const WIDE: Body = { left: 443, top: 267, width: 94, height: 73 }
  const WIDE_ROOM: Room = { left: 0, top: 0, right: 980, bottom: 560 }

  it('honours the choice when it fits', () => {
    const placed = placeBubble(WIDE, BOX, WIDE_ROOM, REACH, 'left')
    expect(placed.side).toBe('left')
    expect(placed.x + BOX.w).toBe(WIDE.left - REACH.rest)
  })

  it('falls back to the standing order when it does not', () => {
    // Not forced. Honouring a side that does not fit means a bubble half off
    // the display, which honours nothing.
    const noRoomLeft: Room = { ...WIDE_ROOM, left: 400 }
    expect(placeBubble(WIDE, BOX, noRoomLeft, REACH, 'left').side).toBe('above')
  })

  it('is the standing order when nobody has chosen', () => {
    expect(placeBubble(WIDE, BOX, WIDE_ROOM, REACH, 'auto').side).toBe('above')
    expect(placeBubble(WIDE, BOX, WIDE_ROOM, REACH).side).toBe('above')
  })

  it('lists what the menu may offer, and only that', () => {
    // The menu is built from this. Offering a side that cannot be honoured is
    // the one thing it must not do.
    expect(sidesThatFit(WIDE, BOX, WIDE_ROOM, REACH)).toEqual(['above', 'below', 'left', 'right'])
  })

  it('drops the sides the screen has taken away', () => {
    // Her in the bottom right: the display ends below her and to her right, so
    // above and left are what is left — which is exactly the case that prompted
    // a menu rather than a rule.
    const corner: Room = { left: 0, top: 0, right: 590, bottom: 380 }
    expect(sidesThatFit(WIDE, BOX, corner, REACH)).toEqual(['above', 'left'])
  })
})
