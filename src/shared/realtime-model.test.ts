import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REALTIME_MODEL,
  REALTIME_MODELS,
  isRealtimeModel,
  readRealtimeModel,
} from './realtime-model'

describe('the offered models', () => {
  it('offers the default', () => {
    // A default that is not in the list is a picker opening on a value it
    // cannot show, which presents as the control being blank.
    expect(REALTIME_MODELS).toContain(DEFAULT_REALTIME_MODEL)
  })

  it('defaults to the newest of the line', () => {
    expect(DEFAULT_REALTIME_MODEL).toBe('gpt-realtime-2.1')
  })

  it('does NOT offer gpt-realtime', () => {
    // A structural assertion, not a tautology: `gpt-realtime` is what this
    // repository was pinned to before the picker existed, and it is the one
    // model on which a tool call's turn can be completely silent
    // (`findings.md` §12 and §24). Restoring it to the list should be a
    // deliberate act that turns this red, not a merge that nobody notices.
    expect(REALTIME_MODELS).not.toContain('gpt-realtime')
  })

  it('has no duplicates', () => {
    expect(new Set(REALTIME_MODELS).size).toBe(REALTIME_MODELS.length)
  })
})

describe('reading a stored value', () => {
  it('accepts every model it offers', () => {
    for (const model of REALTIME_MODELS) {
      expect(isRealtimeModel(model)).toBe(true)
      expect(readRealtimeModel(model)).toBe(model)
    }
  })

  it('refuses anything else', () => {
    // `gpt-realtime` among them: the service still answers to it, so this is
    // the case where a permissive check would silently keep somebody on a
    // model the picker cannot display.
    for (const value of ['gpt-realtime', 'gpt-4o-realtime-preview', '', 'GPT-REALTIME-2.1']) {
      expect(isRealtimeModel(value)).toBe(false)
    }
    for (const value of [null, undefined, 42, {}, ['gpt-realtime-2']]) {
      expect(isRealtimeModel(value)).toBe(false)
    }
  })

  it('falls back rather than throwing, for a file from another build', () => {
    // The real upgrade path: a `preferences.json` written by a LATER version
    // naming a model this build has never heard of. She must still be able to
    // talk.
    expect(readRealtimeModel('gpt-realtime-9')).toBe(DEFAULT_REALTIME_MODEL)
    expect(readRealtimeModel(undefined)).toBe(DEFAULT_REALTIME_MODEL)
    expect(readRealtimeModel(null)).toBe(DEFAULT_REALTIME_MODEL)
  })
})
