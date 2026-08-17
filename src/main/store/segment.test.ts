/**
 * The two halves, tested AGAINST EACH OTHER through a real FTS5 index.
 *
 * Testing them separately would miss the thing that actually matters: they are
 * one decision with two ends, and the failure mode is that they disagree —
 * which produces a valid index, a valid query, and an empty answer. Nothing
 * throws. So every case below stores text and then searches for it, which is
 * the only assertion that can tell "it works" from "it silently finds
 * nothing".
 */

import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { segment, toAnyQuery, toMatchQuery } from './segment'

/** A real index, because a mock of FTS5 would be a mock of the thing at issue. */
function indexed(...lines: readonly string[]): (query: string) => string[] {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE VIRTUAL TABLE t USING fts5(body, raw UNINDEXED)')
  const insert = db.prepare('INSERT INTO t(body, raw) VALUES(?, ?)')
  for (const line of lines) insert.run(segment(line), line)
  return (query) => {
    const match = toMatchQuery(query)
    if (match === null) return []
    return db
      .prepare('SELECT raw FROM t WHERE t MATCH ? ORDER BY rank')
      .all(match)
      .map((row) => String(row['raw']))
  }
}

describe('Chinese, which the default tokenizer cannot search at all', () => {
  const find = indexed('今天我想吃苹果', '明天我想喝茶')

  it('finds a two-character word inside a run', () => {
    // The exact case from findings.md §5. With `unicode61` this returns
    // nothing, and nothing anywhere reports a problem.
    expect(find('苹果')).toEqual(['今天我想吃苹果'])
  })

  it('finds a three-character run', () => {
    expect(find('我想吃')).toEqual(['今天我想吃苹果'])
  })

  it('finds the whole line', () => {
    expect(find('今天我想吃苹果')).toEqual(['今天我想吃苹果'])
  })

  it('finds a single character in both lines that have it', () => {
    expect(find('我').sort()).toEqual(['今天我想吃苹果', '明天我想喝茶'])
  })

  it('does not match characters that are merely present out of order', () => {
    // A phrase, not a bag of characters. `果苹` is not `苹果`, and an index
    // that returned it would make search useless on long transcripts.
    expect(find('果苹')).toEqual([])
  })
})

describe('Latin, which must not be made worse', () => {
  const find = indexed('hello world', 'help wanted')

  it('finds a word', () => {
    expect(find('hello')).toEqual(['hello world'])
  })

  it('does not split words into letters', () => {
    // Splitting Latin the way CJK is split would make every English word
    // match every other one.
    expect(find('hel')).toEqual([])
  })

  it('requires every word typed, so two words narrow rather than widen', () => {
    expect(find('hello world')).toEqual(['hello world'])
    expect(find('hello wanted')).toEqual([])
  })
})

describe('mixed scripts in one line', () => {
  const find = indexed('我在读 TypeScript 手册', 'TypeScript is fine')

  it('finds the Latin part', () => {
    expect(find('TypeScript').sort()).toEqual(['TypeScript is fine', '我在读 TypeScript 手册'])
  })

  it('finds the CJK part', () => {
    expect(find('手册')).toEqual(['我在读 TypeScript 手册'])
  })

  it('finds both together', () => {
    expect(find('TypeScript 手册')).toEqual(['我在读 TypeScript 手册'])
  })
})

describe('Japanese, which has the same problem and the same fix', () => {
  const find = indexed('今日はいい天気ですね')

  it('finds a kana run inside it', () => {
    expect(find('いい')).toEqual(['今日はいい天気ですね'])
  })

  it('finds a kanji word inside it', () => {
    expect(find('天気')).toEqual(['今日はいい天気ですね'])
  })
})

describe('what somebody types into a search box is not a query language', () => {
  const find = indexed('hello world', 'a NEAR b', 'cost: 5')

  // Each of these either changes the meaning of the search or throws, if the
  // input reaches FTS5 unquoted. A search box that can be crashed by a
  // punctuation mark is a search box people learn not to trust.
  for (const hostile of ['NEAR', 'OR', 'AND', '*', '"', '""', '(', ')', '-', ':', 'a OR b', 'x*']) {
    it(`survives ${JSON.stringify(hostile)}`, () => {
      expect(() => find(hostile)).not.toThrow()
    })
  }

  it('treats an operator as the word it looks like', () => {
    // `NEAR` finds the line containing the word NEAR, rather than being read
    // as the FTS5 operator and matching nothing or erroring.
    expect(find('NEAR')).toEqual(['a NEAR b'])
  })

  it('has nothing to search for when nothing was typed', () => {
    // An empty MATCH throws in FTS5, so this must be answered before the query
    // rather than by it.
    for (const empty of ['', '   ', '!!!', '。。']) {
      expect(toMatchQuery(empty), JSON.stringify(empty)).toBeNull()
    }
  })
})

describe('the two halves agree', () => {
  it('finds every stored line by searching for the whole of it', () => {
    // The property that catches the two drifting apart. If one side ever
    // decides a range is CJK and the other does not, the index and the query
    // stop meeting and this is what notices — nothing else would.
    const lines = [
      '今天我想吃苹果',
      'hello world',
      '我在读 TypeScript 手册',
      '今日はいい天気ですね',
      'Grüße, 世界',
    ]
    const find = indexed(...lines)
    for (const line of lines) {
      expect(find(line), line).toContain(line)
    }
  })
})

/**
 * The hand-written ranges claimed to be "Han, hiragana and katakana" and were
 * not. Every character below is ordinary in a real sentence and fell outside
 * them, so the text was indexed one way and searched another and the box
 * returned nothing — with nothing anywhere reporting a problem.
 */
describe('which scripts are written without spaces', () => {
  // SUBSTRING searches inside an unbroken run, which is the only shape that
  // catches a missed character. One sitting between two runs is separated
  // anyway -- the runs on either side of it get a space -- and a query for it
  // becomes its own AND term, so it is found either way. It is when the missed
  // characters are ADJACENT that the whole run goes into the index as one token
  // and no substring of it can ever be matched again.
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['half-width katakana', 'ｱﾆﾒｽｷ', 'ｱﾆﾒ'],
    // Not a regression test: the hand-written range this replaced happened to
    // cover these already, because its upper bound was mistyped (see below) and
    // swallowed the surrogate range along with everything else. Kept because it
    // is the behaviour required, and a BMP-only rewrite would lose it silently.
    ['supplementary Han', '𠀀𠀁𠀂', '𠀀𠀁'],
    ['the kana extension blocks', '\u{1B132}\u{1B150}\u{1B151}', '\u{1B150}\u{1B151}'],
  ]
  for (const [what, stored, wanted] of cases) {
    it(`finds a substring of ${what}`, () => {
      expect(indexed(stored)(wanted)).toEqual([stored])
    })
  }

  it('does not report a hit for characters that are merely all present', () => {
    // The other half of the same defect. With `〇` outside the CJK ranges, a
    // query for `二〇二` fell apart into three independent AND terms, so a line
    // holding those characters scattered anywhere counted as a hit. Treating
    // the run as one phrase is what makes it an ordering claim.
    expect(indexed('第〇章的二十二页')('二〇二')).toEqual([])
    expect(indexed('二〇二六年')('二〇二')).toEqual(['二〇二六年'])
  })

  it('leaves Korean alone, which the ranges said they did and did not', () => {
    // The range read `豈-﫿` and looked like the CJK compatibility ideographs.
    // `豈` here is U+8C48 -- the ordinary character, not U+F900 -- so the range
    // was U+8C48 to U+FAFF, which covers the whole Hangul syllable block and
    // the surrogates with it. Korean was therefore split per syllable by a
    // module whose own comment said it deliberately was not.
    //
    // The consequence is not a failed search -- both sides split it, so they
    // still met -- but a worse one: every syllable of every Korean word became
    // its own token, so a search for one syllable matched every word containing
    // it. That is exactly the "makes its search worse rather than better"
    // outcome the comment gave as the reason for leaving Hangul out.
    expect(segment('안녕하세요 세계')).toBe('안녕하세요 세계')
    expect(indexed('안녕하세요 세계', '세탁기를 샀어요')('세계')).toEqual(['안녕하세요 세계'])
  })
})

/**
 * Neither side normalised, so canonically equivalent Japanese did not match
 * itself: `が` is one code point from one keyboard and two from another, and
 * FTS5 compares tokens byte for byte.
 */
describe('two spellings of the same character', () => {
  const composed = 'が'.normalize('NFC')
  const decomposed = 'が'.normalize('NFD')

  it('is worth testing at all', () => {
    expect(composed).not.toBe(decomposed)
  })

  it('finds a decomposed query in composed text', () => {
    expect(indexed(`彼${composed}来た`)(decomposed)).toEqual([`彼${composed}来た`])
  })

  it('finds a composed query in decomposed text', () => {
    const stored = `彼${decomposed}来た`
    expect(indexed(stored)(composed)).toEqual([stored])
  })
})

describe('a quote typed into the search box', () => {
  it('still finds the words on either side of it', () => {
    // Deleting the quote produced the phrase `"foobar"`, and the index holds
    // `foo` followed by `bar` — so the one thing the user typed could never be
    // found. FTS5 spells an embedded quote as two of them.
    expect(indexed('the foo"bar case')('foo"bar')).toEqual(['the foo"bar case'])
  })

  it('does not let an unbalanced quote change the meaning of the query', () => {
    expect(() => indexed('hello world')('hello" OR "world')).not.toThrow()
  })
})

/**
 * `toAnyQuery` widened nothing in the language it matters most for. Chinese is
 * written without spaces, so a whole query was ONE run and one quoted phrase —
 * byte for byte the precise query — and the OR only ever appeared when the
 * caller had inserted spaces by hand.
 */
describe('widening a query nobody put spaces in', () => {
  it('is not simply the precise query again', () => {
    expect(toAnyQuery('苹果老师')).not.toBe(toMatchQuery('苹果老师'))
    expect(toAnyQuery('苹果老师')).toContain(' OR ')
  })

  it('finds a line holding only some of what was asked for', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE VIRTUAL TABLE t USING fts5(body, raw UNINDEXED)')
    const insert = db.prepare('INSERT INTO t(body, raw) VALUES(?, ?)')
    const lines = ['老师说了什么', '我买了苹果']
    for (const line of lines) insert.run(segment(line), line)
    const any = toAnyQuery('苹果老师')
    expect(any).not.toBeNull()
    const hits = db
      .prepare('SELECT raw FROM t WHERE t MATCH ? ORDER BY rank')
      .all(any as string)
      .map((row) => String(row['raw']))
    // The precise form demands both in one turn and finds neither line.
    expect(indexed(...lines)('苹果老师')).toEqual([])
    expect(hits.sort()).toEqual(lines.slice().sort())
  })
})
