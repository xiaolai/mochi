import { describe, expect, it } from 'vitest'
import { EMOTIONS } from '@shared/avatar'
import { LOOKS, NEUTRAL, blendLook } from './looks'

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
