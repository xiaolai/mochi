import { describe, expect, it } from 'vitest'
import { lensHeight, lensOutline, type LensShape } from './lens'

const EYE: LensShape = { halfWidth: 10, upper: 11, lower: 11, tilt: 0, roundness: 2 }

const top = (points: { y: number }[]): number => Math.max(...points.map((p) => p.y))
const bottom = (points: { y: number }[]): number => Math.min(...points.map((p) => p.y))

describe('lensOutline', () => {
  it('reaches the arc heights it was given', () => {
    // Each edge is half a superellipse, so its apex IS the requested extent.
    // This is the assertion that catches a parametrisation which quietly
    // reaches only part of the way there.
    const points = lensOutline(EYE)
    expect(top(points)).toBeCloseTo(EYE.upper, 1)
    expect(bottom(points)).toBeCloseTo(-EYE.lower, 1)
  })

  it('spans its half-width', () => {
    const points = lensOutline(EYE)
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(EYE.halfWidth, 6)
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(-EYE.halfWidth, 6)
  })

  it('a negative lower makes a crescent — the ^ ^ happy eye', () => {
    // The single most important property of this primitive. Both edges curve
    // upward, so the shape sits above its own baseline. That is what gives a
    // smiling eye without a second asset and without a special case.
    //
    // The two corners are pinned at y = 0 by construction, so the assertion is
    // that nothing dips BELOW the baseline and the lower edge's interior rises
    // above it — not that every point does.
    const happy = lensOutline({ ...EYE, lower: -6 })
    // An epsilon, not zero: the two corners land on the baseline through a
    // trigonometric round trip, so they arrive a few ulps either side of it.
    expect(bottom(happy)).toBeGreaterThan(-1e-9)
    expect(top(happy)).toBeCloseTo(EYE.upper, 1)

    // The lower edge is the second half of the outline; its midpoint is the
    // deepest part of a normal eye and the highest part of a crescent.
    const lowerEdge = happy.slice(Math.floor(happy.length / 2))
    const midpoint = lowerEdge[Math.floor(lowerEdge.length / 2)]!
    expect(midpoint.y).toBeGreaterThan(0)

    // And the sign genuinely flips the shape: a positive lower dips below.
    const sad = lensOutline({ ...EYE, lower: 6 })
    expect(bottom(sad)).toBeLessThan(0)
  })

  it('collapses to a sliver when both arcs go to zero — a blink', () => {
    const shut = lensOutline({ ...EYE, upper: 0, lower: 0 })
    for (const point of shut) expect(Math.abs(point.y)).toBeLessThan(1e-9)
  })

  it('is symmetric about x when untilted', () => {
    const points = lensOutline(EYE)
    const xs = points.map((p) => p.x)
    expect(Math.max(...xs)).toBeCloseTo(-Math.min(...xs), 6)
  })

  it('tilts as a rigid rotation, preserving extent', () => {
    const flat = lensOutline(EYE)
    const tilted = lensOutline({ ...EYE, tilt: 0.3 })
    const extent = (points: { x: number; y: number }[]): number =>
      Math.max(...points.map((p) => Math.hypot(p.x, p.y)))
    expect(extent(tilted)).toBeCloseTo(extent(flat), 6)
  })

  it('treats a negative half-width as zero rather than inverting', () => {
    const points = lensOutline({ ...EYE, halfWidth: -5 })
    for (const point of points) expect(Math.abs(point.x)).toBeLessThan(1e-9)
  })
})

describe('lensHeight', () => {
  it('reports the larger extent, so gaze has something to scale against', () => {
    expect(lensHeight({ ...EYE, upper: 3, lower: 9 })).toBe(9)
    // Magnitude, not signed: a crescent still occupies vertical space, and a
    // signed answer would let gaze travel collapse to nothing on a happy eye.
    expect(lensHeight({ ...EYE, upper: 3, lower: -9 })).toBe(9)
  })
})
