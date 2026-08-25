import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTranscripts } from './transcripts'
import type { Transcripts } from './transcripts'
import type { LiveSession } from './turn-row'

/**
 * What a turn's INSTANT is allowed to be.
 *
 * Every value here reaches the store from the renderer — `at` travels on
 * `VoiceReport`, which is a cast at the IPC boundary — so these are not
 * defence against a bug in main, they are defence against the least trusted
 * process in the app. Grouped in their own file rather than added to
 * `transcripts.test.ts` because they share one root cause: a number nobody
 * bounded, reaching SQLite.
 *
 * The reason this is worth a file of its own is that `node:sqlite` does not
 * fail the row — it throws while MATERIALISING the result set, so one bad
 * value takes out every read that touches it, including the read that draws
 * the pane holding the delete button.
 */

let userData = ''
let store: Transcripts

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-turn-time-'))
  store = createTranscripts(userData)
})

afterEach(() => {
  store.close()
  rmSync(userData, { recursive: true, force: true })
})

/** Larger than 2^53. `node:sqlite` throws rather than rounding. */
const UNSAFE = 1e17

describe('a turn dated outside the safe integer range', () => {
  it('is refused rather than stored', () => {
    const token = store.begin('ada', 1_000)
    expect(token).not.toBeNull()
    store.say(token as LiveSession, 'her', 'hello', UNSAFE)

    // The point is not that the turn is missing. It is that the read still
    // WORKS -- an unreadable archive is the failure this guards.
    const sessions = store.sessions('ada')
    expect(sessions).toHaveLength(1)
    expect(store.turns('ada', token as LiveSession)).toHaveLength(0)
  })

  it('leaves the conversation list readable', () => {
    const token = store.begin('ada', 1_000)
    store.say(token as LiveSession, 'her', 'hello', UNSAFE)
    store.say(token as LiveSession, 'you', 'still here', 2_000)

    // Reproduces the reported failure in the direction that matters: the good
    // turn survives and the list renders. Before the guard this threw.
    expect(() => store.sessions('ada')).not.toThrow()
    expect(store.turns('ada', token as LiveSession).map((t) => t.text)).toEqual(['still here'])
  })

  it('does not poison search', () => {
    const token = store.begin('ada', 1_000)
    store.say(token as LiveSession, 'her', 'findable', UNSAFE)
    store.say(token as LiveSession, 'you', 'findable too', 2_000)
    expect(() => store.search('ada', 'findable')).not.toThrow()
  })

  it('refuses a non-integer and a NaN', () => {
    const token = store.begin('ada', 1_000)
    store.say(token as LiveSession, 'her', 'fractional', 1_500.5)
    store.say(token as LiveSession, 'her', 'not a number', Number.NaN)
    store.say(token as LiveSession, 'her', 'infinite', Number.POSITIVE_INFINITY)
    expect(store.turns('ada', token as LiveSession)).toHaveLength(0)
    expect(() => store.sessions('ada')).not.toThrow()
  })

  it('refuses to BEGIN a conversation at an unsafe instant', () => {
    // Otherwise the guard on `say` is unreachable: every turn is compared
    // against `started_at`, and a poisoned `started_at` breaks the comparison
    // itself as well as every read of the row.
    expect(store.begin('ada', UNSAFE)).toBeNull()
    expect(() => store.sessions('ada')).not.toThrow()
    expect(store.sessions('ada')).toHaveLength(0)
  })
})

describe('a clock that steps backward', () => {
  it('does not silently drop the rest of the conversation', () => {
    const token = store.begin('ada', 10_000)
    // NTP steps the clock back an hour. Every subsequent turn is now dated
    // before the conversation began.
    store.say(token as LiveSession, 'you', 'said during the step', 5_000)

    // The turn is kept, clamped to the conversation's own start, rather than
    // dropped. Losing an hour of somebody's conversation to a clock correction
    // is a worse outcome than a turn whose order is approximate.
    const turns = store.turns('ada', token as LiveSession)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.text).toBe('said during the step')
    expect(turns[0]?.at).toBe(10_000)
  })
})

describe('ending a conversation', () => {
  it('refuses an end before the beginning', () => {
    const token = store.begin('ada', 10_000)
    store.end(token as LiveSession, 5_000)

    // An export carrying `ended_at < started_at` is one this store's own parser
    // rejects -- so a single such row makes the user's WHOLE export
    // unimportable, not just this conversation.
    const [session] = store.sessions('ada')
    expect(session?.endedAt === null || (session?.endedAt ?? 0) >= 10_000).toBe(true)
  })

  it('refuses an unsafe end instant', () => {
    const token = store.begin('ada', 10_000)
    store.end(token as LiveSession, UNSAFE)
    expect(() => store.sessions('ada')).not.toThrow()
    const [session] = store.sessions('ada')
    expect(session?.endedAt === null || (session?.endedAt ?? 0) < UNSAFE).toBe(true)
  })
})
