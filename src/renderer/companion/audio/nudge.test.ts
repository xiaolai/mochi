import { describe, expect, it } from 'vitest'
import { createNudge } from './nudge'

describe('asking her to volunteer a late answer', () => {
  it('asks immediately when she is not speaking', () => {
    /*
      THE case, and the one the log showed failing.

      The answer landed 25 seconds after she said "just a tiny moment more",
      into a silent room, and was never spoken because nothing asked for a turn.
    */
    const nudge = createNudge()
    expect(nudge.wanted()).toBe(true)
    expect(nudge.waiting()).toBe(false)
  })

  it('does NOT ask while she is mid-sentence', () => {
    // §1 measured the refusal — `conversation_already_has_active_response` —
    // and measured it as intermittent, which is why this does not simply try.
    const nudge = createNudge()
    nudge.sounding(true)
    expect(nudge.wanted()).toBe(false)
    expect(nudge.waiting()).toBe(true)
  })

  it('asks the moment she stops', () => {
    const nudge = createNudge()
    nudge.sounding(true)
    nudge.wanted()
    expect(nudge.sounding(false)).toBe(true)
    expect(nudge.waiting()).toBe(false)
  })

  it('asks once however many answers arrived while she talked', () => {
    /*
      Two lookups can be outstanding at once. The turn she takes carries the
      whole conversation, so both results are in it — and a second
      `response.create` queued behind the first is exactly the refusal this
      module exists to avoid.
    */
    const nudge = createNudge()
    nudge.sounding(true)
    nudge.wanted()
    nudge.wanted()
    nudge.wanted()
    expect(nudge.sounding(false)).toBe(true)
    expect(nudge.sounding(true)).toBe(false)
    expect(nudge.sounding(false)).toBe(false)
  })

  it('does not ask on a stop that nothing was waiting for', () => {
    // Every utterance she finishes ends with a stop. Without this she would be
    // asked for a fresh turn after every single one, for ever.
    const nudge = createNudge()
    nudge.sounding(true)
    expect(nudge.sounding(false)).toBe(false)
  })

  it('does not ask on a repeated stop', () => {
    // `stopped` and `cleared` can both arrive for one utterance, and a session
    // that was never sounding must not treat a stray stop as a moment to speak.
    const nudge = createNudge()
    nudge.sounding(true)
    nudge.wanted()
    expect(nudge.sounding(false)).toBe(true)
    expect(nudge.sounding(false)).toBe(false)
  })

  it('treats an interruption as a moment she is free', () => {
    /*
      A barge-in arrives as `cleared` rather than `stopped`, and the caller
      passes both as `sounding(false)`. She really has stopped talking, so a
      waiting answer may go — the user just took the floor and is the one most
      likely to want it.
    */
    const nudge = createNudge()
    nudge.sounding(true)
    nudge.wanted()
    expect(nudge.sounding(false)).toBe(true)
  })

  it('keeps waiting across a whole utterance she began after the answer landed', () => {
    // Answer lands mid-sentence, she finishes, and only then is the turn asked
    // for — not swallowed by the utterance that was already running.
    const nudge = createNudge()
    nudge.sounding(true)
    expect(nudge.wanted()).toBe(false)
    expect(nudge.waiting()).toBe(true)
    expect(nudge.sounding(false)).toBe(true)
  })
})
