import { describe, expect, it } from 'vitest'
import { boundedHead, boundedTail, looksEmpty, oneLine, stripControl } from './text'

/**
 * Whether every surrogate in `text` still has its partner.
 *
 * Written out rather than using `String.prototype.isWellFormed`, which needs
 * the `es2024` lib: widening the whole project's target so one assertion can be
 * a one-liner is a config change with a blast radius, made for a test's
 * convenience. The check is four lines and says exactly what it means.
 */
function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i)
    const high = unit >= 0xd800 && unit <= 0xdbff
    const low = unit >= 0xdc00 && unit <= 0xdfff
    if (!high && !low) continue
    // A high surrogate must be followed by a low one; a low one must never
    // appear except immediately after a high one.
    if (low) return false
    const next = text.charCodeAt(i + 1)
    if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    i += 1
  }
  return true
}

/**
 * This module had NO test file, 21% coverage, and its two bounding functions
 * had no callers at all — while `store/memory.ts` had re-grown a raw
 * `.slice(0, limit)` for the same job. That is the duplication this module's
 * header says it exists to remove, returning in the one form it warns about.
 */
describe('bounding text without breaking a character', () => {
  it('never leaves a lone surrogate at the cut', () => {
    /*
      THE bug, and it was reachable in her durable memory.

      `PERSONA_LIMITS.memory` is 20,000 UTF-16 units and a note is cut to it on
      every read, every write, and every rollback read. A limit landing between
      the halves of an astral character leaves half an emoji — measured:
      `isWellFormed()` false — and that string is written to her note file and
      then into her system prompt.

      Swept rather than spot-checked, because which limit splits a pair depends
      on where the astral character falls.
    */
    for (let limit = 1; limit <= 12; limit += 1) {
      for (let before = 0; before <= 6; before += 1) {
        const text = `${'a'.repeat(before)}\u{1F642}${'b'.repeat(6)}`
        expect(wellFormed(boundedHead(text, limit)), `head limit=${String(limit)}`).toBe(true)
        expect(wellFormed(boundedTail(text, limit)), `tail limit=${String(limit)}`).toBe(true)
      }
    }
  })

  it('keeps the ellipsis INSIDE the limit', () => {
    // The one thing these promise. Appending it afterwards made every truncated
    // value one unit longer than the bound it was given.
    for (let limit = 1; limit <= 20; limit += 1) {
      expect(boundedHead('x'.repeat(50), limit).length).toBeLessThanOrEqual(limit)
      expect(boundedTail('x'.repeat(50), limit).length).toBeLessThanOrEqual(limit)
    }
  })

  it('leaves text that already fits completely alone', () => {
    expect(boundedHead('short', 50)).toBe('short')
    expect(boundedTail('short', 50)).toBe('short')
    // Exactly at the limit is not over it, so no ellipsis appears.
    expect(boundedHead('abcde', 5)).toBe('abcde')
    expect(boundedTail('abcde', 5)).toBe('abcde')
  })

  it('marks which end was cut', () => {
    // Which direction a caller wants is a real decision: a transcript replayed
    // into her next session wants the END, a log line wants the start.
    expect(boundedHead('abcdefgh', 4)).toBe('abc…')
    expect(boundedTail('abcdefgh', 4)).toBe('…fgh')
  })

  it('answers empty for a non-positive limit rather than throwing', () => {
    expect(boundedHead('abc', 0)).toBe('')
    expect(boundedTail('abc', -5)).toBe('')
  })

  it('is always a prefix or a suffix of what it was given', () => {
    // The property that matters where this is used: it must never invent,
    // reorder, or reach past the text.
    const text = 'the little owl \u{1F642} taps the pixel feather'
    for (let limit = 1; limit <= text.length + 2; limit += 1) {
      const head = boundedHead(text, limit).replace(/…$/, '')
      const tail = boundedTail(text, limit).replace(/^…/, '')
      expect(text.startsWith(head), `head limit=${String(limit)}`).toBe(true)
      expect(text.endsWith(tail), `tail limit=${String(limit)}`).toBe(true)
    }
  })
})

describe('making untrusted text safe for a line', () => {
  it('replaces every character a reader would see as a line break', () => {
    // C0, DEL, C1, and U+2028/U+2029 — the last three were each missed once,
    // and each let a forged log line or prompt line through.
    for (const code of [0x00, 0x0a, 0x0d, 0x1f, 0x7f, 0x85, 0x9f, 0x2028, 0x2029]) {
      const ch = String.fromCodePoint(code)
      expect(stripControl(`a${ch}b`), `U+${code.toString(16).toUpperCase()}`).toBe('a b')
    }
  })

  it('keeps the length unchanged, so a bound checked before still holds', () => {
    expect(stripControl('a\u0000b\nc')).toHaveLength(5)
  })

  it('flattens a value meant to be a fragment of a sentence', () => {
    expect(oneLine('  Ada \n\n  Lovelace  ')).toBe('Ada Lovelace')
  })

  it('calls a field empty when nothing in it renders', () => {
    /*
      `raw.trim()` said a name of two zero-width joiners was filled in.

      Written as escapes rather than as themselves, and that is not style. The
      literals went in first and one of them was a NUL, which git reads as the
      mark of a BINARY file: the whole test file was stored with no diff, so
      nothing in it could be reviewed or merged as text. An assertion about
      invisible characters is also unreadable when it is made out of them — the
      escape says which character is being tested, and the literal cannot.
    */
    expect(looksEmpty('\u200d\u200d')).toBe(true)
    expect(looksEmpty('\u200b  ')).toBe(true)
    expect(looksEmpty('    ')).toBe(true)
    expect(looksEmpty('')).toBe(true)
    expect(looksEmpty('  a  ')).toBe(false)
  })
})

describe('characters that render as nothing but are not spaces', () => {
  /**
   * `looksEmpty` stripped `\p{Cf}` and `\p{Zs}`. Two blanks are neither:
   * U+3164 HANGUL FILLER is a letter (`Lo`) and U+2800 BRAILLE PATTERN BLANK
   * is a symbol (`So`). Both draw as nothing, so a name made of them passed
   * validation and then appeared empty everywhere — which is the failure this
   * function's own header describes, arrived at through a class it did not
   * cover.
   */
  it('reads a hangul filler as empty', () => {
    expect(looksEmpty('ㅤ')).toBe(true)
    expect(looksEmpty('ㅤㅤㅤ')).toBe(true)
  })

  it('reads a blank braille pattern as empty', () => {
    expect(looksEmpty('⠀')).toBe(true)
  })

  it('reads them as empty mixed with ordinary whitespace', () => {
    expect(looksEmpty(' ㅤ ⠀ ')).toBe(true)
  })

  it('still reads real text as filled', () => {
    // The other direction, which matters more: over-stripping would reject
    // names somebody meant. Braille that says something is not blank.
    expect(looksEmpty('a')).toBe(false)
    expect(looksEmpty('ㅤa')).toBe(false)
    expect(looksEmpty('⠁')).toBe(false)
    expect(looksEmpty('ada')).toBe(false)
    expect(looksEmpty('日本語')).toBe(false)
  })
})
