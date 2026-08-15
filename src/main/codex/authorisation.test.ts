import { beforeEach, describe, expect, it } from 'vitest'
import {
  AUTHORISATION_WINDOW_MS,
  authoriseDelegation,
  clearAuthorisation,
  isAuthorised,
  renewAuthorisation,
  takeAuthorisation,
} from './authorisation'

const T0 = Date.UTC(2026, 7, 15, 12, 0, 0)

beforeEach(() => {
  clearAuthorisation()
})

describe('under hotkey', () => {
  it('refuses when no key was pressed', () => {
    expect(takeAuthorisation('hotkey', T0)).toBeNull()
  })

  it('allows one run after a press', () => {
    authoriseDelegation(T0)
    expect(takeAuthorisation('hotkey', T0 + 1_000)).toBe('press')
  })

  /**
   * Single use is the point. A press that stayed valid would drift into "read
   * whenever it likes", which is the OTHER setting -- reachable deliberately,
   * never by accident.
   */
  it('spends the press, so a second run needs a second press', () => {
    authoriseDelegation(T0)
    expect(takeAuthorisation('hotkey', T0 + 1_000)).toBe('press')
    expect(takeAuthorisation('hotkey', T0 + 2_000)).toBeNull()
  })

  /** Press, get distracted, come back to another conversation: not authorised. */
  it('expires', () => {
    authoriseDelegation(T0)
    expect(isAuthorised(T0 + AUTHORISATION_WINDOW_MS + 1)).toBe(false)
    expect(takeAuthorisation('hotkey', T0 + AUTHORISATION_WINDOW_MS + 1)).toBeNull()
  })

  it('is still good at the edge of the window', () => {
    authoriseDelegation(T0)
    expect(takeAuthorisation('hotkey', T0 + AUTHORISATION_WINDOW_MS)).toBe('press')
  })
})

/**
 * Measured: the user asked about an article, got an answer, then asked for
 * a detailed outline -- and that follow-up landed on a spent press. The refusal
 * came back in a millisecond and she explained it as the SOURCE refusing her.
 *
 * A follow-up is the same errand, so an answer buys the window for one.
 */
describe('the follow-up window', () => {
  it('lets a follow-up run without a second press', () => {
    authoriseDelegation(T0)
    expect(takeAuthorisation('hotkey', T0 + 1_000)).toBe('press')
    renewAuthorisation('press', T0 + 40_000)
    expect(takeAuthorisation('hotkey', T0 + 50_000)).toBe('press')
  })

  /**
   * A renewal is a press-shaped thing, so it is single use for the same reason
   * a press is. Without this, one answer would authorise every later run.
   */
  it('is spent by the follow-up it authorised', () => {
    renewAuthorisation('press', T0)
    expect(takeAuthorisation('hotkey', T0 + 1_000)).toBe('press')
    expect(takeAuthorisation('hotkey', T0 + 2_000)).toBeNull()
  })

  /**
   * SILENCE is what ends the chain, and it has to actually end it. A renewal
   * that never expired would be `anytime` arrived at by accident, which is the
   * setting next door rather than somewhere to drift to.
   */
  it('expires like a press, so a minute of silence ends the chain', () => {
    renewAuthorisation('press', T0)
    expect(takeAuthorisation('hotkey', T0 + AUTHORISATION_WINDOW_MS + 1)).toBeNull()
  })

  /** Cancelling or quitting must not leave a renewed window open behind it. */
  it('is dropped by clearAuthorisation', () => {
    renewAuthorisation('press', T0)
    clearAuthorisation()
    expect(isAuthorised(T0 + 1_000)).toBe(false)
  })

  /**
   * The hole the first version of renewal shipped with, found by audit.
   *
   * Under `anytime` no key is ever pressed, so an answer has no press to renew
   * -- but the first version stamped one anyway. Switch back to `hotkey` inside
   * the window and that stamp is a free read the user never authorised, which
   * is precisely what `does not bank a press for a later hotkey run` below
   * forbids for presses. Renewal was a second door into the same room.
   */
  it('does not mint a press for a run that anytime admitted', () => {
    const basis = takeAuthorisation('anytime', T0)
    expect(basis).toBe('anytime')
    renewAuthorisation(basis!, T0 + 1_000)
    expect(isAuthorised(T0 + 2_000), 'anytime banked a press').toBe(false)
    expect(takeAuthorisation('hotkey', T0 + 2_000)).toBeNull()
  })
})

describe('under anytime', () => {
  it('allows a run with no press at all', () => {
    expect(takeAuthorisation('anytime', T0)).toBe('anytime')
  })

  /**
   * A press made while `anytime` was on must not survive a switch back to
   * `hotkey`. Otherwise loosening the setting and tightening it again leaves one
   * free read banked, which nobody asked for and nobody can see.
   */
  it('does not bank a press for a later hotkey run', () => {
    authoriseDelegation(T0)
    expect(takeAuthorisation('anytime', T0 + 1_000)).toBe('anytime')
    expect(takeAuthorisation('hotkey', T0 + 2_000)).toBeNull()
  })
})

describe('isAuthorised', () => {
  it('reports without spending', () => {
    authoriseDelegation(T0)
    expect(isAuthorised(T0 + 1_000)).toBe(true)
    expect(isAuthorised(T0 + 1_000)).toBe(true)
    expect(takeAuthorisation('hotkey', T0 + 1_000)).toBe('press')
  })

  it('is false once cleared', () => {
    authoriseDelegation(T0)
    clearAuthorisation()
    expect(isAuthorised(T0 + 1_000)).toBe(false)
  })
})
