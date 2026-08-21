import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Sleep ends the conversation, and waits to be told it may.
 *
 * ## What was wrong
 *
 * `setAsleep` wrote rest, told her window and closed the peer, and left the
 * archive session open. It ended at the next wake, or at quit. A conversation
 * slept at 10:00 and quit at 18:00 was stored as eight hours long, and the
 * archive listed it that way -- under every deletion control this plan adds.
 *
 * ## Why it is not simply `end()` in the sleep branch
 *
 * The renderer's shutdown flushes a turn she was cut off in, over the
 * asynchronous `voice:report` channel. Ending immediately ends the conversation
 * BEFORE that turn lands, and the late turn opens a fresh one behind her closed
 * eyes -- a live session she is not awake for. So main waits for `flushed`,
 * which rides the same channel and is therefore delivered after the turns it
 * acknowledges.
 *
 * Read from source because this is main-process wiring: the ordering IS the
 * fix, and a unit test of either half in isolation cannot see it. Comments are
 * stripped first, or the prose above would satisfy every assertion below.
 */
const MAIN = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

const SESSION = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'companion', 'audio', 'session.ts'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

/** The `if (asleep) { ... } else` arm of `setAsleep`. */
function sleepBranch(): string {
  const from = MAIN.indexOf('function setAsleep(asleep: boolean): void {')
  expect(from).toBeGreaterThan(-1)
  const branch = MAIN.slice(MAIN.indexOf('if (asleep) {', from), MAIN.indexOf('} else {', from))
  expect(branch.length).toBeGreaterThan(0)
  return branch
}

describe('going to sleep ends the conversation', () => {
  it('asks for it on the way down', () => {
    expect(sleepBranch()).toContain('endWhenFlushed()')
  })

  it('does NOT end it there and then', () => {
    // The bug this whole mechanism exists for. Ending here beats the renderer's
    // flush and lets a late turn begin a conversation she is asleep for.
    expect(sleepBranch()).not.toContain('conversation().end()')
  })

  it('ends it when the renderer says it has finished sending', () => {
    const handler = MAIN.slice(MAIN.indexOf("ipcMain.on('voice:report'"))
    expect(handler).toContain("kind === 'flushed'")
    expect(handler.slice(0, handler.indexOf("kind === 'expiry'"))).toContain(
      'conversationFlushed()',
    )
  })

  it('ends it anyway if the renderer never answers', () => {
    // Otherwise the conversation stays open exactly as before, with a mechanism
    // in place that looks like it fixed the problem.
    const grace = MAIN.slice(MAIN.indexOf('function endWhenFlushed'))
    expect(grace).toContain('FLUSH_GRACE_MS')
    expect(grace.slice(0, grace.indexOf('function conversationFlushed'))).toContain(
      'conversation().end()',
    )
  })

  it('abandons a pending close when she is woken inside the grace period', () => {
    const wake = MAIN.slice(MAIN.indexOf('} else {', MAIN.indexOf('function setAsleep')))
    expect(wake.slice(0, wake.indexOf('armIdleSleep'))).toContain('clearTimeout(awaitingFlush)')
  })

  it('only acts on an acknowledgement it is actually waiting for', () => {
    // `shutdown` runs on every teardown path and can run twice. A second
    // acknowledgement arriving after she has woken must not end the
    // conversation she is having now.
    const fn = MAIN.slice(MAIN.indexOf('function conversationFlushed'))
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('if (awaitingFlush === null) return')
  })
})

describe('the renderer acknowledges after it has sent everything', () => {
  it('sends `flushed` below the flush, not above it', () => {
    const shutdown = SESSION.slice(
      SESSION.indexOf('function shutdown(): void {'),
      SESSION.indexOf('function fail('),
    )
    const flushAt = shutdown.indexOf('pending.flush()')
    const ackAt = shutdown.indexOf("kind: 'flushed'")
    expect(flushAt).toBeGreaterThan(-1)
    expect(ackAt).toBeGreaterThan(flushAt)
  })

  it('sends it on the SAME channel as the turns', () => {
    // Ordering is the entire mechanism. A dedicated channel would race the very
    // turns it acknowledges, and only under an interrupted utterance.
    const shutdown = SESSION.slice(SESSION.indexOf('function shutdown(): void {'))
    expect(shutdown.slice(0, shutdown.indexOf('function fail('))).toContain(
      "window.mochi.report({ kind: 'flushed' })",
    )
  })
})
