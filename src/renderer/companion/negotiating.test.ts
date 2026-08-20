import { describe, expect, it } from 'vitest'
import { keepsNewer } from './negotiating'

/**
 * The rule that stops a stale snapshot winning, in both directions.
 *
 * The values here are the real ones: `asleep` is the boolean that held her eyes
 * shut through an utterance in one direction and left her microphone open after
 * she was told to rest in the other.
 */
describe('what survives a negotiation', () => {
  it('takes the snapshot when nothing arrived while it was being fetched', () => {
    // The ordinary case, and the one that must not regress into always ignoring
    // the snapshot: on a first connect there is nothing else to go on.
    expect(keepsNewer(true, false, false)).toBe(true)
    expect(keepsNewer(false, true, false)).toBe(false)
    expect(keepsNewer(7, 0, false)).toBe(7)
  })

  it('takes what arrived, in both directions', () => {
    // Woken mid-negotiation: the snapshot says asleep, the live value says awake.
    expect(keepsNewer(true, false, true)).toBe(false)
    // Told to rest mid-negotiation: the snapshot says awake. This is the
    // direction that leaves a microphone open, so it is not merely symmetry.
    expect(keepsNewer(false, true, true)).toBe(true)
  })

  it('takes what arrived even when it equals the snapshot', () => {
    // Toggled off and on during one negotiation. The values agree, and taking
    // the snapshot would be right by accident — but the caller counts EVENTS
    // rather than comparing values precisely so that this case and "nothing was
    // ever sent" are not confused.
    expect(keepsNewer(true, true, true)).toBe(true)
  })

  it('carries any value, not just a flag', () => {
    // `problems` is a count and `bubbleSide` is a string; both had the same bug.
    expect(keepsNewer('above', 'left', true)).toBe('left')
    expect(keepsNewer(0, 3, true)).toBe(3)
  })
})
