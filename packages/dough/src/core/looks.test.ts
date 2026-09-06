import { describe, expect, it } from 'vitest'
import { EMOTIONS } from '@shared/avatar'
import { LOOKS, NEUTRAL, blendLook } from './looks'
import { lidScale } from './face'

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
      expect(lidScale(look.eyeLower, 1), `${emotion} lower`).toBeGreaterThanOrEqual(0.04)
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
    for (const emotion of EMOTIONS) {
      const look = LOOKS[emotion]
      expect(lidScale(look.eyeUpper, 0), emotion).toBe(look.eyeUpper)
    }
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
