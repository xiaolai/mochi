import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * What the renderer RELEASES when the hour is up.
 *
 * ## The failure
 *
 * `session-expired` arrives once an hour (§53). The handler noted that main
 * already holds a reconnect timer and returned — which is true and is not the
 * question. Main opening a *new* session does not close the old one's peer
 * connection, data channel, or capture: those live in the renderer, and
 * `shutdown()` is the only thing that stops them.
 *
 * So each hour left behind a peer, a channel, a subscription and a live
 * microphone track, and started another. This file's own `shutdown` says it
 * about the subscription in as many words — *"a subscription that outlived its
 * session held that session's peer and data channel for the life of the
 * window — once an hour, for ever"* — and the expiry path was the one route
 * that reached that state without calling it.
 *
 * The microphone is the part a person sees: the OS indicator stays lit for a
 * session nobody is in.
 *
 * ## Why source text
 *
 * `session.ts` builds an `RTCPeerConnection` at load and cannot be imported
 * outside a browser. Same technique and same reason as `lifecycle.test.ts`.
 * Pointed at the SURFACE — every teardown-worthy branch — rather than at one
 * line, so a later refactor cannot make it pass by moving the code.
 */

const SOURCE = readFileSync(fileURLToPath(new URL('./session.ts', import.meta.url)), 'utf8')

/** The body of one `case '...':` in the frame switch, up to its `break`. */
function branch(name: string): string {
  const at = SOURCE.indexOf(`case '${name}':`)
  expect(at, `no '${name}' branch in session.ts`).toBeGreaterThan(-1)
  const rest = SOURCE.slice(at)
  const end = rest.indexOf('\n      case ')
  return end === -1 ? rest : rest.slice(0, end)
}

describe('when the session expires', () => {
  it('tears the session down', () => {
    // The whole fix. Without this the branch reported a state and released
    // nothing.
    expect(branch('session-expired')).toMatch(/\bshutdown\(\)/)
  })

  it('reports the expiry after tearing down, not before', () => {
    /*
      The ordering every other teardown path in this file uses, and it is
      load-bearing: `shutdown()` announces `closed` on its way out, so whatever
      the caller reports must come AFTER it or be immediately overwritten by
      `closed`. `fail()` and the `connectionstatechange` handler both say so.
    */
    const body = branch('session-expired')
    const tearsDown = body.indexOf('shutdown()')
    const reports = body.indexOf('onState({ expired: true })')
    expect(tearsDown).toBeGreaterThan(-1)
    expect(reports).toBeGreaterThan(-1)
    expect(tearsDown).toBeLessThan(reports)
  })

  it('leaves every branch that ends a session calling shutdown', () => {
    /*
      The class, not the instance.

      `session-expired` was one of several branches that end a session, and it
      was the one missing the call. Asserting only that branch would let the
      next one be added without it — which is exactly how this one arrived.
    */
    for (const name of ['session-expired', 'error']) {
      const body = branch(name)
      const ends =
        body.includes('onState({ expired') ||
        body.includes('onState({ failed') ||
        body.includes("onState('closed')")
      if (ends) {
        expect(body, `'${name}' ends the session without releasing it`).toMatch(/\bshutdown\(\)/)
      }
    }
  })
})
