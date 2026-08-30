import { describe, expect, it } from 'vitest'
import { undoing } from './undoing'

describe('one step back, not a history', () => {
  it('is not offered when nothing has ever been rewritten', () => {
    expect(undoing({ text: 'a line', previous: null })).toEqual({
      offered: false,
      becomes: null,
      lines: 0,
    })
  })

  it('is offered when there is a previous version', () => {
    const back = undoing({ text: 'one\ntwo', previous: 'one' })
    expect(back.offered).toBe(true)
    expect(back.becomes).toBe('one')
  })

  it('treats an EMPTY previous note as a real one', () => {
    // `null` and `''` are different answers. Collapsing them makes the FIRST
    // rewrite the one that cannot be undone — which is exactly the rewrite
    // somebody most wants back, because it arrived without being asked for.
    const back = undoing({ text: 'she wrote this by herself', previous: '' })
    expect(back.offered).toBe(true)
    expect(back.becomes).toBe('')
  })

  it('hands back the value rather than a signal to go and look', () => {
    // The caller must not be able to arrive at a different answer than the one
    // that decided to offer the control.
    expect(undoing({ text: 'now', previous: 'before' }).becomes).toBe('before')
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
