import { describe, expect, it } from 'vitest'

import { padChange } from './pad-change'

/**
 * Grow at once, shrink only after it has stayed wanted.
 *
 * ## Why this test did not exist before
 *
 * The rule lived inside the `showFace` closure in `face.ts`, a module that
 * resolves a palette off `document` at load and therefore cannot be imported.
 * Nothing in the suite reached it — and it is the rule that decides how often
 * her window resizes, which is the flicker the whole pad arrangement exists to
 * avoid.
 */
const pad = { left: 10, top: 10, right: 10, bottom: 10 }

describe('when the pad she needs has not changed', () => {
  it('does nothing and forgets any shrink that was pending', () => {
    const settled = padChange(pad, { ...pad }, 500, 1_000)
    expect(settled.apply).toBe(false)
    // Cleared, not preserved: the shrink it was waiting on is no longer wanted.
    expect(settled.shrinkWantedSince).toBeNull()
  })
})

describe('when she needs more room', () => {
  it('grows on the same frame, in every direction', () => {
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      const wanted = { ...pad, [side]: pad[side] + 1 }
      const settled = padChange(pad, wanted, null, 0)
      expect(settled.apply, side).toBe(true)
      expect(settled.shrinkWantedSince, side).toBeNull()
    }
  })

  it('grows at once even while a shrink was already pending', () => {
    // Growing late clips what is being drawn, so a pending shrink must not
    // delay a grow that arrives during it.
    const settled = padChange(pad, { ...pad, top: 40 }, 0, 10)
    expect(settled.apply).toBe(true)
  })
})

describe('when she needs less room', () => {
  it('waits, and starts the clock on the first frame that wants it', () => {
    const settled = padChange(pad, { ...pad, bottom: 2 }, null, 1_000)
    expect(settled.apply).toBe(false)
    expect(settled.shrinkWantedSince).toBe(1_000)
  })

  it('keeps waiting, and does not restart the clock', () => {
    const settled = padChange(pad, { ...pad, bottom: 2 }, 1_000, 1_300)
    expect(settled.apply).toBe(false)
    // The same instant it started, not `now` — restarting here would mean a
    // shrink that is wanted continuously never settles.
    expect(settled.shrinkWantedSince).toBe(1_000)
  })

  it('shrinks once it has stayed wanted for the settle time', () => {
    const settled = padChange(pad, { ...pad, bottom: 2 }, 1_000, 1_400)
    expect(settled.apply).toBe(true)
    expect(settled.shrinkWantedSince).toBeNull()
  })

  it('does not shrink one millisecond early', () => {
    // The boundary, stated: 400ms is the settle time, so 399 must still wait.
    expect(padChange(pad, { ...pad, bottom: 2 }, 1_000, 1_399).apply).toBe(false)
  })
})
