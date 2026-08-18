import { describe, expect, it } from 'vitest'
import { clamp, parseGrip } from './drag'

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
