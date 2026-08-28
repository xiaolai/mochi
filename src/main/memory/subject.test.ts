import { describe, expect, it } from 'vitest'
import { MAX_SUBJECT_CHARS, SUBJECT_SCHEMA, subjectFrom, subjectPrompt } from './subject'
import type { Turn } from '../store/turn-row'

/**
 * What a conversation is called, and everything that is refused.
 *
 * The refusals are the substance. A conversation with no subject is the
 * ordinary state and was the only state until this existed, so every failure
 * costs nothing — while a subject that is wrong, clipped or two lines tall is a
 * claim about a conversation somebody would have to open it to disprove.
 */

const turns: readonly Turn[] = [
  { at: 1_000, who: 'you', text: 'can you look at the parser?', cut: false },
  { at: 1_100, who: 'her', text: 'it refuses a trailing comma', cut: false },
]

describe('the prompt', () => {
  it('carries the instruction it is handed rather than one of its own', () => {
    // The wording lives in the catalogue, is displayed and is rewritable. A
    // module holding its own copy would be the one string nobody could change.
    expect(subjectPrompt(turns, 'INSTRUCTION-HERE')).toContain('INSTRUCTION-HERE')
  })

  it('fences the transcript, like every other untrusted half', () => {
    // A mitigation rather than a guarantee — `subjectFrom` is what actually
    // stops a bad answer reaching the row — but the fence is what the rest of
    // this codebase does with text somebody else wrote.
    const prompt = subjectPrompt(turns, 'x')
    expect(prompt).toContain('<conversation>')
    expect(prompt).toContain('</conversation>')
    expect(prompt).toContain('can you look at the parser?')
  })
})

describe('the schema', () => {
  it('asks for one string and refuses anything else', () => {
    expect(SUBJECT_SCHEMA.additionalProperties).toBe(false)
    expect(SUBJECT_SCHEMA.required).toEqual(['subject'])
  })

  it('states the bound it will also be checked against', () => {
    // The schema is a REQUEST and the check is the guarantee. Stating it twice
    // is deliberate: a model that honours the schema costs nothing extra, and
    // one that does not is caught either way.
    expect(SUBJECT_SCHEMA.properties.subject.maxLength).toBe(MAX_SUBJECT_CHARS)
  })
})

describe('reading an answer back', () => {
  it('takes a short single line', () => {
    expect(subjectFrom({ subject: 'the parser and its trailing comma' })).toBe(
      'the parser and its trailing comma',
    )
  })

  it('trims it', () => {
    expect(subjectFrom({ subject: '  spaced out  ' })).toBe('spaced out')
  })

  it('refuses anything that is not the shape asked for', () => {
    for (const answered of [null, undefined, 'a string', 7, [], { subject: 7 }, {}]) {
      expect(subjectFrom(answered), JSON.stringify(answered) ?? 'undefined').toBeNull()
    }
  })

  it('refuses every vertical separator, not only a newline', () => {
    /*
      A subject is drawn on one line under a row. A two-line answer would either
      be clipped — showing half a sentence as if it were the whole one — or push
      the row apart. `\\r`, U+2028 and U+2029 all break a line and all pass a
      check that only looks for `\\n`.
    */
    expect(subjectFrom({ subject: 'two\nlines' })).toBeNull()
    expect(subjectFrom({ subject: 'two\rlines' })).toBeNull()
    expect(subjectFrom({ subject: 'two lines' })).toBeNull()
    expect(subjectFrom({ subject: 'two lines' })).toBeNull()
  })

  it('refuses an empty answer rather than storing one', () => {
    // "Nothing to say" is spelled `null`. A stored empty string is
    // indistinguishable from a title somebody deleted, and the column would
    // have two ways to mean nothing.
    expect(subjectFrom({ subject: '' })).toBeNull()
    expect(subjectFrom({ subject: '   ' })).toBeNull()
    expect(subjectFrom({ subject: '\t' })).toBeNull()
  })

  it('refuses an over-long answer rather than cutting it', () => {
    // Truncating produces a title that stops mid-word and reads as a bug in the
    // pane rather than a limit on the answer.
    expect(subjectFrom({ subject: 'x'.repeat(MAX_SUBJECT_CHARS + 1) })).toBeNull()
    expect(subjectFrom({ subject: 'x'.repeat(MAX_SUBJECT_CHARS) })).toBe(
      'x'.repeat(MAX_SUBJECT_CHARS),
    )
  })

  it('measures CHARACTERS, because that is what the schema asked for', () => {
    /*
      `SUBJECT_SCHEMA` says `maxLength: 80`, and JSON Schema measures that in
      characters. `.length` measures UTF-16 code units, so a title of eighty
      emoji satisfied the schema this module sends and was refused by the check
      on the way back: the model answered exactly what it was asked for and the
      answer was thrown away, silently, as `null`.
    */
    const eighty = '🙂'.repeat(MAX_SUBJECT_CHARS)
    expect(eighty.length).toBe(MAX_SUBJECT_CHARS * 2)
    expect(subjectFrom({ subject: eighty })).toBe(eighty)
  })

  it('still refuses one character over, counted the same way', () => {
    // The bound has to bind, or the fix above is just a wider hole.
    expect(subjectFrom({ subject: '🙂'.repeat(MAX_SUBJECT_CHARS + 1) })).toBeNull()
  })

  it('measures the bound AFTER trimming, so padding cannot fail a valid title', () => {
    const padded = ` ${'x'.repeat(MAX_SUBJECT_CHARS)} `
    expect(padded.length).toBeGreaterThan(MAX_SUBJECT_CHARS)
    expect(subjectFrom({ subject: padded })).toBe('x'.repeat(MAX_SUBJECT_CHARS))
  })

  it('ignores anything beyond the field it asked for', () => {
    // `additionalProperties: false` is a request. A model that answers with
    // more must not be able to reach anything here.
    expect(subjectFrom({ subject: 'fine', other: 'ignored' })).toBe('fine')
  })
})
