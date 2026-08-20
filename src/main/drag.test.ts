import { describe, expect, it } from 'vitest'
import { clamp, dragTo, parseGrip } from './drag'

const BOUNDS = { x: 0, y: 0, width: 320, height: 320 }

describe('where she was grabbed', () => {
  it('rounds a fractional offset, which is what a scaled display sends', () => {
    expect(parseGrip({ offsetX: 12.7, offsetY: 40.2 }, BOUNDS)).toEqual({
      offsetX: 13,
      offsetY: 40,
    })
  })

  it('clamps an offset outside the window instead of flinging her off screen', () => {
    // The grip is SUBTRACTED from the cursor, so an offset of four thousand
    // puts her origin four thousand pixels left of the pointer on the first
    // tick — off every display, with no way back.
    expect(parseGrip({ offsetX: 4000, offsetY: -50 }, BOUNDS)).toEqual({
      offsetX: 320,
      offsetY: 0,
    })
  })

  it('refuses anything that is not a pair of finite numbers', () => {
    // It arrives from a page. NaN would propagate into `setPosition` and put
    // her at an origin no display contains.
    expect(parseGrip(null, BOUNDS)).toBeNull()
    expect(parseGrip('over there', BOUNDS)).toBeNull()
    expect(parseGrip({ offsetX: Number.NaN, offsetY: 0 }, BOUNDS)).toBeNull()
    expect(parseGrip({ offsetX: 1 }, BOUNDS)).toBeNull()
    expect(parseGrip({ offsetX: Number.POSITIVE_INFINITY, offsetY: 0 }, BOUNDS)).toBeNull()
  })
})

describe('clamping', () => {
  it('returns the value when it is already inside', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('returns the bound it crossed', () => {
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(30, 0, 10)).toBe(10)
  })

  it('returns the MAXIMUM when the bounds cross, which is why callers must not let them', () => {
    // Documented rather than fixed here, because it is the reason
    // `containToWorkArea` special-cases a window larger than the work area:
    // with crossed bounds this returns the maximum, placing her further out
    // than the value it was asked to correct.
    expect(clamp(5, 10, 0)).toBe(0)
  })
})

describe('dragging her to the top of the display', () => {
  /** Her, and where she stands, on a 980x560 canvas at size 100. */
  const HER = { left: 443, width: 94, height: 73 }
  const WORK = { x: 0, y: 30, width: 2560, height: 1410 }
  const FEET = 340
  const KEEP = 4
  const FLOOR = HER.height + 10

  /** Grabbed dead centre of her. */
  const GRIP = { x: 47, y: 36 }

  const to = (x: number, y: number) => dragTo({ x, y }, GRIP, HER, WORK, KEEP, FEET, FLOOR)

  it('leaves her standing height alone in the middle of the screen', () => {
    expect(to(1200, 700).feetFromTop).toBe(FEET)
  })

  it('puts her exactly where the cursor asked', () => {
    const at = to(1200, 700)
    // Her left and top on screen, reconstructed from the window and the stance.
    expect(at.x + HER.left).toBe(1200 - GRIP.x)
    expect(at.y + at.feetFromTop - HER.height).toBe(700 - GRIP.y)
  })

  it('raises her INSIDE the window when the window cannot rise', () => {
    // macOS will not put a window's top above the work area. Before this, her
    // feet were a fixed 340 into the canvas and she stopped dead about 270
    // pixels short of the top of the display.
    const at = to(1200, 100)
    expect(at.y).toBe(WORK.y)
    expect(at.feetFromTop).toBeLessThan(FEET)
    // And still exactly where the cursor asked.
    expect(at.y + at.feetFromTop - HER.height).toBe(100 - GRIP.y)
  })

  it('lets her reach the very top of the display', () => {
    const at = to(1200, -500)
    expect(at.y + at.feetFromTop - HER.height).toBe(WORK.y + KEEP)
  })

  it('comes back DOWN when there is room again', () => {
    // The failure this replaced: the stance was subtracted from its own last
    // value, so once she had been raised she never came back — dragged to the
    // top and home again, she stayed standing at the top of her canvas with the
    // bubble stuck below her.
    expect(to(1200, 100).feetFromTop).toBeLessThan(FEET)
    expect(to(1200, 700).feetFromTop).toBe(FEET)
  })

  it('stops when she is standing at the very top of her own canvas', () => {
    // Above that she is not drawn at all, so there is nothing further to give.
    expect(to(1200, -5000).feetFromTop).toBe(FLOOR)
  })

  it('still keeps her on the display', () => {
    const at = to(9000, 9000)
    expect(at.x + HER.left + HER.width).toBeLessThanOrEqual(WORK.x + WORK.width - KEEP)
    const herTop = at.y + at.feetFromTop - HER.height
    expect(herTop + HER.height).toBeLessThanOrEqual(WORK.y + WORK.height - KEEP)
  })
})

describe('the window origin is whole pixels', () => {
  /**
   * `setPosition` refuses a fraction, and her body is one.
   *
   * `bodyHeight` is `bodyH * BASE_UNIT_SCALE` — 78 x 0.94 = 73.32 — so
   * `top + her.height - feetFromTop` is fractional for every ordinary drag.
   * Electron's native binding does not truncate: measured against a real window,
   * an integer is accepted and a float throws `Error processing argument at
   * index 1, conversion failure from` with nothing after the "from", which is
   * the same message NaN produces and is why it read as a null.
   *
   * It threw on every tick of the drag interval, so one drag produced a wall of
   * identical uncaught exceptions and moved her nowhere — the throw lands before
   * `onStance`, so nothing downstream ran either.
   */
  const WORK = { x: 0, y: 30, width: 2560, height: 1410 }
  const FRACTIONAL = { left: 443, width: 94, height: 73.32 }

  it.each([
    ['middle of the display', { x: 1200, y: 700 }],
    ['bottom right corner', { x: 2559, y: 1439 }],
    ['top left corner', { x: 0, y: 0 }],
    ['past the bottom edge', { x: 1200, y: 3000 }],
  ])('is an integer with her fractional body: %s', (_where, cursor) => {
    const to = dragTo(cursor, { x: 40, y: 30 }, FRACTIONAL, WORK, 4, 340, FRACTIONAL.height + 10)
    expect(Number.isInteger(to.x), `x was ${to.x}`).toBe(true)
    expect(Number.isInteger(to.y), `y was ${to.y}`).toBe(true)
  })

  it('still puts her where it always did, to the pixel', () => {
    // Rounding must not move her: this is the same answer as before, rounded.
    const to = dragTo({ x: 2559, y: 1439 }, { x: 40, y: 30 }, FRACTIONAL, WORK, 4, 340, 83.32)
    const top = Math.min(2559 - 30, WORK.y + WORK.height - 4 - FRACTIONAL.height)
    expect(to.y).toBe(Math.round(top + FRACTIONAL.height - to.feetFromTop))
  })
})
