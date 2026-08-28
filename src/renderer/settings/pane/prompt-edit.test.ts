import { describe, expect, it } from 'vitest'
import { canSave, lengthNote } from './prompt-edit'

/**
 * What a prompt editor allows, and what it says about it.
 *
 * These were closures inside an eighty-line `render`, reachable only by
 * building the pane — and the suite runs in node with no DOM, so the rules
 * about what may be saved had nothing pointed at them at all.
 */
describe('what the editor says about the length', () => {
  it('says nothing while it fits', () => {
    expect(lengthNote('x'.repeat(10), 10)).toBeNull()
  })

  it('names both numbers once it does not', () => {
    // "It is too long" sends somebody counting. The two numbers are what turns
    // the message into something to act on.
    const note = lengthNote('x'.repeat(11), 10)
    expect(note).toContain('11')
    expect(note).toContain('10')
  })

  it('says nothing at all for a prompt with no limit', () => {
    /*
      Most of the catalogue is unbounded. Inventing a number to compare against
      would be worse than silence — it would name a limit that does not exist.
    */
    expect(lengthNote('x'.repeat(100_000), undefined)).toBeNull()
  })
})

describe('whether Save is live', () => {
  it('is dead when nothing changed', () => {
    // A DIFFERENCE, not having typed: typing a character and deleting it is not
    // a change to save.
    expect(canSave('same', 'same', undefined)).toBe(false)
  })

  it('is live for a real change', () => {
    expect(canSave('new', 'old', undefined)).toBe(true)
  })

  it('is dead over the bound, even when it changed', () => {
    /*
      Main would refuse it anyway, and an enabled button whose only outcome is a
      refusal is a button that teaches people to distrust it.
    */
    expect(canSave('x'.repeat(11), 'old', 10)).toBe(false)
  })

  it('is live at exactly the bound', () => {
    // The boundary belongs to the allowed side, or the limit as displayed is
    // one more than the limit as enforced.
    expect(canSave('x'.repeat(10), 'old', 10)).toBe(true)
  })
})
