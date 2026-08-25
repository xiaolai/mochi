import { describe, expect, it } from 'vitest'

import { grantOutcome } from './grant-outcome'

/**
 * The claim the panel is allowed to make.
 *
 * The case worth the file is `live !== writtenFor`: the switch moved, the
 * window said the change was in force, and the capability went on running.
 */

describe('what the panel may claim after saving', () => {
  it('is in force when nobody is speaking', () => {
    // Asleep, or never woken. The next wake reads it from disk.
    expect(grantOutcome({ writtenFor: 'ada', live: null, told: false })).toEqual({ ok: true })
  })

  it('is in force when the live session is the character it was written for', () => {
    expect(grantOutcome({ writtenFor: 'ada', live: 'ada', told: true })).toEqual({ ok: true })
  })

  it('does not claim success when she is speaking as somebody else', () => {
    /*
      THE BUG.

      The shelf can change who is worn while a session is up. The panel writes
      for the worn character; dispatch consults the character the session was
      configured as. Revoking a capability in that window changed nothing about
      the session actually running, and the handler returned ok.
    */
    const outcome = grantOutcome({ writtenFor: 'newly-worn', live: 'still-speaking', told: true })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.why).toContain('another character')
    expect(outcome.ok === false && outcome.why).toContain('next wake')
  })

  it('says so even when the frame was delivered', () => {
    // `told` is not the question. The frame reached a session governed by a
    // different character's permissions, so a success here would be the most
    // misleading answer available.
    expect(grantOutcome({ writtenFor: 'a', live: 'b', told: true }).ok).toBe(false)
    expect(grantOutcome({ writtenFor: 'a', live: 'b', told: false }).ok).toBe(false)
  })

  it('reports the ordinary undelivered case distinctly', () => {
    const outcome = grantOutcome({ writtenFor: 'ada', live: 'ada', told: false })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.why).toContain('could not be told')
  })

  it('gives the two failures different words', () => {
    // They have different remedies -- one waits for a wake, the other is a
    // delivery fault worth reporting -- so a person must be able to tell them
    // apart from the sentence alone.
    const mismatch = grantOutcome({ writtenFor: 'a', live: 'b', told: true })
    const undelivered = grantOutcome({ writtenFor: 'a', live: 'a', told: false })
    expect(mismatch.ok === false && mismatch.why).not.toBe(
      undelivered.ok === false && undelivered.why,
    )
  })
})
