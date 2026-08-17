import { describe, expect, it } from 'vitest'
import { wrapByWord } from './wrap'

/**
 * A made-up metric, on purpose: a Latin glyph is 1 wide and a CJK glyph is 2.
 *
 * It is the real proportion, and it means every assertion below is about
 * MEASURED width. A count-based implementation would pass a test written
 * against a metric that charged the same for both, which is precisely the bug
 * this file exists to prevent.
 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const width = (text: string): number => {
  let total = 0
  for (const { segment } of GRAPHEMES.segment(text)) {
    total += /[一-鿿，。？！]/u.test(segment) ? 2 : 1
  }
  return total
}

/**
 * A break between two letters is a split word — that, and nothing looser.
 *
 * The first version of this asserted no line may START lowercase, which is not
 * the same claim at all: `doing secret ` is a perfectly good line. It failed on
 * correct output, which is the cheap direction to be wrong in, but it would
 * equally have passed `tasks—/just` while claiming to have checked words.
 */
function expectNoSplitWords(lines: readonly string[]): void {
  for (let i = 0; i + 1 < lines.length; i += 1) {
    // NOT trimmed. The trailing space is the evidence that the break was legal,
    // and trimming it first reports every ordinary wrap as a split word — which
    // is what the previous attempt at this helper did.
    const ends = lines[i]?.slice(-1) ?? ''
    const begins = lines[i + 1]?.slice(0, 1) ?? ''
    // Latin letters specifically, NOT `\p{L}` — that matches Chinese too, and
    // breaking between two Chinese glyphs is the correct behaviour there. A
    // helper this narrow cannot be pointed at the Chinese cases by mistake.
    expect(/[A-Za-z]/.test(ends) && /[A-Za-z]/.test(begins)).toBe(false)
  }
}

describe('English', () => {
  it('never splits a word', () => {
    // The reported bug, verbatim: this wrapped as "just re / ady" and
    // "brainstor / m something".
    const lines = wrapByWord("I'm not running off doing secret tasks—just ready.", 20, width)
    for (const line of lines) expect(width(line.trimEnd())).toBeLessThanOrEqual(20)
    expect(lines.join('')).toBe("I'm not running off doing secret tasks—just ready.")
    expectNoSplitWords(lines)
  })

  it('fills each line rather than breaking early', () => {
    const lines = wrapByWord('aaa bbb ccc ddd', 7, width)
    expect(lines.map((one) => one.trimEnd())).toEqual(['aaa bbb', 'ccc ddd'])
  })

  it('does not count a trailing space against the width', () => {
    // 'aaa bbb' is 7 wide; 'aaa bbb ' is 8. Measuring the space would wrap
    // 'bbb' onto its own line and leave the first one short.
    expect(wrapByWord('aaa bbb', 7, width)).toHaveLength(1)
  })

  it('breaks a single word that cannot fit at all', () => {
    // A URL, or a bubble narrower than the word. Running off the edge of a
    // transparent window is worse than an ugly break.
    const lines = wrapByWord('supercalifragilistic', 6, width)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(width(line)).toBeLessThanOrEqual(6)
    expect(lines.join('')).toBe('supercalifragilistic')
  })
})

describe('Chinese', () => {
  it('breaks between glyphs, because there are no spaces to break at', () => {
    const lines = wrapByWord('今天天气很好我们出去走走吧', 8, width)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(width(line.trimEnd())).toBeLessThanOrEqual(8)
    expect(lines.join('')).toBe('今天天气很好我们出去走走吧')
  })

  it('never begins a line with closing punctuation', () => {
    // 禁則処理. Width 8 puts the break exactly where the comma would land first.
    const lines = wrapByWord('今天天气很好，我们出去走走吧', 8, width)
    for (const line of lines) expect(line).not.toMatch(/^[，。？！]/u)
    expect(lines.join('')).toBe('今天天气很好，我们出去走走吧')
  })

  it('never ends a line with an opening bracket', () => {
    const lines = wrapByWord('他说（这是真的）没错', 6, width)
    for (const line of lines) expect(line.trimEnd()).not.toMatch(/（$/u)
    expect(lines.join('')).toBe('他说（这是真的）没错')
  })
})

describe('both at once, which is the normal case here', () => {
  it('applies each script its own rule in one sentence', () => {
    const lines = wrapByWord('她说 hello world 然后笑了', 10, width)
    for (const line of lines) expect(width(line.trimEnd())).toBeLessThanOrEqual(10)
    expect(lines.join('')).toBe('她说 hello world 然后笑了')
    // The English words survive whole even though the Chinese around them broke.
    const joined = lines.join('\n')
    expect(joined).toContain('hello')
    expect(joined).toContain('world')
  })

  it('honours a newline as a break rather than an opportunity', () => {
    expect(wrapByWord('one\ntwo', 99, width)).toEqual(['one', 'two'])
  })

  it('returns nothing for nothing', () => {
    expect(wrapByWord('', 20, width)).toEqual([])
  })
})
