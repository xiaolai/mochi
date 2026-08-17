import { describe, expect, it } from 'vitest'
import { MOCHI as FACE } from '@shared/avatar-spec'
import { domeOutline, placeFeature, shearAt, squashed, widthAt, type BodyShape } from './geometry'

const BODY: BodyShape = {
  halfWidth: 100,
  height: 78,
  waist: FACE.waist,
  upperShoulder: FACE.upperShoulder,
  lowerShoulder: FACE.lowerShoulder,
  lean: 0,
}

/** Area of this ovoid is proportional to halfWidth * height for fixed exponents. */
const area = (shape: BodyShape): number => shape.halfWidth * shape.height

/**
 * The icon's own width profile, half-width as a fraction of its widest point,
 * sampled every 5% of its height from the contact point upward.
 *
 * Measured off `rig/__fixtures__/mochi-icon.png` (1126 x 879 bounding box). This is the
 * artwork's shape as a number, and it is the only thing standing between the
 * rig and a silhouette that merely looks plausible. The first version of this
 * module put the widest point at the base and the ratio at 1.25; both were
 * wrong, and nothing in the code could have said so.
 */
const ICON_PROFILE: readonly number[] = [
  0.001, 0.697, 0.853, 0.932, 0.972, 0.993, 1.0, 0.996, 0.984, 0.965, 0.94, 0.909, 0.873, 0.83,
  0.781, 0.723, 0.659, 0.58, 0.481, 0.347, 0.043,
]

describe('the silhouette matches the icon', () => {
  it('follows the measured width profile', () => {
    for (const [index, expected] of ICON_PROFILE.entries()) {
      const height = index / (ICON_PROFILE.length - 1)
      expect(widthAt(BODY, height), `height ${height.toFixed(2)}`).toBeCloseTo(expected, 1)
    }
  })

  it('is widest at the waist, not at the base', () => {
    // The single most consequential fact about this shape. A dome is widest
    // where it meets the desk; a mochi bulges above it and tucks back under.
    let widest = 0
    let widestAt = 0
    for (let i = 0; i <= 200; i++) {
      const height = i / 200
      const width = widthAt(BODY, height)
      if (width > widest) {
        widest = width
        widestAt = height
      }
    }
    expect(widestAt).toBeCloseTo(FACE.waist, 1)
    expect(widthAt(BODY, 0)).toBeLessThan(0.1)
  })

  it('keeps the icon aspect ratio', () => {
    expect(FACE.bodyW / FACE.bodyH).toBeCloseTo(1.281, 1)
  })

  it('is pointier than an ellipse above the waist and fuller below', () => {
    // The two exponents straddle 2 and that is what gives the shape its
    // character: a soft peak over a heavy, late-turning underside. Equal
    // exponents of 2 would be an egg, and an egg is not this.
    expect(FACE.upperShoulder).toBeLessThan(2)
    expect(FACE.lowerShoulder).toBeGreaterThan(2)
  })
})

describe('squashed', () => {
  it('preserves area, which is what makes it read as dough', () => {
    for (const amount of [-0.5, -0.2, 0, 0.2, 0.5, 0.9]) {
      expect(area(squashed(BODY, amount))).toBeCloseTo(area(BODY), 6)
    }
  })

  it('widens and shortens on a positive squash', () => {
    const flat = squashed(BODY, 0.3)
    expect(flat.halfWidth).toBeGreaterThan(BODY.halfWidth)
    expect(flat.height).toBeLessThan(BODY.height)
  })

  it('refuses a squash that would divide by zero', () => {
    const extreme = squashed(BODY, -1)
    expect(Number.isFinite(extreme.height)).toBe(true)
    expect(extreme.halfWidth).toBeGreaterThan(0)
  })

  it('treats a non-finite amount as no squash', () => {
    expect(squashed(BODY, Number.NaN)).toEqual(BODY)
  })

  it('leaves the profile shape alone — only the scale changes', () => {
    // Squash must not deform her into a different creature. The normalised
    // width profile is scale-free, so it has to survive untouched.
    const flat = squashed(BODY, 0.4)
    for (let i = 0; i <= 10; i++) {
      expect(widthAt(flat, i / 10)).toBeCloseTo(widthAt(BODY, i / 10), 10)
    }
  })
})

describe('widthAt', () => {
  it('is zero at both ends and one at the waist', () => {
    expect(widthAt(BODY, 0)).toBeCloseTo(0, 6)
    expect(widthAt(BODY, 1)).toBeCloseTo(0, 6)
    expect(widthAt(BODY, FACE.waist)).toBeCloseTo(1, 6)
  })

  it('clamps heights outside the body', () => {
    expect(widthAt(BODY, -1)).toBeCloseTo(0, 6)
    expect(widthAt(BODY, 2)).toBeCloseTo(0, 6)
  })

  it('degenerates to a half-ellipse when the waist is at the base', () => {
    const dome = { ...BODY, waist: 0, upperShoulder: 2 }
    for (const height of [0.25, 0.5, 0.75]) {
      expect(widthAt(dome, height)).toBeCloseTo(Math.sqrt(1 - height * height), 6)
    }
  })
})

describe('domeOutline', () => {
  it('rests on y = 0 with the whole body above it', () => {
    const points = domeOutline(BODY)
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0, 6)
    expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(BODY.height, 6)
  })

  it('stays within its half-width', () => {
    const points = domeOutline(BODY)
    for (const point of points) expect(Math.abs(point.x)).toBeLessThanOrEqual(BODY.halfWidth + 1e-6)
  })

  it('is symmetric when upright', () => {
    const xs = domeOutline(BODY).map((p) => p.x)
    expect(Math.max(...xs)).toBeCloseTo(-Math.min(...xs), 6)
  })

  it('has no duplicate points at the apex or the contact point', () => {
    // Both sit on the axis, so keeping the mirrored copy would leave a
    // zero-length segment that some rasterisers render as a stray join.
    const points = domeOutline(BODY)
    const onAxis = points.filter((p) => Math.abs(p.x) < 1e-9)
    expect(onAxis).toHaveLength(2)
  })

  it('leans the apex without moving the contact point', () => {
    const upright = domeOutline(BODY)
    const leaning = domeOutline({ ...BODY, lean: 0.5 })
    const apex = (points: readonly { x: number; y: number }[]): number =>
      points.reduce((best, p) => (p.y > best.y ? p : best), points[0]!).x
    expect(apex(leaning)).toBeGreaterThan(apex(upright) + 1)

    const contact = (points: readonly { x: number; y: number }[]): number =>
      points.reduce((best, p) => (p.y < best.y ? p : best), points[0]!).x
    expect(contact(leaning)).toBeCloseTo(contact(upright), 6)
  })

  it('samples both halves even though the waist sits low', () => {
    // The waist is at 0.295, so a naive uniform sampling would give the whole
    // underside a tenth of the points and render it as a visible polygon.
    const points = domeOutline(BODY)
    const below = points.filter((p) => p.y < BODY.height * BODY.waist)
    expect(below.length).toBeGreaterThan(20)
  })
})

describe('shearAt', () => {
  it('is zero at the base and maximal at the apex', () => {
    const leaning = { ...BODY, lean: 1 }
    expect(shearAt(leaning, 0)).toBe(0)
    expect(shearAt(leaning, leaning.height)).toBeGreaterThan(0)
  })

  it('does not run away above the apex', () => {
    const leaning = { ...BODY, lean: 1 }
    expect(shearAt(leaning, leaning.height * 10)).toBe(shearAt(leaning, leaning.height))
  })
})

describe('placeFeature', () => {
  it('at full grip, follows the body exactly', () => {
    const body = squashed(BODY, 0.4)
    const at = placeFeature(BODY, body, 0.5, 0.5, 1, 1)
    expect(at.x).toBeCloseTo(0.5 * body.halfWidth, 6)
    expect(at.y).toBeCloseTo(0.5 * body.height, 6)
  })

  it('at zero grip, ignores the deformation entirely', () => {
    const body = squashed(BODY, 0.4)
    const at = placeFeature(BODY, body, 0.5, 0.5, 0, 0)
    expect(at.x).toBeCloseTo(0.5 * BODY.halfWidth, 6)
    expect(at.y).toBeCloseTo(0.5 * BODY.height, 6)
  })

  it('at zero grip, does not slide sideways when a LEANING body squashes', () => {
    // The hole the other zero-grip test left open. `BODY` does not lean, so
    // every shear term in it was zero and the assertions held no matter which
    // frame the shear came from. With a lean, taking it from the squashed body
    // moved a feature that had asked to be left alone -- wider halfWidth over
    // shorter height, both pushing the same way.
    const leaning = { ...BODY, lean: 0.8 }
    const resting = placeFeature(leaning, leaning, 0.5, 0.5, 0, 0)
    const during = placeFeature(leaning, squashed(leaning, 0.4), 0.5, 0.5, 0, 0)
    expect(during.x).toBeCloseTo(resting.x, 6)
    expect(during.y).toBeCloseTo(resting.y, 6)
  })

  it('at full grip, still leans exactly with the squashed body', () => {
    // The other side of the same change: interpolating the shear frame must not
    // cost her the lean she is supposed to have. At grip 1 the frame IS the
    // squashed body, so this is unchanged behaviour and stays that way.
    const leaning = { ...BODY, lean: 0.8 }
    const body = squashed(leaning, 0.4)
    const at = placeFeature(leaning, body, 0.5, 0.5, 1, 1)
    expect(at.x).toBeCloseTo(0.5 * body.halfWidth + shearAt(body, 0.5 * body.height), 6)
  })

  it('between the two, resists without escaping', () => {
    const body = squashed(BODY, 0.4)
    const loose = placeFeature(BODY, body, 0.5, 0.5, 0, 0)
    const gripped = placeFeature(BODY, body, 0.5, 0.5, 0.82, 0.82)
    const stuck = placeFeature(BODY, body, 0.5, 0.5, 1, 1)
    expect(gripped.x).toBeGreaterThan(loose.x)
    expect(gripped.x).toBeLessThan(stuck.x)
  })
})
