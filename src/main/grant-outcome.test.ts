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
    expect(grantOutcome({ writtenFor: 'ada', live: null, told: false, pronoun: 'she' })).toEqual({
      ok: true,
    })
  })

  it('is in force when the live session is the character it was written for', () => {
    expect(grantOutcome({ writtenFor: 'ada', live: 'ada', told: true, pronoun: 'she' })).toEqual({
      ok: true,
    })
  })

  it('does not claim success when she is speaking as somebody else', () => {
    /*
      THE BUG.

      The shelf can change who is worn while a session is up. The panel writes
      for the worn character; dispatch consults the character the session was
      configured as. Revoking a capability in that window changed nothing about
      the session actually running, and the handler returned ok.
    */
    const outcome = grantOutcome({
      writtenFor: 'newly-worn',
      live: 'still-speaking',
      told: true,
      pronoun: 'she',
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.why).toContain('another character')
    expect(outcome.ok === false && outcome.why).toContain('next wake')
  })

  it('says so even when the frame was delivered', () => {
    // `told` is not the question. The frame reached a session governed by a
    // different character's permissions, so a success here would be the most
    // misleading answer available.
    expect(grantOutcome({ writtenFor: 'a', live: 'b', told: true, pronoun: 'she' }).ok).toBe(false)
    expect(grantOutcome({ writtenFor: 'a', live: 'b', told: false, pronoun: 'she' }).ok).toBe(false)
  })

  it('reports the ordinary undelivered case distinctly', () => {
    const outcome = grantOutcome({ writtenFor: 'ada', live: 'ada', told: false, pronoun: 'she' })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.why).toContain('could not be told')
  })

  it('gives the two failures different words', () => {
    // They have different remedies -- one waits for a wake, the other is a
    // delivery fault worth reporting -- so a person must be able to tell them
    // apart from the sentence alone.
    const mismatch = grantOutcome({ writtenFor: 'a', live: 'b', told: true, pronoun: 'she' })
    const undelivered = grantOutcome({ writtenFor: 'a', live: 'a', told: false, pronoun: 'she' })
    expect(mismatch.ok === false && mismatch.why).not.toBe(
      undelivered.ok === false && undelivered.why,
    )
  })
})

describe('the words it uses for her', () => {
  it('takes the pronoun rather than assuming one', () => {
    /*
      Both sentences named a `she` while this function had no character in hand,
      so a `he/him` character was told "she is still speaking as another
      character". The pronoun is the smallest thing that makes the copy correct
      without moving it away from the argument it states.
    */
    const mismatch = (pronoun: 'she' | 'he' | 'it') =>
      grantOutcome({ writtenFor: 'a', live: 'b', told: true, pronoun })
    expect(mismatch('he')).toEqual({
      ok: false,
      why: 'Saved. He is still speaking as another character, so it applies from his next wake.',
    })
    expect(mismatch('it')).toEqual({
      ok: false,
      why: 'Saved. It is still speaking as another character, so it applies from its next wake.',
    })
  })

  it('uses it for the undelivered case too, which was the other missed one', () => {
    const undelivered = (pronoun: 'she' | 'he' | 'it') =>
      grantOutcome({ writtenFor: 'a', live: 'a', told: false, pronoun })
    expect(undelivered('he')).toEqual({
      ok: false,
      why: 'Saved, but he could not be told just now — it applies from his next wake.',
    })
    expect(undelivered('it')).toEqual({
      ok: false,
      why: 'Saved, but it could not be told just now — it applies from its next wake.',
    })
  })
})
