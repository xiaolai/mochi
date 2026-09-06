import { describe, expect, it } from 'vitest'
import { EMOTIONS } from './vocabulary'
import { LOOKS, NEUTRAL, blendLook } from './looks'
import { PLAIN } from './plain'
import { lidPair, lidScale } from '../canvas2d/face'

/**
 * A shut eye is a hairline, and it stays one whatever she is wearing.
 *
 * The floor used to sit on the blink alone, which holds only while the
 * expression leaves the eye at full height. `sleepy` takes the arcs to 0.16
 * before the blink applies, so a held blink produced six thousandths of an eye
 * and she slept with no eyes rather than closed ones — reachable the day
 * `sleepy` became the rest pose, and not one day before.
 */
describe('a lid never closes to nothing', () => {
  it('keeps a hairline for EVERY emotion at full blink', () => {
    for (const emotion of EMOTIONS) {
      const look = LOOKS[emotion]
      expect(lidScale(look.eyeUpper, 1), `${emotion} upper`).toBeGreaterThanOrEqual(0.04)
      expect(Math.abs(lidScale(look.eyeLower, 1)), `${emotion} lower`).toBeGreaterThanOrEqual(0.04)
    }
  })

  it('is the SLEEPING case that this exists for', () => {
    // The specimen, named: 0.16 * 0.04 is what she used to sleep with.
    expect(LOOKS.sleepy.eyeUpper).toBeLessThan(0.2)
    expect(LOOKS.sleepy.eyeUpper * 0.04).toBeLessThan(0.01)
    expect(lidScale(LOOKS.sleepy.eyeUpper, 1)).toBe(0.04)
  })

  it('leaves an open eye alone', () => {
    // The floor must not become a change to how she looks awake.
    //
    // BOTH lids, and the lower one is the point. This checked `eyeUpper` only,
    // which is positive for all eight emotions -- so a floor that discarded
    // the sign passed here while flattening every crescent in the table.
    for (const emotion of EMOTIONS) {
      const look = LOOKS[emotion]
      expect(lidScale(look.eyeUpper, 0), `${emotion} upper`).toBe(look.eyeUpper)
      expect(lidScale(look.eyeLower, 0), `${emotion} lower`).toBe(look.eyeLower)
    }
  })

  it('keeps a crescent a crescent', () => {
    // The `^ ^` eye is a NEGATIVE lower arc bowing above the baseline. A floor
    // applied to the signed value turns it into a flat lid, which is how
    // `happy` and `shy` lost the expression they exist for.
    expect(lidScale(LOOKS.happy.eyeLower, 0)).toBeLessThan(0)
    expect(lidScale(LOOKS.shy.eyeLower, 0)).toBeLessThan(0)
    // Half shut is half a crescent, still bowed the same way.
    expect(lidScale(LOOKS.happy.eyeLower, 0.5)).toBeCloseTo(LOOKS.happy.eyeLower / 2, 6)
    // Shut keeps the SIGN — the closed-eye shape is `lidPair`'s job, and a sign
    // flip here was a discontinuity at exactly blink 1.
    expect(lidScale(LOOKS.happy.eyeLower, 1)).toBe(-0.04)
  })

  it('closes smoothly rather than snapping to the floor', () => {
    // Half a blink is half an eye, for a look that is not already near the
    // floor -- otherwise the guard would have flattened the whole animation.
    expect(lidScale(1, 0.5)).toBeCloseTo(0.5, 6)
    expect(lidScale(1, 0.9)).toBeCloseTo(0.1, 6)
  })
})

describe('LOOKS', () => {
  it('has an entry for every canonical emotion', () => {
    for (const emotion of EMOTIONS) expect(LOOKS[emotion]).toBeDefined()
    expect(Object.keys(LOOKS).sort()).toEqual([...EMOTIONS].sort())
  })

  it('renders every non-neutral emotion differently from neutral', () => {
    // An emotion that falls through to neutral makes caps.presetExpressions a
    // lie: the backend claims to support an expression it draws identically to
    // no expression at all, and the caller cannot discover that.
    for (const emotion of EMOTIONS) {
      if (emotion === 'neutral') continue
      expect(LOOKS[emotion], emotion).not.toEqual(NEUTRAL)
    }
  })

  it('gives every emotion the same set of keys', () => {
    const expected = Object.keys(NEUTRAL).sort()
    for (const emotion of EMOTIONS) {
      expect(Object.keys(LOOKS[emotion]).sort(), emotion).toEqual(expected)
    }
  })

  it('keeps every value finite', () => {
    for (const emotion of EMOTIONS) {
      for (const [key, value] of Object.entries(LOOKS[emotion])) {
        expect(Number.isFinite(value), `${emotion}.${key}`).toBe(true)
      }
    }
  })
})

describe('blendLook', () => {
  it('is exactly neutral at intensity 0, for every emotion', () => {
    // What lets an expiring emotion decay smoothly instead of snapping.
    for (const emotion of EMOTIONS) expect(blendLook(emotion, 0)).toEqual(NEUTRAL)
  })

  it('is the raw look at intensity 1', () => {
    for (const emotion of EMOTIONS) expect(blendLook(emotion, 1)).toEqual(LOOKS[emotion])
  })

  it('lands halfway at intensity 0.5', () => {
    const half = blendLook('happy', 0.5)
    expect(half.eyeLower).toBeCloseTo((NEUTRAL.eyeLower + LOOKS.happy.eyeLower) / 2, 10)
  })

  it('clamps out-of-range intensity rather than extrapolating', () => {
    // An intensity of 2 would double the deformation and turn a smile into a
    // shape the tuner never showed anyone.
    expect(blendLook('happy', 5)).toEqual(LOOKS.happy)
    expect(blendLook('happy', -5)).toEqual(NEUTRAL)
    expect(blendLook('happy', Number.NaN)).toEqual(NEUTRAL)
  })

  it('carries happy through to a crescent eye', () => {
    // The signed lower arc is the mechanism the whole face depends on; assert
    // it survives the blend rather than only existing in the table.
    expect(blendLook('happy', 1).eyeLower).toBeLessThan(0)
    expect(blendLook('happy', 0.2).eyeLower).toBeGreaterThan(0)
  })
})

describe('lidPair', () => {
  const floorFor = (scale: number): number =>
    Math.max(Math.abs(PLAIN.eyeUpper), Math.abs(PLAIN.eyeLower)) * scale * 0.04

  it('never lets the two lids cancel into a closed eye', () => {
    /*
      The defect this exists to prevent: `lidScale` floors each lid on its own,
      but the eye's rendered height is `upper + lower`, and a crescent's lower
      is NEGATIVE. Both lids could therefore sit exactly on the floor with
      opposite signs and sum to zero — an eye of no height, which is the one
      outcome the floor exists to make impossible.

      Swept rather than spot-checked, because the window where it happened was
      only the last few percent of a blink: wide enough to land on a frame,
      narrow enough that no single chosen value would have found it.
    */
    for (const emotion of EMOTIONS) {
      const look = LOOKS[emotion]
      for (let step = 0; step <= 100; step++) {
        const blink = step / 100
        const { upper, lower } = lidPair(PLAIN, look, blink, 1)
        expect(upper + lower, `${emotion} at blink ${blink}`).toBeGreaterThanOrEqual(
          floorFor(1) - 1e-9,
        )
      }
    }
  })

  it('still bows a crescent while the eye is open', () => {
    // The floor must not buy its guarantee by flattening the expression.
    expect(lidPair(PLAIN, LOOKS.happy, 0, 1).lower).toBeLessThan(0)
    expect(lidPair(PLAIN, LOOKS.shy, 0, 1).lower).toBeLessThan(0)
  })

  it('scales the floor with the render scale', () => {
    const shut = lidPair(PLAIN, LOOKS.happy, 1, 3)
    expect(shut.upper + shut.lower).toBeCloseTo(floorFor(3), 9)
  })
})

describe('lidPair on a narrow crescent face', () => {
  /*
    A face the format accepts whose lids very nearly cancel: its whole open eye
    is 0.2 units tall. The first version of the floor was measured against the
    SUM OF MAGNITUDES — 7.8 units here — so the floor was larger than the eye
    and flattened it at blink zero, in the neutral pose, before anything had
    even blinked. Measured against the resting span it is 0.008, and the eye is
    left alone.
  */
  const CRESCENT = { ...PLAIN, eyeUpper: 4, eyeLower: -3.8 }
  const plainFloor = Math.max(Math.abs(PLAIN.eyeUpper), Math.abs(PLAIN.eyeLower)) * 0.04

  it('leaves a legitimately narrow eye alone at rest', () => {
    const rest = lidPair(CRESCENT, NEUTRAL, 0, 1)
    expect(rest.upper).toBeCloseTo(4, 9)
    expect(rest.lower).toBeCloseTo(-3.8, 9)
  })

  it('keeps the lower edge bowed while the top arc is tall enough', () => {
    // Lifting the bottom edge must not turn a crescent into a flat sliver the
    // moment the floor engages; it stays bowed until the top arc itself shrinks
    // past the floor.
    const mid = lidPair(PLAIN, LOOKS.happy, 0.9, 1)
    expect(mid.upper + mid.lower).toBeGreaterThanOrEqual(plainFloor - 1e-9)
    expect(mid.lower).toBeLessThan(0)
  })

  it('moves continuously across the point where the floor engages', () => {
    // The defect this replaces snapped the eye's midpoint across the eye in one
    // frame. Sampled either side of the crossing, nothing may jump.
    let previous = lidPair(PLAIN, LOOKS.happy, 0, 1)
    for (let step = 1; step <= 2000; step++) {
      const current = lidPair(PLAIN, LOOKS.happy, step / 2000, 1)
      expect(Math.abs(current.upper - previous.upper)).toBeLessThan(0.05)
      expect(Math.abs(current.lower - previous.lower)).toBeLessThan(0.05)
      previous = current
    }
  })
})

describe('lidPair at the closed endpoint', () => {
  /*
    Blink reaches exactly 1 on real frames — `blinkAt` returns it at the peak —
    so the endpoint is not a limit nobody visits. Two faces that previously
    broke there: one whose lids cancel exactly, which rendered zero pixels, and
    one narrow crescent, whose lower extent jumped by twice the floor.
  */
  const CANCELLING = { ...PLAIN, eyeUpper: 4, eyeLower: -4 }
  const NARROW = { ...PLAIN, eyeUpper: 4, eyeLower: -3.8 }

  it('still paints an eye for a face whose lids cancel exactly', () => {
    for (const blink of [0, 0.5, 1]) {
      const { upper, lower } = lidPair(CANCELLING, NEUTRAL, blink, 1)
      expect(upper + lower, `blink ${blink}`).toBeGreaterThan(0)
    }
  })

  it('does not jump as blink reaches exactly 1', () => {
    for (const face of [PLAIN, NARROW, CANCELLING]) {
      for (const look of [NEUTRAL, LOOKS.happy, LOOKS.shy]) {
        const just = lidPair(face, look, 1 - 1e-9, 1)
        const shut = lidPair(face, look, 1, 1)
        expect(Math.abs(shut.upper - just.upper)).toBeLessThan(1e-6)
        expect(Math.abs(shut.lower - just.lower)).toBeLessThan(1e-6)
      }
    }
  })
})
