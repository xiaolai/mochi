import { describe, expect, it } from 'vitest'
import { createPending } from './pending'

describe('both arrival orders produce the same turn', () => {
  // The whole reason this module exists. Cut at ~6s and the truncation arrives
  // first (13 of 13 runs); cut at 32s and the transcript beats it by half a
  // second because generation had finished. Two sequences, one expectation.
  it('truncation first, then the transcript', () => {
    const p = createPending()
    expect(p.truncated('i1', 1000)).toBeNull()
    expect(p.said('i1', 'the whole story')).toEqual({
      transcript: 'the whole story',
      interruptedAt: 1000,
    })
  })

  it('transcript first, then the truncation', () => {
    const p = createPending()
    // Filed at once, because most turns are never interrupted and no frame
    // says "this one will not be".
    expect(p.said('i1', 'the whole story')).toEqual({
      transcript: 'the whole story',
      interruptedAt: null,
    })
    // The verdict still yields the turn, so the caller can file the cut version.
    expect(p.truncated('i1', 1000)).toBeNull()
  })
})

describe('turns she finished', () => {
  it('are filed whole, with nothing to cut', () => {
    const p = createPending()
    expect(p.said('i1', 'she got to the end')).toEqual({
      transcript: 'she got to the end',
      interruptedAt: null,
    })
  })

  it('do not wait for a verdict that is not coming', () => {
    // There is no "she was not interrupted" frame. Holding for one would lose
    // every ordinary turn in the conversation.
    const p = createPending()
    p.said('i1', 'first')
    p.said('i2', 'second')
    expect(p.flush()).toEqual([])
  })
})

describe('items are kept apart', () => {
  it('does not let one item’s truncation settle another’s transcript', () => {
    // §28 measured one response speaking SEVERAL message items, so this is not
    // hypothetical bookkeeping.
    const p = createPending()
    p.truncated('i1', 500)
    expect(p.said('i2', 'a different item')).toEqual({
      transcript: 'a different item',
      interruptedAt: null,
    })
    expect(p.said('i1', 'the cut one')).toEqual({
      transcript: 'the cut one',
      interruptedAt: 500,
    })
  })
})

describe('closing the session', () => {
  it('files a cut item whose transcript never arrived', () => {
    // A turn she began and was cut off in before a word of it survived. Empty
    // text with a cut marker is a fact; losing it silently is how the archive
    // comes to disagree with what happened.
    const p = createPending()
    p.truncated('i1', 900)
    expect(p.flush()).toEqual([{ transcript: '', interruptedAt: 900 }])
  })

  it('files a cut item that has its transcript but no partner yet', () => {
    const p = createPending()
    p.truncated('i1', 900)
    // Nothing else arrives; the transcript came in on a later frame that also
    // never settled because the socket died.
    expect(p.flush()).toEqual([{ transcript: '', interruptedAt: 900 }])
  })

  it('flushes once, not on every close', () => {
    const p = createPending()
    p.truncated('i1', 900)
    expect(p.flush()).toHaveLength(1)
    expect(p.flush()).toEqual([])
  })
})
