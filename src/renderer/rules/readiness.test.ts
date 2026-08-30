import { describe, expect, it } from 'vitest'
import { CODEX_READINESS } from '@shared/delegation'
import { readinessOf, type Probe } from './readiness'

const probe = (over: Partial<Probe> = {}): Probe => ({
  readiness: 'ready',
  checking: false,
  ...over,
})

describe('unknown is not unavailable', () => {
  it('says nothing either way while a check is running', () => {
    // Drawing this as "not installed" is what tells somebody to reinstall a
    // working tool. The whole card exists for these two states.
    const drawn = readinessOf(probe({ checking: true, readiness: 'not-installed' }))
    expect(drawn.state).toBe('checking')
    expect(drawn.certainty).toBe('unknown')
  })

  it('says nothing either way when the check did not come back', () => {
    const drawn = readinessOf(probe({ readiness: 'timed-out' }))
    expect(drawn.state).toBe('no-answer')
    expect(drawn.certainty).toBe('unknown')
    expect(drawn.action).toBe('try-again')
  })

  it('lets a check in flight beat whatever the last one said', () => {
    // "Checking…" over yesterday's verdict is two claims about one machine, and
    // the stale one is the one that looks current.
    for (const readiness of CODEX_READINESS) {
      expect(readinessOf(probe({ readiness, checking: true })).state).toBe('checking')
    }
  })
})

describe('every state the wire can carry has somewhere to go', () => {
  it('answers for all of them, and never twice the same way', () => {
    // Exhaustive over the wire's own list rather than a list retyped here: a
    // status added to `CODEX_READINESS` that nobody decided how to draw should
    // fail here rather than ship as a blank card.
    const drawn = CODEX_READINESS.map((readiness) => readinessOf(probe({ readiness })))
    expect(drawn).toHaveLength(CODEX_READINESS.length)
    expect(new Set(drawn.map((one) => one.state)).size).toBe(CODEX_READINESS.length)
  })

  it('does not confuse "would not run" with "not installed"', () => {
    // Different sentences and different remedies. Folding them sends somebody
    // looking for a binary that is already there.
    expect(readinessOf(probe({ readiness: 'unusable' })).state).toBe('would-not-run')
    expect(readinessOf(probe({ readiness: 'not-installed' })).state).toBe('not-installed')
  })

  it('sends a signed-out machine to a terminal, because only Codex can log in', () => {
    expect(readinessOf(probe({ readiness: 'logged-out' })).action).toBe('open-a-terminal')
  })

  it('offers one action and only one, in every state', () => {
    for (const readiness of CODEX_READINESS) {
      expect(typeof readinessOf(probe({ readiness })).action).toBe('string')
    }
  })
})

describe('older than this build was made against', () => {
  it('is usable, and still offers the update', () => {
    // She can look things up with it. What is unestablished is the read-only
    // confinement, which is a caveat in the sentence rather than a reason to
    // draw a working tool as broken.
    const drawn = readinessOf(probe({ version: '0.121.0', builtAgainst: '0.148.0' }))
    expect(drawn.state).toBe('too-old')
    expect(drawn.certainty).toBe('usable')
    expect(drawn.action).toBe('update-it')
  })

  it('is not old when it is the same or newer', () => {
    for (const version of ['0.148.0', '0.149.0', '1.0.0', 'v0.148.0']) {
      expect(readinessOf(probe({ version, builtAgainst: '0.148.0' })).state, version).toBe('ready')
    }
  })

  it('compares numerically, not as text', () => {
    // '0.9.0' > '0.10.0' as strings, and the answer would be backwards.
    expect(readinessOf(probe({ version: '0.9.0', builtAgainst: '0.10.0' })).state).toBe('too-old')
    expect(readinessOf(probe({ version: '0.10.0', builtAgainst: '0.9.0' })).state).toBe('ready')
  })

  it('says nothing about a version it cannot parse', () => {
    // An unknown is not an "old". Telling somebody to update something that may
    // already be current is the same class of wrong advice as "reinstall it".
    for (const version of ['unknown version', '', 'nightly-2026-08-30']) {
      expect(readinessOf(probe({ version, builtAgainst: '0.148.0' })).state, version).toBe('ready')
    }
    expect(readinessOf(probe({ version: '0.1.0', builtAgainst: null })).state).toBe('ready')
  })

  it('only asks the question when the tool is otherwise ready', () => {
    // A version comparison on a machine with no Codex on it is an answer to a
    // question nobody asked.
    expect(
      readinessOf(probe({ readiness: 'not-installed', version: '0.1.0', builtAgainst: '9.9' }))
        .state,
    ).toBe('not-installed')
  })
})
