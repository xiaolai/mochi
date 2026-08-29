import { describe, expect, it } from 'vitest'
import { editing } from './editing'

/**
 * C3 — both controls disable on dispatch, and so does the document; nothing
 * re-enables them locally.
 */
describe('C3 · a document with a commit and a way back', () => {
  it('offers neither until there is a difference', () => {
    const doc = editing('hello')
    expect(doc.canCommit()).toBe(false)
    expect(doc.canRevert()).toBe(false)
  })

  it('offers both once there is one', () => {
    const doc = editing('hello')
    doc.typed('hello there')
    expect(doc.canCommit()).toBe(true)
    expect(doc.canRevert()).toBe(true)
  })

  it('withdraws both when the typing comes back to where it started', () => {
    // Enabled by a DIFFERENCE, not by having typed. Typing a character and
    // deleting it is not a change to save.
    const doc = editing('hello')
    doc.typed('hello!')
    doc.typed('hello')
    expect(doc.canCommit()).toBe(false)
    expect(doc.canRevert()).toBe(false)
  })

  it('takes BOTH away on dispatch, not just the one pressed', () => {
    // Left live, a second click — or commit followed straight by revert —
    // started two writes whose completion order nothing guarantees.
    const doc = editing('hello')
    doc.typed('hello there')
    expect(doc.commit()).toBe('hello there')
    expect(doc.canCommit()).toBe(false)
    expect(doc.canRevert()).toBe(false)
  })

  it('takes the DOCUMENT away with them', () => {
    // The box stayed live for the whole round trip, and the write ends in a
    // re-read that rebuilds the pane. Anything typed in between was replaced
    // without a word.
    const doc = editing('hello')
    doc.typed('hello there')
    doc.commit()
    doc.typed('typed while it was sending')
    expect(doc.draft()).toBe('hello there')
  })

  it('writes nothing on a second commit', () => {
    // A double click, or a click landing after the control should have gone.
    const doc = editing('hello')
    doc.typed('hello there')
    doc.commit()
    expect(doc.commit()).toBeNull()
  })

  it('does nothing on a revert that arrives while sending', () => {
    const doc = editing('hello')
    doc.typed('hello there')
    doc.commit()
    doc.revert()
    expect(doc.draft()).toBe('hello there')
    expect(doc.sending()).toBe(true)
  })

  it('is released only by the re-read', () => {
    // Nothing re-enables locally. A local guess about what is now stored is
    // always wrong after a refusal.
    const doc = editing('hello')
    doc.typed('hello there')
    doc.commit()
    expect(doc.sending()).toBe(true)
    doc.arrived('hello there')
    expect(doc.sending()).toBe(false)
    expect(doc.canCommit()).toBe(false)
  })

  it('shows what is STORED after a refusal, not what was attempted', () => {
    // A refusal re-reads the unchanged document. A control watching only for
    // the text to change would wait for ever and go on showing the rejected
    // draft as though it had been saved.
    const doc = editing('hello')
    doc.typed('hello there')
    doc.commit()
    doc.arrived('hello')
    expect(doc.draft()).toBe('hello')
    expect(doc.sending()).toBe(false)
    expect(doc.canCommit()).toBe(false)
  })
})

describe('taking it back here, without a write', () => {
  it('returns to what is stored, not to empty', () => {
    // There is a separate and deliberate way to store nothing: clear the box
    // and commit.
    const doc = editing('hello')
    doc.typed('')
    doc.revert()
    expect(doc.draft()).toBe('hello')
  })

  it('leaves nothing to commit afterwards', () => {
    const doc = editing('hello')
    doc.typed('hello there')
    doc.revert()
    expect(doc.canCommit()).toBe(false)
  })

  it('does not lock the document', () => {
    // Nothing was written, so there is nothing to wait for. Locking here would
    // strand the pane until a re-read that is never coming.
    const doc = editing('hello')
    doc.typed('hello there')
    doc.revert()
    expect(doc.sending()).toBe(false)
  })
})

describe('taking it back by writing — restoring a stored default', () => {
  // The catalogued prompts' Reset. It is offered by the STORED text differing
  // from what shipped, not by anything having been typed.
  const edited = editing('a stored edit', { mayRevert: () => true })

  it('is offered with nothing typed at all', () => {
    expect(edited.canRevert()).toBe(true)
    expect(edited.canCommit()).toBe(false)
  })

  it('locks the document, because a write really did go out', () => {
    const doc = editing('a stored edit', { mayRevert: () => true })
    expect(doc.revertByWriting()).toBe(true)
    expect(doc.sending()).toBe(true)
    expect(doc.canCommit()).toBe(false)
    expect(doc.canRevert()).toBe(false)
  })

  it('writes nothing on a second press', () => {
    const doc = editing('a stored edit', { mayRevert: () => true })
    doc.revertByWriting()
    expect(doc.revertByWriting()).toBe(false)
  })

  it('writes nothing while a commit is out', () => {
    // Save followed straight by Reset: two writes, no guaranteed order.
    const doc = editing('a stored edit', { mayRevert: () => true })
    doc.typed('something else')
    doc.commit()
    expect(doc.revertByWriting()).toBe(false)
  })

  it('is not offered when the stored text is already what shipped', () => {
    const doc = editing('as shipped', { mayRevert: () => false })
    doc.typed('typed something')
    expect(doc.canRevert()).toBe(false)
    expect(doc.revertByWriting()).toBe(false)
    expect(doc.canCommit()).toBe(true)
  })
})

describe('a further reason a difference may not be committable', () => {
  const shortEnough = (draft: string): boolean => draft.length <= 8

  it('holds the commit while the way back stays available', () => {
    // The catalogued prompts pass their length bound through here. Over the
    // bound you can still take the edit back — you just cannot save it.
    const doc = editing('hello', { mayCommit: shortEnough })
    doc.typed('far too long to store')
    expect(doc.canCommit()).toBe(false)
    expect(doc.canRevert()).toBe(true)
  })

  it('writes nothing while it is unsatisfied', () => {
    const doc = editing('hello', { mayCommit: shortEnough })
    doc.typed('far too long to store')
    expect(doc.commit()).toBeNull()
    expect(doc.sending()).toBe(false)
  })

  it('lets the commit through once it is satisfied again', () => {
    const doc = editing('hello', { mayCommit: shortEnough })
    doc.typed('far too long to store')
    doc.typed('hi')
    expect(doc.canCommit()).toBe(true)
    expect(doc.commit()).toBe('hi')
  })
})
