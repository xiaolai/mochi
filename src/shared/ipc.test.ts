/**
 * The boundary check on reports arriving from the renderer.
 *
 * Main used to cast this payload straight to `VoiceReport`. That is the least
 * trusted process in the app — it is the one loading a face out of a
 * user-writable folder — and a `null` threw inside the handler while any object
 * of roughly the right shape could drive the lifecycle.
 */

import { describe, expect, it } from 'vitest'
import { ROLE_FLAG, parseVoiceReport, roleFromArgv, type VoiceReport } from './ipc'

describe('parseVoiceReport', () => {
  it('accepts each report the renderer is allowed to send', () => {
    for (const kind of ['ready', 'voiceStarted', 'voiceStopped', 'userSpoke'] as const) {
      expect(parseVoiceReport({ kind, attempt: 3 })).toEqual({ kind, attempt: 3 })
    }
    for (const kind of ['openFailed', 'sessionLost'] as const) {
      expect(parseVoiceReport({ kind, attempt: 1, reason: 'why' })).toEqual({
        kind,
        attempt: 1,
        reason: 'why',
      })
    }
  })

  it('refuses an attempt number no session could ever have had', () => {
    // The lifecycle starts its counter at 0 and increments BEFORE each open, so
    // the first live attempt is 1. A report claiming 0 or a negative number
    // belongs to no session that ever existed -- and 0 in particular was
    // accepted here and then compared, in main, against the sentinel that means
    // "no attempt".
    for (const attempt of [0, -1, -99]) {
      expect(parseVoiceReport({ kind: 'ready', attempt }), String(attempt)).toBeNull()
    }
    expect(parseVoiceReport({ kind: 'ready', attempt: 1 })).not.toBeNull()
  })

  it('rejects the payloads that used to reach the lifecycle', () => {
    // Each of these was previously cast straight through.
    expect(parseVoiceReport(null)).toBeNull()
    expect(parseVoiceReport(undefined)).toBeNull()
    expect(parseVoiceReport('ready')).toBeNull()
    expect(parseVoiceReport(42)).toBeNull()
    expect(parseVoiceReport([])).toBeNull()
    expect(parseVoiceReport({})).toBeNull()
    expect(parseVoiceReport({ kind: 'ready' })).toBeNull()
    expect(parseVoiceReport({ kind: 'nonsense', attempt: 1 })).toBeNull()
  })

  it('requires a reason on the two reports that carry one', () => {
    expect(parseVoiceReport({ kind: 'openFailed', attempt: 1 })).toBeNull()
    expect(parseVoiceReport({ kind: 'sessionLost', attempt: 1, reason: 7 })).toBeNull()
  })

  it('rejects an attempt that is not a usable integer', () => {
    // NaN is the dangerous one: it compares unequal to every attempt including
    // itself, so it would not be rejected by the lifecycle's match — it would
    // be dropped there forever with no explanation.
    expect(parseVoiceReport({ kind: 'ready', attempt: Number.NaN })).toBeNull()
    expect(parseVoiceReport({ kind: 'ready', attempt: 1.5 })).toBeNull()
    expect(parseVoiceReport({ kind: 'ready', attempt: '1' })).toBeNull()
    expect(parseVoiceReport({ kind: 'ready', attempt: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('does not carry unexpected fields through', () => {
    const parsed = parseVoiceReport({ kind: 'ready', attempt: 1, extra: 'ignored' })
    expect(parsed).toEqual({ kind: 'ready', attempt: 1 })
  })
})

describe('every report the renderer can send survives the crossing', () => {
  /**
   * One sample per member of the union, checked by EXHAUSTIVENESS.
   *
   * This exists because a report kind was added to the type, sent by the
   * renderer, and never given a case here -- so every one of them was dropped
   * as malformed, on a channel whose failure is one line in a dev log. The
   * measurement it carried was computed correctly and thrown away one hop
   * later, and nothing above or below said so.
   *
   * The `satisfies` is what makes this a guard rather than a list: a new
   * member of `VoiceReport` with no sample here stops compiling, and a sample
   * that stops parsing fails below.
   */
  const SAMPLES = {
    ready: { kind: 'ready', attempt: 1 },
    openFailed: { kind: 'openFailed', attempt: 1, reason: 'no' },
    sessionLost: { kind: 'sessionLost', attempt: 1, reason: 'gone' },
    voiceStarted: { kind: 'voiceStarted', attempt: 1 },
    voiceStopped: { kind: 'voiceStopped', attempt: 1 },
    userSpoke: { kind: 'userSpoke', attempt: 1 },
    loopback: { kind: 'loopback', attempt: 1, present: true },
    utteranceEnded: { kind: 'utteranceEnded', attempt: 1, utterance: 3, outcome: 'played' },
    said: { kind: 'said', attempt: 1, who: 'you', text: 'hello' },
    workspaceAsked: { kind: 'workspaceAsked', attempt: 1, callId: 'call_1', question: 'what?' },
  } satisfies Record<VoiceReport['kind'], VoiceReport>

  it('parses one of every kind', () => {
    const dropped = Object.entries(SAMPLES)
      .filter(([, sample]) => parseVoiceReport(sample) === null)
      .map(([kind]) => kind)
    expect(dropped, `these are sent and silently discarded: ${dropped.join(', ')}`).toEqual([])
  })

  it('keeps the payload, not just the kind', () => {
    // A case that returns `{ kind, attempt }` and drops the rest would pass the
    // test above while losing the only thing the report exists to carry.
    expect(parseVoiceReport(SAMPLES.loopback)).toEqual({
      kind: 'loopback',
      attempt: 1,
      present: true,
    })
    expect(parseVoiceReport({ ...SAMPLES.loopback, present: 'yes' })).toBeNull()
    expect(parseVoiceReport(SAMPLES.utteranceEnded)).toEqual({
      kind: 'utteranceEnded',
      attempt: 1,
      utterance: 3,
      outcome: 'played',
    })
    // An outcome outside the three is not a fourth meaning to guess at.
    expect(parseVoiceReport({ ...SAMPLES.utteranceEnded, outcome: 'maybe' })).toBeNull()
  })
})

describe('roleFromArgv', () => {
  it('reads the role a window was opened with', () => {
    expect(roleFromArgv(['--foo', `${ROLE_FLAG}settings`, '--bar'])).toBe('settings')
    expect(roleFromArgv([`${ROLE_FLAG}companion`])).toBe('companion')
  })

  it('returns null rather than defaulting to the PRIVILEGED role', () => {
    // The direction of this used to be the decision, and it was decided on the
    // wrong axis: it fell back to `companion` because a bridge-less companion
    // fails visibly. `companion` is the privileged bridge -- it moves her
    // window, disables click-through, mints an API key and opens a microphone
    // -- so any window opened without a role was handed the whole capability
    // set. A boundary that fails open is not a boundary.
    for (const argv of [[], ['--other=1'], [`${ROLE_FLAG}nonsense`], [ROLE_FLAG]]) {
      expect(roleFromArgv(argv), JSON.stringify(argv)).toBeNull()
    }
  })

  it('refuses two role flags rather than picking one', () => {
    // Taking the first match meant argument ORDER decided which role a window
    // got -- and the order of `additionalArguments` is not visible from the
    // window code that sets it. Two roles is a mistake, and guessing which was
    // meant is how the privileged one gets handed out by accident.
    expect(roleFromArgv([`${ROLE_FLAG}settings`, `${ROLE_FLAG}companion`])).toBeNull()
    expect(roleFromArgv([`${ROLE_FLAG}companion`, `${ROLE_FLAG}companion`])).toBeNull()
  })

  it('is not fooled by a flag that merely contains the role', () => {
    // `--not-the--mochi-role=settings` must not match. `startsWith` is what
    // makes that true, and this is the assertion that keeps it `startsWith`.
    expect(roleFromArgv(['--x=--mochi-role=settings'])).toBeNull()
  })
})

/**
 * `workspaceAsked` carries model output into a process this app spawns, so the
 * parser is the boundary that has to hold.
 */
describe('a workspace question from the renderer', () => {
  const asked = (over: Record<string, unknown>): unknown => ({
    kind: 'workspaceAsked',
    attempt: 1,
    callId: 'call_1',
    question: 'what changed?',
    ...over,
  })

  it('accepts a well-formed one', () => {
    expect(parseVoiceReport(asked({}))).toEqual({
      kind: 'workspaceAsked',
      attempt: 1,
      callId: 'call_1',
      question: 'what changed?',
    })
  })

  it.each([
    ['a missing call id', { callId: undefined }],
    ['a non-string call id', { callId: 7 }],
    ['an empty call id', { callId: '' }],
    ['a non-string question', { question: 7 }],
  ])('rejects %s', (_name, over) => {
    expect(parseVoiceReport(asked(over))).toBeNull()
  })

  /**
   * An empty question is KEPT. Main has to answer the call either way -- an
   * unanswered `function_call_output` stays in the conversation for the rest of
   * the session -- so it refuses with a reason rather than dropping the report.
   */
  it('keeps an empty question so the call can still be answered', () => {
    expect(parseVoiceReport(asked({ question: '' }))).toMatchObject({ question: '' })
  })

  /**
   * Control characters in the QUESTION would forge log lines in main.
   *
   * Replaced by a space rather than deleted, which is `stripControl`'s
   * behaviour throughout: removing them outright would silently join two words
   * that were separated by whatever was stripped.
   */
  it('strips control characters from the question', () => {
    const parsed = parseVoiceReport(asked({ question: `a${String.fromCharCode(7)}b` }))
    expect(parsed).toMatchObject({ question: 'a b' })
  })

  /**
   * The id is REFUSED rather than repaired, which is the opposite treatment
   * and the opposite reason.
   *
   * It is an opaque correlation token: the answer is delivered by sending it
   * back, and the service matches it byte for byte. An id that was cleaned no
   * longer names the call it came from — so the delegation ran, spent the
   * user's quota, and delivered its answer against nothing. Refusing costs one
   * report; repairing costs a run whose answer can never arrive.
   */
  it.each([
    ['a control character', `c${String.fromCharCode(9)}d`],
    ['a space', 'call abc'],
    ['a quote', 'call_"abc'],
    ['a line separator', `call\u2028abc`],
    ['emptiness', ''],
  ])('refuses a call id containing %s rather than rewriting it', (_what, callId) => {
    expect(parseVoiceReport(asked({ callId }))).toBeNull()
  })

  it('passes a real call id through byte for byte', () => {
    // The measured shape, from a live session.
    const callId = 'call_jT8hb57lFVeqP0OZ'
    expect(parseVoiceReport(asked({ callId }))).toMatchObject({ callId })
  })
})

/**
 * The one thing `clean` promises is a bound, and it broke that bound for every
 * value it actually acted on: the ellipsis was appended AFTER the slice, so a
 * truncated string was one unit longer than the limit it was given.
 */
describe('truncation stays inside the limit', () => {
  it('never exceeds the bound it was given', () => {
    // Twice the bound, whatever the bound is: the property is "never longer
    // than the limit", not a particular number, and hard-coding one here would
    // make the test agree with a copy of the constant rather than with it.
    const oversized = 'x'.repeat(20_000)
    const parsed = parseVoiceReport({
      kind: 'said',
      attempt: 1,
      who: 'you',
      text: oversized,
    }) as { text: string } | null
    expect(parsed).not.toBeNull()
    expect(parsed!.text.endsWith('…'), 'it was not truncated at all').toBe(true)
    // The ellipsis used to be appended AFTER the slice, so the result was one
    // unit longer than the limit for every value this ever acted on.
    expect(parsed!.text.length).toBeLessThan(oversized.length)
    expect(parsed!.text.length % 1000).toBe(0)
  })

  /** Slicing by code UNIT can land between a surrogate pair and emit half of one. */
  it('does not cut a character in half', () => {
    const long = '😀'.repeat(4000)
    const parsed = parseVoiceReport({ kind: 'said', attempt: 1, who: 'you', text: long }) as {
      text: string
    } | null
    expect(parsed).not.toBeNull()
    expect(parsed!.text).not.toMatch(/[\uD800-\uDFFF]$/)
    expect(parsed!.text.replace('…', '')).toBe('😀'.repeat(Array.from(parsed!.text).length - 1))
  })
})

/** Ids are minted from 1. Zero and negatives are shapes no sender produces. */
describe('an utterance id that could not have been minted', () => {
  it.each([0, -1, -9007199254740991])('is refused: %s', (utterance) => {
    expect(
      parseVoiceReport({ kind: 'utteranceEnded', attempt: 1, utterance, outcome: 'played' }),
    ).toBeNull()
  })

  it('accepts the first real one', () => {
    expect(
      parseVoiceReport({ kind: 'utteranceEnded', attempt: 1, utterance: 1, outcome: 'played' }),
    ).toMatchObject({ utterance: 1 })
  })
})
