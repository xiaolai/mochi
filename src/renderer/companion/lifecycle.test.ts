import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Who decides that a session opens — asserted across the boundary, because
 * neither side can be wrong on its own.
 *
 * ## The failure this exists for is silent in BOTH directions
 *
 * `companion/main.ts` used to end in a bare `void open()`, so a session was
 * negotiated on every launch before anything had asked for one — including a
 * launch into a stored `asleep: true`, where the whole meaning of the state is
 * that she is not participating. Resting muted the microphone track and left
 * the peer, the data channel and the hourly reconnect (§53) running, so a
 * machine left on overnight opened a session an hour, all night, into an empty
 * room and greeted it each time.
 *
 * Main asks now, from `did-finish-load`, and only when she is awake. Both
 * halves are load-bearing and each fails quietly without the other:
 *
 *   - put the renderer's own `open()` back, and she connects while resting.
 *     Nothing on screen changes, because resting was only ever a picture; the
 *     cost is a live credential and an open connection nobody asked for.
 *   - drop main's send, and she never connects at all. That looks exactly like
 *     a session that failed, which is the one thing this repository's own
 *     `window.ts` comment says a log must be able to tell apart.
 *
 * Neither shows up in a typecheck, in a lint, or in any test of either module
 * alone — the contract is between two processes and its subject is an absence.
 *
 * ## Why the source text rather than a running window
 *
 * The same technique `documents.test.ts` uses on the markup, and for the same
 * reason: the thing being checked is a fact about a file that no unit of it can
 * observe. It was proved non-vacuous by hand against a real Electron probe —
 * the built companion, a stubbed bridge, and a count of how many times `open()`
 * crossed it: **0 after load, 1 after `__mochi_reconnect__`, and 0 more after
 * `__mochi_close__`.**
 */

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Everything outside a block comment, so an argument about `open()` is not one. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('who opens a session', () => {
  it('is not the renderer, on its own, at module scope', () => {
    const companion = code(source('./main.ts'))
    // At COLUMN ZERO, which is the only place a call runs by the module being
    // imported. The indented ones are real and stay: a wake asks for a session.
    expect(companion).not.toMatch(/^void open\(\)/m)
    /*
      Non-vacuous by construction: an indented call must still be there, or this
      assertion would pass on a file that had lost them all.

      It matched `/^ +void open\(\)/` — an indented call at the START of its
      line — until the two that ran when the microphone grant came back were
      deleted with the grant. What is left is `if (type === '__mochi_reconnect__')
      void open()`, which is indented and is not at the start of its line, so the
      old pattern reported a file with no calls in it at all. Anywhere but column
      zero is what the check has always MEANT.
    */
    expect(companion).toMatch(/^ +.*\bvoid open\(\)/m)
  })

  it('is main, once the window has loaded and only while she is awake', () => {
    const index = code(source('../../main/index.ts'))
    const hook = /did-finish-load'[\s\S]*?\n {4}\}\)/.exec(index)?.[0]
    expect(hook, 'main hangs the first open on did-finish-load').toBeDefined()
    expect(hook).toContain('resting.asleep')
    expect(hook).toContain('__mochi_reconnect__')
  })

  it('tells her window she is asleep BEFORE the branch that may return', () => {
    /*
      The bug this is an assertion against, not a description of a design.

      The hook returns early when she was left resting, so on that launch the
      renderer was told the halo preference and the shoulder control and never
      told the one fact both are read against. It starts `asleep = false` and
      the rig starts `hearing = true`, so the ring drawn over a companion with
      no session at all was `open` — her colour, filled, meaning the microphone
      is live.

      Positional, because the ORDER is the whole of it: a send after
      `if (resting.asleep) return` is a send that never happens in exactly the
      case it exists for.
    */
    const index = code(source('../../main/index.ts'))
    const hook = /did-finish-load'[\s\S]*?\n {4}\}\)/.exec(index)?.[0] ?? ''
    const told = hook.indexOf('__mochi_asleep__')
    const branch = hook.indexOf('if (resting.asleep)')
    expect(told, 'main tells her window whether she is asleep').toBeGreaterThan(-1)
    expect(branch, 'the hook still has the early return this is about').toBeGreaterThan(-1)
    expect(told).toBeLessThan(branch)
  })

  it('says so either way, because a session that never opens looks like one that failed', () => {
    const index = code(source('../../main/index.ts'))
    const hook = /did-finish-load'[\s\S]*?\n {4}\}\)/.exec(index)?.[0] ?? ''
    // Two lines, one per branch. `window.ts` makes the same argument about
    // where a window landed: "nothing happened" has two readings and they need
    // completely different fixes.
    expect(hook.match(/console\.log/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('has a close frame, and the renderer acts on it', () => {
    // Resting tears the session down rather than muting a track. Without the
    // renderer's half the frame goes nowhere and rest silently means nothing.
    const companion = code(source('./main.ts'))
    expect(companion).toContain('__mochi_close__')
    expect(code(source('../../main/index.ts'))).toContain('__mochi_close__')
  })

  it('bumps the open counter when it closes, so a negotiation in flight is disowned', () => {
    /*
      The half that is easy to leave out. A reconnect can be mid-negotiation
      when rest arrives; `session` is null for the whole of that window, so
      closing it does nothing and the negotiation completes seconds later and
      assigns itself — reopening what was just closed, with nothing on screen
      saying why she is listening again. `opening` is what makes the finished
      negotiation recognise that it is stale.
    */
    const companion = code(source('./main.ts'))
    const close = /__mochi_close__'\)\s*\{([\s\S]*?)\n {2}\}/.exec(companion)?.[1]
    expect(close, 'the close frame is handled in a block of its own').toBeDefined()
    expect(close).toContain('opening += 1')
    expect(close).toContain('session?.close()')
  })
})
