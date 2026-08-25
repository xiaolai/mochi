import { describe, expect, it } from 'vitest'

import { createMintSlot } from './mint-slot'
import type { Minted } from './credential'

/**
 * The concurrency this slot exists to make impossible.
 *
 * The interesting test is `supersedes`: before this module, that case returned
 * the SECOND session's key to the FIRST renderer, and nothing anywhere said so.
 */

const first = { key: 'key-one', model: 'a' } as unknown as Minted
const second = { key: 'key-two', model: 'b' } as unknown as Minted

/** Predictable tokens, so a test can name the one it means. */
function counted(): () => string {
  let n = 0
  return () => `t${String(++n)}`
}

describe('claiming a minted credential', () => {
  it('gives the holder what it minted', () => {
    const slot = createMintSlot(counted())
    const token = slot.hold(first)
    expect(slot.claim(token)).toEqual({ ok: true, value: first })
  })

  it('refuses when nothing has been minted', () => {
    const slot = createMintSlot(counted())
    expect(slot.claim('t1')).toEqual({ ok: false, why: 'no session has been minted' })
  })

  it('refuses the superseded caller rather than handing it the replacement', () => {
    /*
      THE BUG, stated as a test.

      Two opens in flight. The first renderer's `voice:sdp` arrives after the
      second mint has landed. It used to receive the second session's key --
      silently -- and exchange its own offer against it.
    */
    const slot = createMintSlot(counted())
    const mine = slot.hold(first)
    const theirs = slot.hold(second)
    expect(mine).not.toBe(theirs)
    expect(slot.claim(mine)).toEqual({ ok: false, why: 'this negotiation was superseded' })
    // And the current one still works, so superseding is not breakage.
    expect(slot.claim(theirs)).toEqual({ ok: true, value: second })
  })

  it('refuses a token that is not a string at all', () => {
    // It arrives from the renderer, so it can be anything.
    const slot = createMintSlot(counted())
    slot.hold(first)
    for (const token of [null, undefined, 0, {}, [], true]) {
      expect(slot.claim(token).ok).toBe(false)
    }
  })

  it('refuses everything after release', () => {
    const slot = createMintSlot(counted())
    const token = slot.hold(first)
    slot.release()
    expect(slot.claim(token)).toEqual({ ok: false, why: 'no session has been minted' })
  })

  it('never reuses a token across holds', () => {
    const slot = createMintSlot()
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) seen.add(slot.hold(first))
    expect(seen.size).toBe(50)
  })
})
