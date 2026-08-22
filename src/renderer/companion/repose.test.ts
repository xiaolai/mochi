import { describe, expect, it } from 'vitest'
import { createRepose, LOOK_AFTER_S, SWING_AFTER_S, WANDER_AFTER_S, type Repose } from './repose'

/**
 * What she does when nothing is happening.
 *
 * The property worth testing is not which number each rung sits at — those are
 * taste and will be retuned — but that the ladder only ever climbs while
 * nothing is happening, and falls all the way down the moment something does.
 */

/** Run `seconds` of quiet through it, collecting every glance it emitted. */
function quiet(r: Repose, seconds: number, step = 0.5): { loops: string[]; looks: number } {
  const loops: string[] = []
  let looks = 0
  for (let t = 0; t < seconds; t += step) {
    const out = r.step(step, false)
    loops.push(out.loop)
    if (out.look) looks += 1
  }
  return { loops, looks }
}

describe('the ladder', () => {
  it('does nothing at all while something is happening', () => {
    const r = createRepose()
    for (let t = 0; t < WANDER_AFTER_S * 2; t += 0.5) {
      const out = r.step(0.5, true)
      expect(out.loop).toBe('none')
      expect(out.look).toBe(false)
    }
  })

  it('climbs in order, and never skips a rung backwards', () => {
    const r = createRepose()
    const { loops } = quiet(r, WANDER_AFTER_S + 5)
    const rank = { none: 0, swing: 1, wander: 2 }
    let highest = 0
    for (const one of loops) {
      const here = rank[one as keyof typeof rank]
      // Monotonic while nothing happens. A rung that could fall on its own
      // would make her start and stop wandering while the room stayed empty.
      expect(here).toBeGreaterThanOrEqual(highest)
      highest = here
    }
    expect(loops.at(-1)).toBe('wander')
  })

  it('glances exactly once per stretch of quiet', () => {
    // The one-shot property, and the reason `look` is not a state: there is one
    // motion slot, so a caller treating a glance as a state would stop it again
    // on the next frame.
    const r = createRepose()
    expect(quiet(r, WANDER_AFTER_S + 5).looks).toBe(1)
  })

  it('glances before it swings, and swings before it wanders', () => {
    expect(LOOK_AFTER_S).toBeLessThan(SWING_AFTER_S)
    expect(SWING_AFTER_S).toBeLessThan(WANDER_AFTER_S)
  })

  it('keeps the loudest rung far from the one below it', () => {
    // Wandering is the only ambient motion that takes her anywhere, and
    // `plan-v2.md` records the argument: a companion who moves unbidden is one
    // that cannot be ignored. The gap is the guard on that, so a retune that
    // brings them together has to face this line.
    expect(WANDER_AFTER_S - SWING_AFTER_S).toBeGreaterThan(SWING_AFTER_S)
  })
})

describe('anything happening', () => {
  it('takes her all the way down, on the frame it happens', () => {
    const r = createRepose()
    quiet(r, WANDER_AFTER_S + 5)
    // Not a decay. Ambient motion continuing for even a moment into her being
    // spoken to reads as her not having noticed.
    expect(r.step(0.5, true).loop).toBe('none')
    expect(r.step(0.5, false).loop).toBe('none')
  })

  it('lets her glance again once the room has been quiet again', () => {
    const r = createRepose()
    expect(quiet(r, LOOK_AFTER_S + 1).looks).toBe(1)
    r.step(0.5, true)
    expect(quiet(r, LOOK_AFTER_S + 1).looks).toBe(1)
  })

  it('is reset by hand the same way it is reset by being busy', () => {
    const r = createRepose()
    quiet(r, WANDER_AFTER_S + 5)
    r.reset()
    expect(r.step(0.5, false).loop).toBe('none')
  })
})

describe('a frame delta that is not a duration', () => {
  it('does not climb on it, and does not poison the count', () => {
    /*
      A throttled or backgrounded window hands back whatever elapsed, and
      `NaN` would make every comparison false for the rest of the session —
      she would never wander again and nothing would say why.
    */
    const r = createRepose()
    for (const bad of [Number.NaN, Infinity, -5, 0]) {
      expect(r.step(bad, false).loop).toBe('none')
    }
    // Still counts real time afterwards.
    expect(quiet(r, WANDER_AFTER_S + 5).loops.at(-1)).toBe('wander')
  })
})
