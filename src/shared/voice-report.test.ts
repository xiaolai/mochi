import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { readVoiceReport } from './voice-report'

/**
 * The renderer is the least trusted process in the app, and this is the one
 * channel on which it hands main a NUMBER that reaches SQLite.
 *
 * These are not tests of a parser's tidiness. Before this existed the handler
 * did `report as VoiceReport` and every field below reached the store exactly
 * as sent.
 */

const AT = 1_700_000_000_000

describe('reading what the renderer reports', () => {
  it('accepts each shape of the union', () => {
    expect(readVoiceReport({ kind: 'flushed' })?.kind).toBe('flushed')
    expect(readVoiceReport({ kind: 'expiry', expiresAt: 1_700_000_000 })?.kind).toBe('expiry')
    expect(readVoiceReport({ kind: 'heard', transcript: 'hello' })?.kind).toBe('heard')
    expect(
      readVoiceReport({ kind: 'said', transcript: 'hi', phase: null, at: AT, heard: null })?.kind,
    ).toBe('said')
  })

  it('keeps the fields it accepted', () => {
    const said = readVoiceReport({
      kind: 'said',
      transcript: 'hi',
      phase: 'final_answer',
      at: AT,
      heard: { at: AT, interruptedAt: AT + 5 },
    })
    expect(said).toEqual({
      kind: 'said',
      transcript: 'hi',
      phase: 'final_answer',
      at: AT,
      heard: { at: AT, interruptedAt: AT + 5 },
    })
  })

  it('accepts the three kinds that carry no instant', () => {
    /*
      A REGRESSION TEST FOR THIS FILE'S OWN FIRST DRAFT.

      The parser was written against four members of the union because four
      were what I had read, and the tests were written from the same reading,
      so they passed. `pointer` drives click-through on the companion window,
      `state` and `note` drive the log -- all three would have been dropped at
      the boundary, silently, with a green suite.

      This asserts the count as well as the members: a new kind added to
      `VoiceReport` without a case here fails this, which is the only thing
      that makes the omission loud rather than quiet.
    */
    expect(readVoiceReport({ kind: 'pointer', onHer: true })).toEqual({
      kind: 'pointer',
      onHer: true,
    })
    expect(readVoiceReport({ kind: 'state', state: 'connected' })?.kind).toBe('state')
    expect(readVoiceReport({ kind: 'note', text: 'anything' })?.kind).toBe('note')
    expect(readVoiceReport({ kind: 'pointer', onHer: 'yes' })).toBeNull()
    expect(readVoiceReport({ kind: 'state' })).toBeNull()
    expect(readVoiceReport({ kind: 'note', text: 7 })).toBeNull()
  })

  it('handles every kind the union declares', () => {
    // Read from the type's own source, so adding a member without a case here
    // fails rather than passing quietly. The union is the spec; this is the
    // check that the parser still matches it.
    const source = readFileSync(fileURLToPath(new URL('./ipc.ts', import.meta.url)), 'utf8')
    const union = source.slice(source.indexOf('export type VoiceReport'))
    const declared = new Set(
      [...union.slice(0, union.indexOf('\nimport ')).matchAll(/readonly kind: '([a-z]+)'/g)].map(
        (m) => m[1] as string,
      ),
    )
    expect(declared.size).toBeGreaterThanOrEqual(7)
    for (const kind of declared) {
      // Every declared kind must be REACHABLE: a bare `{kind}` either parses
      // (no other required fields) or fails on a field, never on the kind.
      const parsed = readVoiceReport({
        kind,
        transcript: 'x',
        phase: null,
        at: AT,
        heard: null,
        expiresAt: AT,
        onHer: true,
        state: 'x',
        text: 'x',
      })
      expect(parsed, `kind '${kind}' is not handled by readVoiceReport`).not.toBeNull()
    }
  })

  it('refuses anything that is not one of the declared kinds', () => {
    expect(readVoiceReport(null)).toBeNull()
    expect(readVoiceReport(undefined)).toBeNull()
    expect(readVoiceReport('flushed')).toBeNull()
    expect(readVoiceReport(42)).toBeNull()
    expect(readVoiceReport([])).toBeNull()
    expect(readVoiceReport({})).toBeNull()
    expect(readVoiceReport({ kind: 'nonsense' })).toBeNull()
  })

  it('refuses an instant SQLite cannot read back', () => {
    // The reported failure. 1e17 is a valid JavaScript number and an INTEGER
    // SQLite will store, and `node:sqlite` throws for the whole result set
    // when it reads one back.
    const shape = { kind: 'said', transcript: 'hi', phase: null, heard: null }
    expect(readVoiceReport({ ...shape, at: 1e17 })).toBeNull()
    expect(readVoiceReport({ ...shape, at: Number.NaN })).toBeNull()
    expect(readVoiceReport({ ...shape, at: Number.POSITIVE_INFINITY })).toBeNull()
    expect(readVoiceReport({ ...shape, at: -1 })).toBeNull()
    expect(readVoiceReport({ ...shape, at: 1.5 })).toBeNull()
    expect(readVoiceReport({ ...shape, at: '1700000000000' })).toBeNull()
  })

  it('refuses an unreadable instant nested inside `heard`', () => {
    // `heard.at` and `heard.interruptedAt` reach the cutting arithmetic rather
    // than the database, but an infinity there produces a NaN cursor and a
    // turn cut at a length nobody can explain.
    const shape = { kind: 'said', transcript: 'hi', phase: null, at: AT }
    expect(readVoiceReport({ ...shape, heard: { at: 1e17, interruptedAt: AT } })).toBeNull()
    expect(readVoiceReport({ ...shape, heard: { at: AT, interruptedAt: Number.NaN } })).toBeNull()
    expect(readVoiceReport({ ...shape, heard: { at: AT } })).toBeNull()
  })

  it('refuses an expiry that is not a usable number', () => {
    expect(readVoiceReport({ kind: 'expiry', expiresAt: Number.NaN })).toBeNull()
    expect(readVoiceReport({ kind: 'expiry', expiresAt: 1e17 })).toBeNull()
    expect(readVoiceReport({ kind: 'expiry' })).toBeNull()
  })

  it('refuses a transcript that is not a string', () => {
    expect(readVoiceReport({ kind: 'heard', transcript: 42 })).toBeNull()
    expect(readVoiceReport({ kind: 'heard' })).toBeNull()
    expect(
      readVoiceReport({ kind: 'said', transcript: null, phase: null, at: AT, heard: null }),
    ).toBeNull()
  })

  it('refuses a phase that is neither a string nor null', () => {
    expect(
      readVoiceReport({ kind: 'said', transcript: 'hi', phase: 7, at: AT, heard: null }),
    ).toBeNull()
    expect(readVoiceReport({ kind: 'said', transcript: 'hi', at: AT, heard: null })).toBeNull()
  })

  it('does not carry extra properties through', () => {
    // A cast let anything ride along. The store writes what it is given, so a
    // rebuilt object is the difference between "validated" and "checked".
    const said = readVoiceReport({
      kind: 'said',
      transcript: 'hi',
      phase: null,
      at: AT,
      heard: null,
      __proto__: { polluted: true },
      extra: 'ignored',
    })
    expect(said).not.toBeNull()
    expect(Object.hasOwn(said as object, 'extra')).toBe(false)
  })
})
