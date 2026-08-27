/**
 * What the permissions panel may honestly claim after saving a change.
 *
 * ## The two persona ids, and why they are allowed to differ
 *
 * The panel writes a grant for whoever is **worn** — `wornId()`, read from
 * disk, because that is the character whose switches are on screen. Dispatch
 * reads grants for **`sessionPersona`** — the character the live session was
 * configured as, because a running session must not be governed by a different
 * character's permissions.
 *
 * Both are correct, and they diverge for one ordinary reason: the shelf can
 * change who is worn while a session is still up. A session started as one
 * character keeps answering as her until the next wake.
 *
 * ## The failure
 *
 * In that window the panel wrote the grant for the newly worn character,
 * dispatch went on consulting the old one, and the handler returned `{ ok:
 * true }` — so the switch moved to "off", the window said the change was in
 * force, and the capability kept running. A permission that silently did not
 * change is the worst failure this window can have; the panel's own comment
 * says so, about a different case, four lines above where this went wrong.
 *
 * ## The decision
 *
 * Not to make the ids agree. Making dispatch follow `wornId()` would hand a
 * live session a stranger's permissions mid-conversation, which is worse than
 * the bug. Making the panel follow `sessionPersona` would write a change the
 * user did not ask for, against a character whose switches are not on screen.
 *
 * They are allowed to differ. What is not allowed is claiming the change took
 * effect when it did not.
 */

import { forPronoun, type Pronoun } from '@shared/pronoun'
import { SAYS } from './says'

/** What `settings:grant` gives back. Mirrors `SettingsWrite`. */
export type GrantOutcome = { readonly ok: true } | { readonly ok: false; readonly why: string }

export function grantOutcome(input: {
  /** The persona the grant was written for — whoever is worn. */
  readonly writtenFor: string
  /** The persona the live session is configured as, or null when none is up. */
  readonly live: string | null
  /** Whether the live session was successfully told. */
  readonly told: boolean
  /**
   * Which words to use for her.
   *
   * TAKEN, rather than reached for. This module decides what may honestly be
   * claimed and the two sentences below are that decision — they belong here,
   * beside the reasoning, and not in the caller. But they named a `she` while
   * this function had no character in hand at all, so a `he/him` character got
   * "she is still speaking as another character". The pronoun is the smallest
   * thing that makes the copy correct without moving it away from the argument
   * it states.
   */
  readonly pronoun: Pronoun
}): GrantOutcome {
  const { writtenFor, live, told, pronoun } = input

  // No session at all. She is asleep or has never woken, and the next wake
  // reads this from disk — so the change is simply in force.
  if (live === null) return { ok: true }

  /*
    THE CASE THIS MODULE EXISTS FOR.

    A session is up as somebody else. The grant is on disk for the worn
    character and correct there; it has no bearing on the character currently
    answering, and `told` is not the question -- the frame reached a session
    governed by different permissions, so a `true` here would be the most
    misleading answer available.

    Checked BEFORE `told`, because being told is irrelevant when the recipient
    is the wrong character.
  */
  if (live !== writtenFor) {
    return { ok: false, why: forPronoun(SAYS.grantOtherCharacter, pronoun) }
  }

  if (!told) {
    return { ok: false, why: forPronoun(SAYS.grantNotTold, pronoun) }
  }

  return { ok: true }
}
