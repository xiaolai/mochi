import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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
    // The close is what flushes deleted text out of the log. Skipping it
    // because the end failed leaves that text on disk, which is the failure
    // ordering that matters most and the one nobody would see.
    const fn = MAIN.slice(MAIN.indexOf('function shutDownCleanly'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    expect(body).toContain('finally')
    expect(body.indexOf('archive?.close()')).toBeGreaterThan(body.indexOf('finally'))
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
