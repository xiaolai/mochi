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

/**
 * Holding a child and letting go of it, as one operation.
 *
 * It was two lines at three call sites, all ending
 * `void handle.finished.finally(release)`. `finally` returns a NEW promise that
 * rejects when the original does, and `void` discards it — so a rejecting
 * `finished` produced an unhandled rejection in the main process, from a run
 * that was being handled perfectly well.
 *
 * `spawnCodex` never rejects, so it was latent. Latent in three places, with a
 * type that permits a rejecting handle and tests that supply their own.
 */
describe('holding a child until it finishes', () => {
  function handleThat(finished: Promise<{ code: number | null; stderr: string }>): RunHandle {
    return { finished, kill: () => true }
  }

  /*
    PROBED WITH `stopAll`, not with `count`.

    `count()` reports `inFlight` — slots taken through `begin()` — and holding a
    handle does not take one. The first version of these tests read it anyway
    and failed on their own first assertion against code that was working,
    which is the useful kind of wrong: it named the observable I actually
    needed. `stopAll` answers how many were being held, which is the question.
  */
  async function settle(): Promise<void> {
    // A MACROTASK, not one microtask turn. `finally` schedules its callback and
    // `catch` schedules after it, so a single `await` lands between the two.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('lets go when the child finishes normally', async () => {
    const running = createRunning()
    const done = Promise.resolve({ code: 0, stderr: '' })
    running.holdUntilDone(handleThat(done))
    await done
    await settle()
    expect(running.stopAll(), 'a finished child was still being held').toBe(0)
  })

  it('lets go when the child REJECTS, and does not leave the rejection unhandled', async () => {
    /*
      The case `void ... .finally(...)` got wrong. `finally` passes a rejection
      through to the promise it returns, and `void` discarded that — so the
      process logged an unhandled rejection while the release itself worked,
      which is what made it invisible: correct behaviour, noise sent to a
      console a packaged app does not have.
    */
    const running = createRunning()
    const failed = Promise.reject(new Error('the child blew up'))
    running.holdUntilDone(handleThat(failed))
    await failed.catch(() => undefined)
    await settle()
    expect(running.stopAll(), 'a failed child was still being held').toBe(0)
  })

  it('CONTROL: a child that has not finished IS still held', () => {
    // Without this, both assertions above pass for a `holdUntilDone` that never
    // holds anything at all.
    const running = createRunning()
    running.holdUntilDone(handleThat(new Promise(() => undefined)))
    expect(running.stopAll()).toBe(1)
  })

  it('still stops a child it is holding', () => {
    // The point of holding at all: `stopAll` at quit must reach it.
    const running = createRunning()
    let killed = false
    running.holdUntilDone({
      finished: new Promise(() => undefined),
      kill: () => {
        killed = true
        return true
      },
    })
    expect(running.stopAll()).toBe(1)
    expect(killed).toBe(true)
  })
})
