import { describe, expect, it } from 'vitest'
import { said } from './said'

describe('a receipt is for a write whose effect is somewhere else', () => {
  it('says a voice lands at a wake that has not happened', () => {
    expect(said({ kind: 'voice', value: 'ballad' })).toBe('Saved — ballad lands on her next wake.')
  })

  it('says a note was undone, naming what went', () => {
    expect(said({ kind: 'note-undone', value: 'the line she added at 13:02' })).toContain('Undone')
  })

  it('says nothing for a write the control already shows', () => {
    // A bar that fills with restatements of controls that already moved is a
    // bar people stop reading.
    expect(said({ kind: 'pronoun', value: 'she' })).toBeNull()
    expect(said({ kind: 'theme', value: 'mint' })).toBeNull()
  })

  it('says nothing for a kind nobody has decided about', () => {
    // The safe direction. A default of "say something" fills the bar.
    expect(said({ kind: 'something-new-and-unconsidered' })).toBeNull()
  })

  it('is keyed by the FIELD, not by a name somebody chose for it', () => {
    // `expression` was a key here and no change carries one — the switch saves
    // `faces`. A table keyed on a name the data does not use is a lookup that
    // always misses, silently.
    expect(said({ kind: 'faces' })).not.toBeNull()
    expect(said({ kind: 'expression' })).toBeNull()
  })
})

describe('a refusal is not a receipt', () => {
  it('produces nothing at all, rather than a sentence with a "not" in it', () => {
    // Failures go to the problems drawer, which is a different surface with a
    // different lifetime and a count.
    expect(said({ kind: 'voice', value: 'ballad', ok: false })).toBeNull()
  })

  it('still speaks when the write is explicitly ok', () => {
    expect(said({ kind: 'voice', value: 'ballad', ok: true })).not.toBeNull()
  })
})

describe('the sentence is never blank', () => {
  it('answers null rather than an empty string', () => {
    // An empty receipt and no receipt are different states, and only one of
    // them is a state — a caller that forgets to check must not be able to put
    // a blank line in the bar.
    for (const kind of ['pronoun', 'unknown', 'theme', 'expression']) {
      expect(said({ kind })).toBeNull()
    }
  })

  it('survives a write that names no value', () => {
    expect(said({ kind: 'faces' })).toBe('Saved. She is told what she has at her next wake.')
  })
})
