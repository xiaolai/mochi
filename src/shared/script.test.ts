import { describe, expect, it } from 'vitest'
import { boundaryAt, costOf, isDense } from './script'

describe('which script a glyph is', () => {
  it('knows the spaceless scripts from the alphabetic ones', () => {
    for (const glyph of ['今', 'あ', 'カ', '한']) expect(isDense(glyph)).toBe(true)
    for (const glyph of ['a', 'Z', '9', 'ж', 'α', ' ']) expect(isDense(glyph)).toBe(false)
  })

  it('charges a dense glyph more, in the measured proportion', () => {
    // §57: 15.1 chars/s English against 4.1 Chinese. §60 verified the weighting
    // normalises both to the same cost-units per second of sound.
    const ratio = costOf('今') / costOf('a')
    expect(ratio).toBeGreaterThan(3.5)
    expect(ratio).toBeLessThan(3.9)
  })
})

describe('rounding an index back to a boundary', () => {
  it('never splits a Latin word', () => {
    const text = 'the little owl taps'
    // Inside "owl" -> back to where it starts.
    expect(boundaryAt(text, 12)).toBe(11)
    expect(text.slice(0, boundaryAt(text, 12))).toBe('the little ')
  })

  it('leaves an index between two dense glyphs alone', () => {
    // Chinese may break anywhere, so an index inside it is already a boundary.
    const text = '今天天气很好'
    expect(boundaryAt(text, 3)).toBe(3)
  })

  it('does not walk back across a whole clause on mixed text', () => {
    // THE case. `lastIndexOf(' ', 16)` here returns 2 and keeps two characters
    // out of sixteen, because the nearest space is an entire clause behind.
    const text = '好的 今天天气很好我们出去走走吧然后再说'
    const at = boundaryAt(text, 16)
    expect(at).toBe(16)
    expect(text.slice(0, at).length).toBe(16)
  })

  it('keeps the whole word when the cut lands on the space after it', () => {
    // Without this the walk-back runs INTO the preceding word and eats it:
    // 'abc def' cut at 3 would return 0 rather than 3. Found by a break-it
    // control that changed no test at all — the behaviour had no assertion.
    expect(boundaryAt('abc def', 3)).toBe(3)
    expect(boundaryAt('abc def', 4)).toBe(4)
  })

  it('stops the walk-back at a script change, not only at a space', () => {
    // A Latin word butted straight against Chinese with no space between them.
    // Cutting inside the word must walk back to where the word begins — not
    // through the Chinese behind it, which has no space to stop at and would
    // swallow the whole line. Reachable only here: every other case is caught
    // by the early return above, so without this the loop's script check has
    // no assertion at all.
    const text = '今天天气abcdef'
    expect(boundaryAt(text, 8)).toBe(4)
    expect(text.slice(0, 4)).toBe('今天天气')
  })

  it('never rounds forward', () => {
    // The two error directions are not symmetric: forward records words she
    // never said, back loses one from a turn already marked interrupted.
    for (const text of ['the little owl', '今天天气很好', 'mixed 今天 text here']) {
      for (let i = 0; i <= text.length; i += 1) {
        expect(boundaryAt(text, i)).toBeLessThanOrEqual(i)
      }
    }
  })

  it('clamps at both ends rather than throwing', () => {
    expect(boundaryAt('abc', -5)).toBe(0)
    expect(boundaryAt('abc', 99)).toBe(3)
    expect(boundaryAt('', 4)).toBe(0)
  })
})
