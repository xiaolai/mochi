import { describe, expect, it } from 'vitest'

import { MOST_AT_ONCE, createRunning } from './running'
import type { RunHandle } from './spawn'

/**
 * Nothing knew which children were alive, and that one absence produced both
 * an unbounded spawn rate and a set of processes that outlived the app.
 */

function fakeChild(): { handle: RunHandle; signals: (NodeJS.Signals | undefined)[] } {
  const signals: (NodeJS.Signals | undefined)[] = []
  return {
    signals,
    handle: {
      finished: new Promise(() => undefined),
      kill: (signal?: NodeJS.Signals) => {
        signals.push(signal)
        return true
      },
    },
  }
}

describe('how many lookups may run at once', () => {
  it('lets the bound through', () => {
    const running = createRunning(2)
    expect(running.begin().ok).toBe(true)
    expect(running.begin().ok).toBe(true)
    expect(running.count()).toBe(2)
  })

  it('refuses the one past it', () => {
    // Each lookup is a full workspace scan that may run three minutes. The
    // model can call a tool in a loop, and nothing said no.
    const running = createRunning(2)
    running.begin()
    running.begin()
    expect(running.begin().ok).toBe(false)
  })

  it('frees the slot when a lookup finishes', () => {
    const running = createRunning(1)
    const first = running.begin()
    expect(running.begin().ok).toBe(false)
    if (first.ok) first.done()
    expect(running.begin().ok).toBe(true)
  })

  it('does not free another slot when `done` runs twice', () => {
    /*
      The leak in the other direction, and the reason `done` is idempotent.

      It is called from a `finally`, so a handler that throws after releasing
      would otherwise decrement twice — and a count that drifts below zero
      never refuses anything again.
    */
    const running = createRunning(1)
    const first = running.begin()
    if (first.ok) {
      first.done()
      first.done()
    }
    expect(running.count()).toBe(0)
    expect(running.begin().ok).toBe(true)
    expect(running.begin().ok).toBe(false)
  })

  it('defaults to a bound that allows a follow-up question', () => {
    // One would refuse an ordinary "and what about X?" while a long lookup is
    // still running, which reads as broken rather than busy.
    expect(MOST_AT_ONCE).toBeGreaterThan(1)
  })
})

describe('what happens to live children when the app quits', () => {
  it('kills every one of them', () => {
    // `will-quit` closed the archive and left these running. The app leaves the
    // Dock and a Codex process goes on reading somebody's workspace with
    // nothing on screen to say it is there.
    const running = createRunning()
    const a = fakeChild()
    const b = fakeChild()
    running.hold(a.handle)
    running.hold(b.handle)
    expect(running.stopAll()).toBe(2)
    expect(a.signals).toEqual(['SIGKILL'])
    expect(b.signals).toEqual(['SIGKILL'])
  })

  it('does not kill one that already finished', () => {
    const running = createRunning()
    const child = fakeChild()
    const release = running.hold(child.handle)
    release()
    expect(running.stopAll()).toBe(0)
    expect(child.signals).toEqual([])
  })

  it('does not throw when a child is already gone', () => {
    // Quitting is not a moment to throw: this runs inside `will-quit`, and an
    // exception there strands the rest of the shutdown.
    const running = createRunning()
    running.hold({
      finished: new Promise(() => undefined),
      kill: () => {
        throw new Error('ESRCH')
      },
    })
    expect(() => running.stopAll()).not.toThrow()
  })

  it('sends SIGKILL rather than SIGTERM', () => {
    // There is no grace period to offer. Electron waits on `will-quit` only for
    // a synchronous handler, so a request the child may ignore is not one to
    // make here.
    const running = createRunning()
    const child = fakeChild()
    running.hold(child.handle)
    running.stopAll()
    expect(child.signals).toEqual(['SIGKILL'])
  })
})
