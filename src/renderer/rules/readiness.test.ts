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

/*
  The `too-old` suite was here — six cases about version comparison.

  It went with the state, and the state went because the fact it needs does not
  exist: nothing records which Codex version this build's read-only confinement
  was measured against, so there was no second operand. The tests passed against
  a `builtAgainst` the tests themselves supplied, which is the shape of a check
  that can only ever agree with itself.
*/

describe('older than the version the confinement was measured on', () => {
  it('reads the version out of what the CLI actually prints', () => {
    // `codex --version` prints `codex-cli 0.151.0` and `askVersion` sends the
    // whole trimmed line. An anchored pattern rejects that and the state becomes
    // unreachable on every real machine — which is exactly how it shipped.
    expect(readinessOf(probe({ version: 'codex-cli 0.121.0' })).state).toBe('too-old')
    expect(readinessOf(probe({ version: 'codex-cli 0.151.0' })).state).toBe('ready')
  })

  it('still reads a bare number', () => {
    expect(readinessOf(probe({ version: '0.121.0' })).state).toBe('too-old')
    expect(readinessOf(probe({ version: '0.148.0' })).state).toBe('ready')
  })

  it('compares numerically, not as text', () => {
    // '0.9.0' > '0.10.0' as strings, and the answer would be backwards.
    expect(readinessOf(probe({ version: 'codex-cli 0.9.0' })).state).toBe('too-old')
    expect(readinessOf(probe({ version: 'codex-cli 1.0.0' })).state).toBe('ready')
  })

  it('says nothing about a version it cannot find a number in', () => {
    // `askVersion` falls back to this exact string when the CLI answers nothing.
    for (const version of ['unknown version', '', null]) {
      expect(readinessOf(probe({ version })).state, String(version)).toBe('ready')
    }
  })

  it('is usable, and still offers the update', () => {
    // She can look things up with it. What is unestablished is the confinement.
    const drawn = readinessOf(probe({ version: 'codex-cli 0.121.0' }))
    expect(drawn.certainty).toBe('usable')
    expect(drawn.action).toBe('update-it')
  })

  it('only asks the question when the tool is otherwise ready', () => {
    expect(
      readinessOf(probe({ readiness: 'not-installed', version: 'codex-cli 0.1.0' })).state,
    ).toBe('not-installed')
  })
})

describe('the states it answers', () => {
  it('offers no action nobody can take', () => {
    // Every action has a control behind it in `looking.ts`'s `ACTION_SAYS`. An
    // action added here without one is a button with no words.
    for (const readiness of CODEX_READINESS) {
      expect([
        'check-again',
        'open-a-terminal',
        'how-to-install',
        'sign-in-again',
        'try-again',
      ]).toContain(readinessOf(probe({ readiness })).action)
    }
  })
})
