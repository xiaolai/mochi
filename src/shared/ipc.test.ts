import { describe, expect, it } from 'vitest'
import { COMPANION_CHANNELS, isCompanionChannel } from './ipc'

describe('isCompanionChannel', () => {
  it('accepts every channel that is actually declared', () => {
    for (const channel of COMPANION_CHANNELS) {
      expect(isCompanionChannel(channel)).toBe(true)
    }
  })

  it('rejects a name that only looks like one', () => {
    expect(isCompanionChannel('companion:pong')).toBe(false)
    expect(isCompanionChannel('companion:')).toBe(false)
    expect(isCompanionChannel('companion:ping ')).toBe(false)
  })

  it('rejects values that are not strings instead of coercing them', () => {
    // The far side of this boundary is a web page, so the guard is reached with
    // whatever that page chose to send — not only with the type it promised.
    for (const value of [null, undefined, 42, {}, ['companion:ping']]) {
      expect(isCompanionChannel(value)).toBe(false)
    }
  })

  it('rejects inherited object keys', () => {
    // This is the assertion that survives a refactor. `includes` on an array
    // gets it right for free, but the obvious "faster" rewrite — a lookup object
    // tested with `map[name] !== undefined` — answers true for `constructor` and
    // `toString`, and would open channels nobody declared. The test is aimed at
    // the rewrite, not at today's implementation.
    for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(isCompanionChannel(key)).toBe(false)
    }
  })
})
