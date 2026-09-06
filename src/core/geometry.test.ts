import { describe, expect, it } from 'vitest'
import {
  domeOutline,
  placeFeature,
  shearAt,
  squashed,
  widthAt,
  type BodyShape,
} from './geometry.js'

/**
 * The silhouette maths, on its own terms.
 *
 * The application keeps a second geometry test that measures the shape against
 * a specific piece of artwork. That one is about a particular character; this
 * one is about the arithmetic every character shares, and it is the test the
 * package needs in order to ship this module honestly.
 */

const SHAPE: BodyShape = {
  halfWidth: 50,
  height: 78,
  waist: 0.3,
  upperShoulder: 2,
  lowerShoulder: 2,
  lean: 0,
}

describe('widthAt', () => {
  it('is widest exactly at the waist', () => {
    expect(widthAt(SHAPE, SHAPE.waist)).toBeCloseTo(1, 10)
    expect(widthAt(SHAPE, SHAPE.waist - 0.05)).toBeLessThan(1)
    expect(widthAt(SHAPE, SHAPE.waist + 0.05)).toBeLessThan(1)
  })

  it('closes to a point at the base and at the apex', () => {
    expect(widthAt(SHAPE, 0)).toBeCloseTo(0, 10)
    expect(widthAt(SHAPE, 1)).toBeCloseTo(0, 10)
  })

  it('clamps rather than extrapolating outside 0..1', () => {
    expect(widthAt(SHAPE, -3)).toBeCloseTo(widthAt(SHAPE, 0), 12)
    expect(widthAt(SHAPE, 7)).toBeCloseTo(widthAt(SHAPE, 1), 12)
  })

  it('reads the exponent on the correct side of the waist', () => {
    // Fuller below, pointier above: the asymmetry has to act where it is aimed.
    const asymmetric = { ...SHAPE, upperShoulder: 1.5, lowerShoulder: 3 }
    const below = widthAt(asymmetric, SHAPE.waist / 2)
    const above = widthAt(asymmetric, SHAPE.waist + (1 - SHAPE.waist) / 2)
    expect(below).toBeGreaterThan(above)
  })
})

describe('squashed', () => {
  it('preserves area — that is what makes it read as dough', () => {
    // Area is proportional to halfWidth * height for fixed exponents.
    const area = (s: BodyShape): number => s.halfWidth * s.height
    for (const amount of [-0.5, -0.2, 0, 0.2, 0.5, 0.89]) {
      expect(area(squashed(SHAPE, amount))).toBeCloseTo(area(SHAPE), 8)
    }
  })

  it('refuses to divide by zero, however hard it is pushed', () => {
    for (const amount of [-1, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = squashed(SHAPE, amount)
      expect(Number.isFinite(out.height)).toBe(true)
      expect(Number.isFinite(out.halfWidth)).toBe(true)
      expect(out.height).toBeGreaterThan(0)
    }
  })
})

describe('shearAt', () => {
  it('pins the contact point and grows with height — a lean, not a translation', () => {
    const leaning = { ...SHAPE, lean: 1 }
    expect(shearAt(leaning, 0)).toBe(0)
    expect(shearAt(leaning, leaning.height)).toBeGreaterThan(shearAt(leaning, leaning.height / 2))
    expect(shearAt(leaning, leaning.height / 2)).toBeGreaterThan(0)
  })

  it('mirrors with the sign of the lean', () => {
    const y = SHAPE.height * 0.7
    expect(shearAt({ ...SHAPE, lean: -0.4 }, y)).toBeCloseTo(
      -shearAt({ ...SHAPE, lean: 0.4 }, y),
      12,
    )
  })
})

describe('domeOutline', () => {
  it('rests on y = 0 and occupies only positive height', () => {
    const points = domeOutline(SHAPE)
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0, 10)
    expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(SHAPE.height, 6)
  })

  it('is symmetric about the axis when it is not leaning', () => {
    const points = domeOutline(SHAPE)
    const left = Math.min(...points.map((p) => p.x))
    const right = Math.max(...points.map((p) => p.x))
    expect(left).toBeCloseTo(-right, 6)
  })

  it('never returns a NaN, whatever degenerate shape it is handed', () => {
    for (const shape of [
      { ...SHAPE, halfWidth: 0 },
      { ...SHAPE, height: 0 },
      { ...SHAPE, waist: 0 },
      { ...SHAPE, waist: 1 },
    ]) {
      for (const point of domeOutline(shape)) {
        expect(Number.isFinite(point.x)).toBe(true)
        expect(Number.isFinite(point.y)).toBe(true)
      }
    }
  })
})

describe('placeFeature', () => {
  it('at grip 1 sits in the squashed frame, at grip 0 in the resting one', () => {
    const sq = squashed(SHAPE, 0.4)
    const gripped = placeFeature(SHAPE, sq, 0.5, 0.5, 1, 1)
    const floating = placeFeature(SHAPE, sq, 0.5, 0.5, 0, 0)
    expect(gripped.x).toBeCloseTo(0.5 * sq.halfWidth, 10)
    expect(floating.x).toBeCloseTo(0.5 * SHAPE.halfWidth, 10)
    expect(gripped.y).toBeCloseTo(0.5 * sq.height, 10)
    expect(floating.y).toBeCloseTo(0.5 * SHAPE.height, 10)
  })

  it('does not move a zero-grip feature sideways during a squash', () => {
    // The regression the grip note in geometry.ts describes: the shear used to
    // be taken from the squashed frame unconditionally, so a feature that was
    // supposed to be ignoring the deformation slid during one anyway.
    const leaning = { ...SHAPE, lean: 0.6 }
    const rest = placeFeature(leaning, squashed(leaning, 0), 0.4, 0.5, 0, 0)
    const under = placeFeature(leaning, squashed(leaning, 0.5), 0.4, 0.5, 0, 0)
    expect(under.x).toBeCloseTo(rest.x, 10)
  })
})
