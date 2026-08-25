import { randomUUID } from 'node:crypto'

import type { Minted } from './credential'

/**
 * Which minted credential a given `voice:sdp` is allowed to use.
 *
 * ## The failure this replaces
 *
 * `minted` was one module-level slot with no identity: `voice:open` wrote it
 * and `voice:sdp` read whatever was there. The comment above it said *"held so
 * a second open replaces the first rather than racing it"*, which describes the
 * WRITE correctly and says nothing about the read — and the read is where the
 * two sessions meet.
 *
 * Two opens in flight (a reconnect landing on a manual wake, a persona switch
 * during an hourly reconnect) leave the second mint in the slot. The first
 * renderer then exchanges ITS offer against the SECOND session's key. That
 * either fails with a message about an offer, which is the wrong thing to look
 * at, or succeeds — and one renderer is now driving a session main believes
 * belongs to the other.
 *
 * ## The fix
 *
 * Every mint carries a token, and `claim` refuses one that is not the current
 * one. Superseding is still allowed, because a second open genuinely should
 * replace the first; what is no longer allowed is a superseded caller using
 * the replacement without knowing.
 *
 * The token is opaque to the renderer and is never the key. It identifies
 * *which negotiation* is speaking, and it is worth nothing on its own.
 */

/** Why a claim was refused, in words a log can carry. */
export type ClaimRefusal = 'no session has been minted' | 'this negotiation was superseded'

export interface MintSlot {
  /**
   * Hold a freshly minted credential, replacing whatever was there.
   *
   * Returns the token the eventual `voice:sdp` must present.
   */
  hold(value: Minted): string
  /** The held credential, or why this caller may not have it. */
  claim(token: unknown): { ok: true; value: Minted } | { ok: false; why: ClaimRefusal }
  /**
   * Forget the held credential.
   *
   * Called when the session it belongs to is gone. A mint outlives its
   * usefulness in about a minute and holding it longer is a live credential
   * kept for no reason.
   */
  release(): void
}

export function createMintSlot(newToken: () => string = randomUUID): MintSlot {
  let held: { readonly token: string; readonly value: Minted } | null = null

  return {
    hold(value) {
      const token = newToken()
      held = { token, value }
      return token
    },
    claim(token) {
      if (held === null) return { ok: false, why: 'no session has been minted' }
      // Compared as an unknown rather than typed as a string: this value comes
      // from the renderer, and a `===` against a non-string simply fails, which
      // is the wanted answer for a malformed one too.
      if (token !== held.token) return { ok: false, why: 'this negotiation was superseded' }
      return { ok: true, value: held.value }
    },
    release() {
      held = null
    },
  }
}
