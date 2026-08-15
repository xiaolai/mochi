import { describe, expect, it } from 'vitest'
import { DEFAULT_DELEGATION, RESERVED_NAMES, mergeDelegation, readDelegation } from './delegation'

describe('audit regressions', () => {
  /**
   * `model` and `effort` become `codex exec` argv, and the effort additionally
   * becomes part of a TOML expression. A quote would end that expression early,
   * a NUL makes spawn throw, and an unbounded value is a self-inflicted E2BIG.
   */
  it.each([
    ['a quote', 'high" --sandbox danger-full-access'],
    ['a NUL', 'hi\u0000gh'],
    ['a newline', 'high\nlow'],
    ['a space', 'gpt 5'],
    ['a slash', '../../etc/passwd'],
    ['something enormous', 'a'.repeat(500)],
    ['a leading dash', '-high'],
  ])('drops %s rather than passing it to a process', (_name, value) => {
    expect(readDelegation({ model: value, effort: value })).toMatchObject({
      model: null,
      effort: null,
    })
  })

  it('keeps the shapes a real slug and a real level have', () => {
    expect(readDelegation({ model: 'gpt-5.6-sol', effort: 'xhigh' })).toMatchObject({
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
    })
  })
})

describe('round-1 audit regressions', () => {
  /**
   * The effort control added so somebody following Codex could still ask for a
   * faster answer saved NOTHING: the parser cleared it whenever the model was
   * null. The pane's own test used a stub save, so it never crossed this line.
   */
  it('keeps an effort chosen while the model follows Codex', () => {
    expect(readDelegation({ model: null, effort: 'low' })).toMatchObject({
      model: null,
      effort: 'low',
    })
  })

  /** Loaded by 0.147.0 exactly as AGENTS.md is, and missed by the first list. */
  it('reserves the override filename too', () => {
    expect(RESERVED_NAMES['agents.override.md']).toBe('agents-md')
  })
})

/** The same file-versus-message split `mergeSound` documents. */
describe('merging a partial delegation message', () => {
  it('leaves every field the message does not mention', () => {
    const stored = { ...DEFAULT_DELEGATION, model: 'gpt-5.6-sol', effort: 'high' as const }
    const merged = mergeDelegation(stored, { webSearch: 'live' })
    expect(merged.model, 'a partial message cleared the model').toBe('gpt-5.6-sol')
    expect(merged.effort).toBe('high')
    expect(merged.webSearch).toBe('live')
  })

  it('contributes nothing for a message that is not an object', () => {
    const stored = { ...DEFAULT_DELEGATION, model: 'gpt-5.6-sol' }
    for (const value of [null, undefined, 7, 'model']) {
      expect(mergeDelegation(stored, value), JSON.stringify(value ?? null)).toEqual(stored)
    }
  })
})
