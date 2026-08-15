import { describe, expect, it } from 'vitest'
import { createConfirmation } from './confirm'

describe('asking twice before something with no undo', () => {
  it('starts with nothing armed, so no row reads as dangerous', () => {
    const ask = createConfirmation()
    expect(ask.pending).toBeNull()
    expect(ask.isArmed('ada')).toBe(false)
    // The one that matters: a null pending must not match an absent id either,
    // or every row in the list would render armed the moment none was.
    expect(ask.isArmed('')).toBe(false)
  })

  it('arms exactly one row', () => {
    const ask = createConfirmation()
    ask.arm('ada')
    expect(ask.isArmed('ada')).toBe(true)
    expect(ask.isArmed('coach')).toBe(false)
  })

  it('moves the question rather than asking twice at once', () => {
    // Two rows both asking "delete for good?" is a screen where the next
    // click's meaning depends on which button the pointer is over.
    const ask = createConfirmation()
    ask.arm('ada')
    ask.arm('coach')
    expect(ask.isArmed('ada')).toBe(false)
    expect(ask.isArmed('coach')).toBe(true)
  })

  describe('the three ways out', () => {
    it('cancel answers no', () => {
      const ask = createConfirmation()
      ask.arm('ada')
      ask.cancel()
      expect(ask.pending).toBeNull()
      expect(ask.isArmed('ada')).toBe(false)
    })

    it('cancel is safe when nothing is armed', () => {
      // Escape and leaving the group both land here, and neither knows whether
      // anything was pending.
      const ask = createConfirmation()
      expect(() => ask.cancel()).not.toThrow()
      expect(ask.pending).toBeNull()
    })

    it('confirming disarms, so a second yes cannot delete a second persona', () => {
      const ask = createConfirmation()
      ask.arm('ada')
      expect(ask.confirm()).toBe('ada')
      // The row is gone from the list by now, but the state must not survive
      // it: a stale `pending` plus a repaint is a delete nobody asked for.
      expect(ask.pending).toBeNull()
      expect(ask.confirm()).toBeNull()
    })
  })

  it('answers with the id the question was about', () => {
    // The caller acts on this rather than on whatever it is holding. A repaint
    // between the question and the answer can move what the pane thinks the
    // row is; it cannot move what was asked.
    const ask = createConfirmation()
    ask.arm('ada')
    const answered = ask.confirm()
    expect(answered).toBe('ada')
  })

  it('confirms nothing when nothing was asked', () => {
    expect(createConfirmation().confirm()).toBeNull()
  })
})
