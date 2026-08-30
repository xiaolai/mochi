import { describe, expect, it } from 'vitest'
import { undoing } from './undoing'

describe('one step back, not a history', () => {
  it('is not offered when nothing has ever been rewritten', () => {
    expect(undoing({ text: 'a line', previous: null })).toEqual({ offered: false, lines: 0 })
  })

  it('is offered when there is a previous version', () => {
    expect(undoing({ text: 'one\ntwo', previous: 'one' }).offered).toBe(true)
  })

  it('treats an EMPTY previous note as a real one', () => {
    // `null` and `''` are different answers. Collapsing them makes the FIRST
    // rewrite the one that cannot be undone — which is exactly the rewrite
    // somebody most wants back, because it arrived without being asked for.
    expect(undoing({ text: 'she wrote this by herself', previous: '' }).offered).toBe(true)
  })

  it('says nothing about WHAT the note becomes', () => {
    // Deliberate. Main holds the previous version and does the restoring; a copy
    // here would be a second answer to a question only one process can answer,
    // and the stale one is the one on screen.
    expect(Object.keys(undoing({ text: 'now', previous: 'before' })).sort()).toEqual([
      'lines',
      'offered',
    ])
  })
})

describe('what the sentence beside it can say', () => {
  it('counts the lines the undo removes', () => {
    expect(undoing({ text: 'one\ntwo\nthree', previous: 'one' }).lines).toBe(2)
  })

  it('counts an empty note as no lines, not one blank one', () => {
    expect(undoing({ text: 'one', previous: '' }).lines).toBe(1)
    expect(undoing({ text: '', previous: 'one' }).lines).toBe(-1)
  })

  it('goes negative when the undo puts lines BACK', () => {
    // She can shorten a note as well as lengthen one, and a sentence that only
    // ever says "removes N lines" is wrong exactly when somebody is trying to
    // recover something she deleted.
    expect(undoing({ text: 'one', previous: 'one\ntwo\nthree' }).lines).toBe(-2)
  })
})
