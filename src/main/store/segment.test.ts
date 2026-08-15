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
import { segment, toMatchQuery } from './segment'

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
