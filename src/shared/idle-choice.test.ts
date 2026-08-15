/**
 * The idle choices as they travel: to a `<select>`, back, and through storage.
 *
 * Separate from `companion.test.ts`, which drives the state machine. These are
 * about the CONVERSION -- and the conversion exists only because `select` keys
 * by string while the values are durations and a `null`. The risk it carries is
 * the one this project keeps paying for: two lists that must agree.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IDLE_MS,
  IDLE_CHOICES,
  describeIdleChoices,
  idleFromKey,
  idleKey,
  isIdleChoice,
} from './companion'

describe('idle choices', () => {
  /**
   * The property that makes the derived key type worth having. If a duration is
   * ever added to `IDLE_CHOICES` and the round trip is broken for it, this
   * fails without anybody having to remember to extend a fixture.
   */
  it('round-trips every choice through its select key', () => {
    for (const choice of IDLE_CHOICES) {
      expect(idleFromKey(idleKey(choice)), `${String(choice)} did not survive`).toBe(choice)
    }
  })

  it('keys never as a word, not as a number', () => {
    expect(idleKey(null)).toBe('never')
    // The others must not collide with it, or two options would share a value
    // and the select would show one of them twice.
    expect(new Set(IDLE_CHOICES.map(idleKey)).size).toBe(IDLE_CHOICES.length)
  })

  describe('isIdleChoice', () => {
    it('accepts every member, including never', () => {
      for (const choice of IDLE_CHOICES) expect(isIdleChoice(choice)).toBe(true)
      expect(isIdleChoice(null)).toBe(true)
    })

    /**
     * A hand-edited preferences file is the only way this arrives, and it is a
     * plausible one: two minutes is a reasonable thing to want and not a
     * choice the pane can display. Accepting it would leave the select showing
     * some other value while the machine used this one.
     */
    it('rejects a duration that is not on the list', () => {
      expect(isIdleChoice(120_000)).toBe(false)
      expect(isIdleChoice(0)).toBe(false)
      expect(isIdleChoice(-90_000)).toBe(false)
    })

    /** `undefined` is absence, which is NOT the same as `null`'s "never". */
    it('rejects absence, so an old file falls back rather than never sleeping', () => {
      expect(isIdleChoice(undefined)).toBe(false)
      expect(isIdleChoice('90000')).toBe(false)
      expect(isIdleChoice('never')).toBe(false)
    })
  })

  it('describes the allowed values from the tuple', () => {
    const described = describeIdleChoices()
    for (const choice of IDLE_CHOICES) {
      expect(described).toContain(choice === null ? 'null' : String(choice))
    }
  })

  it('offers the default as one of the choices', () => {
    // Otherwise the pane would open showing a value it cannot represent.
    expect((IDLE_CHOICES as readonly (number | null)[]).includes(DEFAULT_IDLE_MS)).toBe(true)
  })
})
