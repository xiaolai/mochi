import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { shutDown } from './shutdown'
import type { ShutdownDeps } from './shutdown'

/** Every step a no-op, so a test names only the one it is about. */
const noopShutdown: ShutdownDeps = {
  stopLookups: () => 0,
  removeScratch: () => 0,
  unanswered: () => [],
  undelivered: () => [],
  endConversation: () => undefined,
  closeArchive: () => undefined,
  note: () => undefined,
  log: () => undefined,
  warn: () => undefined,
}

/**
 * The archive is put down cleanly, however the app ends.
 *
 * ## What was wrong
 *
 * `close()` is the only thing that retries a write-ahead-log truncation a
 * reader held off, and nothing ever called it. So a delete that raced a reader
 * left the deleted words in `transcripts.db-wal` for the whole run -- deleted
 * this morning, still recoverable at midnight, while the app reported it gone.
 *
 * ## Why the ordering assertions are read from source
 *
 * Every property here is about WHERE a call sits in the process lifecycle:
 * which event, before which exit, inside which `finally`. None of it is
 * visible to a unit test of the function itself. Comments are stripped first,
 * or the prose above would satisfy the assertions.
 */
const MAIN = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

const STORE = readFileSync(join(process.cwd(), 'src', 'main', 'store', 'transcripts.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

describe('shutting down', () => {
  it('closes the archive on `will-quit`, not `before-quit`', () => {
    /*
      `before-quit` fires before windows unload and a window can cancel the
      quit, leaving a running app holding a closed database: every later read
      and every later turn failing, recoverable only by restarting.
    */
    expect(MAIN).toContain("app.on('will-quit'")
    const willQuit = MAIN.slice(MAIN.indexOf("app.on('will-quit'"))
    expect(willQuit.slice(0, willQuit.indexOf('})'))).toContain('shutDownCleanly')
    expect(MAIN).not.toContain("app.on('before-quit'")
  })

  it('closes it on the exit paths too, which emit no quit event', () => {
    // `app.exit()` emits neither `before-quit` nor `will-quit`, and both
    // startup failure paths take it.
    const exits = [...MAIN.matchAll(/app\.exit\(1\)/g)]
    expect(exits.length).toBeGreaterThan(0)
    for (const exit of exits) {
      const before = MAIN.slice(Math.max(0, exit.index - 200), exit.index)
      expect(before, 'an exit path that leaves the archive open').toContain('shutDownCleanly')
    }
  })

  it('closes it even when ending the conversation throws', () => {
    /*
      A REAL CALL, not a slice of source text.

      This read `index.ts` for a `finally`. The sequence moved to
      `shutdown.ts`, which — unlike `index.ts` — can be imported, so the
      assertion is now what it always wanted to be: make the conversation throw
      and watch the archive close anyway.

      The close is what flushes deleted text out of the write-ahead log.
      Skipping it because the end failed leaves that text on disk, which is the
      ordering that matters most here and the one nobody would ever see.
    */
    let closed = false
    shutDown({
      ...noopShutdown,
      endConversation: () => {
        throw new Error('the conversation could not be ended')
      },
      closeArchive: () => {
        closed = true
      },
    })
    expect(closed).toBe(true)
  })

  it('closes it even when stopping the lookups throws', () => {
    // Every step is independently guarded, because this runs from `will-quit`
    // and from both `app.exit()` paths — where a throw strands whatever has
    // not run yet.
    let closed = false
    shutDown({
      ...noopShutdown,
      stopLookups: () => {
        throw new Error('no')
      },
      closeArchive: () => {
        closed = true
      },
    })
    expect(closed).toBe(true)
  })

  it('closes it even when the REPORTER throws', () => {
    /*
      The one step nobody guards, guarding everything after it.

      Each block used to be `try { step() } catch { deps.warn(...) }`. A `warn`
      that throws inside one of those catches is caught by nothing: it leaves
      `shutDown` entirely, so a failure in the reporter strands every step
      below — including this close, which is what flushes deleted text out of
      the write-ahead log.

      Reporting is not usually thought of as a step that can fail. It is a
      `console.warn` in production and a callback everywhere else, and either
      can be replaced by something that throws.
    */
    let closed = false
    shutDown({
      ...noopShutdown,
      stopLookups: () => {
        throw new Error('no')
      },
      warn: () => {
        throw new Error('and the reporter is broken too')
      },
      closeArchive: () => {
        closed = true
      },
    })
    expect(closed).toBe(true)
  })

  it('asks what was undelivered even when the unanswered read throws', () => {
    /*
      Two INDEPENDENT obligations that shared one `try`, so the first throwing
      silently answered the second. "She was interrupted" and "a frame was
      silently dropped" are the two facts this sequence exists to tell apart,
      and one could take the other with it.
    */
    let asked = false
    const noted: string[] = []
    shutDown({
      ...noopShutdown,
      unanswered: () => {
        throw new Error('the ledger is unreadable')
      },
      undelivered: () => {
        asked = true
        return ['call_2']
      },
      note: (_what, detail) => noted.push(detail),
    })
    expect(asked).toBe(true)
    expect(noted.join(' ')).toContain('come back to 1')
  })

  it('reports what was still owed before it goes', () => {
    // `unanswered()` and `undelivered()` had no production caller at all until
    // this sequence asked. Shutdown is the last moment the difference between
    // "she was interrupted" and "a frame was silently dropped" can be recorded.
    const noted: string[] = []
    shutDown({
      ...noopShutdown,
      unanswered: () => ['call_1'],
      undelivered: () => ['call_2', 'call_3'],
      note: (_what, detail) => noted.push(detail),
    })
    expect(noted.join(' ')).toContain('never answered')
    expect(noted.join(' ')).toContain('come back to 2')
  })

  it('stops the children before anything that can throw', () => {
    // A subprocess outliving the app is worse than an archive closed a few
    // milliseconds later, and everything below it can fail.
    const order: string[] = []
    shutDown({
      ...noopShutdown,
      stopLookups: () => {
        order.push('lookups')
        return 1
      },
      closeArchive: () => order.push('archive'),
    })
    expect(order).toEqual(['lookups', 'archive'])
  })

  it('runs once, however many ways the app is ending', () => {
    const fn = MAIN.slice(MAIN.indexOf('function shutDownCleanly'))
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toContain('if (shutDown) return')
  })
})

describe('a scrub a reader held off', () => {
  it('is retried before quit, not only at it', () => {
    /*
      Waiting for `close()` means a delete performed today stays in the log
      until the app quits -- which may be weeks. Deletion is the one place in
      this app where "eventually" is not a synonym for "yes".
    */
    expect(STORE).toContain('function retryScrubSoon')
    const scrub = STORE.slice(STORE.indexOf('function scrub(): void {'))
    expect(scrub.slice(0, scrub.indexOf('\n  }'))).toContain('retryScrubSoon()')
  })

  it('is bounded, and does not hold the process open', () => {
    const retry = STORE.slice(STORE.indexOf('function retryScrubSoon'))
    const body = retry.slice(0, retry.indexOf('\n  }'))
    expect(body).toContain('scrubsLeft <= 0')
    expect(retry.slice(0, retry.indexOf('function scrub('))).toContain('.unref()')
  })

  it('still gets one last attempt with the connection in hand', () => {
    const close = STORE.slice(STORE.indexOf('    close() {'))
    const body = close.slice(0, close.indexOf('\n    },'))
    expect(body).toContain('if (pendingScrub) scrub()')
    // And the pending retry is cancelled, or it fires against a dead handle.
    expect(body).toContain('clearTimeout(scrubRetry)')
  })
})

describe('once the archive is down it stays down', () => {
  it('has exactly one door to opening it', () => {
    /*
      Found in the plan audit: `transcripts()` refused to reopen during a quit,
      and `conversation()` had its own `archive ??= createTranscripts(...)` that
      did not. Two places opening the archive is two places that have to
      remember the rule, and the second one had not.

      The count is the fix. A third door would pass a behaviour test of the
      first two and reintroduce the defect.
    */
    const doors = [...MAIN.matchAll(/archive \?\?= createTranscripts/g)]
    expect(doors, 'a second place opens the archive').toHaveLength(1)
    const opener = MAIN.slice(MAIN.indexOf('function transcripts(): Transcripts {'))
    expect(opener.slice(0, opener.indexOf('\n}'))).toContain('archive ??= createTranscripts')
  })

  it('refuses to reopen it while the app is quitting', () => {
    // `??=` would quietly build a new handle: opening the database, registering
    // its path and starting a fresh write-ahead log during a quit already under
    // way -- and the coordinator only runs once, so it would never be closed.
    const opener = MAIN.slice(MAIN.indexOf('function transcripts(): Transcripts {'))
    const body = opener.slice(0, opener.indexOf('\n}'))
    expect(body).toContain('if (shutDown) throw')
    expect(body.indexOf('if (shutDown) throw')).toBeLessThan(body.indexOf('archive ??='))
  })

  it('does not build a conversation just to end one that never existed', () => {
    const fn = MAIN.slice(MAIN.indexOf('function shutDownCleanly'))
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toContain('if (talk !== null) talk.end()')
  })

  it('does not let the flush timer outlive the app', () => {
    const fn = MAIN.slice(MAIN.indexOf('function endWhenFlushed'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('awaitingFlush.unref()')
    expect(body).toContain('if (shutDown) return')
  })
})

describe('a summary scratch directory does not outlive the app', () => {
  /*
    The job's own `finally` is a continuation on a promise nobody awaits, and
    quit does not wait for one: `stopLookups` kills the child synchronously and
    the process can exit before that continuation runs — leaving a
    `mochi-summary-*` directory holding somebody's transcript in the system
    temp folder for the OS to reclaim whenever it gets round to it.
  */
  it('is swept, and after the child holding it is dead', () => {
    const order: string[] = []
    shutDown({
      ...noopShutdown,
      stopLookups: () => {
        order.push('killed')
        return 1
      },
      removeScratch: () => {
        order.push('swept')
        return 1
      },
    })
    expect(order).toEqual(['killed', 'swept'])
  })

  it('does not stop the rest of the shutdown when it fails', () => {
    // The archive closing is the step that must happen whatever else did not.
    let closed = false
    expect(() =>
      shutDown({
        ...noopShutdown,
        removeScratch: () => {
          throw new Error('EBUSY')
        },
        closeArchive: () => {
          closed = true
        },
      }),
    ).not.toThrow()
    expect(closed, 'a scratch failure stranded the archive').toBe(true)
  })
})
