/**
 * Whether a delegation is allowed to run right now.
 *
 * ## The keypress is a default, not a law
 *
 * `hotkey` requires a press. `anytime` does not, and that is the user's choice
 * to make about their own Codex, their own credentials and their own machine --
 * the same position taken about borrowing the token: state the cost, then let
 * them decide, rather than deciding for them. The pane says plainly what
 * `anytime` means.
 *
 * ## A press authorises ONE run, and it expires
 *
 * Single use, because the point of putting authorisation on the keyboard is that
 * it is per-invocation: a press that stayed valid would drift back into "the
 * app is allowed to read whenever it likes", which is the setting next to it
 * rather than something to arrive at by accident.
 *
 * Bounded in time for the same reason. Somebody who presses the key, gets
 * distracted, and comes back twenty minutes later to a completely different
 * conversation has not authorised THAT sentence. Sixty seconds is generous for
 * "press, then say what you want" and short enough that the window closes with
 * the moment.
 *
 * `now` is injected everywhere rather than read from the clock, so the expiry is
 * testable without waiting for it. The DEFAULT is monotonic rather than
 * `Date.now()`: a wall clock can move backwards -- an NTP correction, a manual
 * change -- and `now - pressedAt` then stays negative, quietly keeping a press
 * valid far past its minute.
 */

import { performance } from 'node:perf_hooks'
import { AUTHORISATION_WINDOW_MS } from '@shared/delegation'
import type { DelegationTrigger } from '@shared/delegation'

/** Milliseconds since process start. Never goes backwards. */
const monotonic = (): number => performance.now()

// RE-EXPORTED, not redefined. The value lives in `shared/delegation.ts` because
// the settings pane states it out loud and cannot import this module; the
// re-export keeps every existing importer here working and keeps the number in
// exactly one place. See that file for why.
export { AUTHORISATION_WINDOW_MS }

let pressedAt: number | null = null

/** Record a press. Called by the shortcut handler and nothing else. */
export function authoriseDelegation(now: number = monotonic()): void {
  pressedAt = now
}

/** Whether a press is currently good, without spending it. For the UI. */
export function isAuthorised(now: number = monotonic()): boolean {
  return pressedAt !== null && now - pressedAt <= AUTHORISATION_WINDOW_MS
}

/**
 * WHY a run was allowed, not merely that it was.
 *
 * The distinction is load-bearing for renewal: a run admitted because the user
 * pressed a key may buy a follow-up window, and a run admitted because the
 * setting says "whenever" may not. Collapsing both into `true` is what let
 * `renewAuthorisation` mint a press nobody made -- see below.
 */
export type AuthorisationBasis = 'press' | 'anytime'

/**
 * Spend the authorisation, or report that there is none.
 *
 * Consuming rather than merely checking is what makes a press cover one run.
 * `anytime` consumes nothing, since there is nothing to spend -- but a press
 * made under `anytime` is still cleared, so switching the setting back to
 * `hotkey` does not silently inherit an old press.
 *
 * Returns the BASIS rather than a boolean, so the caller can tell the two
 * admissions apart. `null` is the refusal.
 */
export function takeAuthorisation(
  trigger: DelegationTrigger,
  now: number = monotonic(),
): AuthorisationBasis | null {
  const had = isAuthorised(now)
  pressedAt = null
  if (trigger === 'anytime') return 'anytime'
  return had ? 'press' : null
}

/**
 * Re-open the window after a run ANSWERED, so a follow-up needs no second press.
 *
 * ## This amends the original rule, and the amendment is the point
 *
 * The rule was "one press = one human-initiated read". Measured against a real
 * conversation, that sentence describes a shape conversations do not have: the
 * user asked about an article, got an answer, said "give me a detailed outline
 * and explain its significance" -- and that landed on a spent press. The refusal
 * came back in a millisecond and she rendered it as "I'm not authorized to dig
 * into more specifics from that source", which sent the user looking at the
 * source rather than at the keyboard.
 *
 * A follow-up is the SAME errand. Requiring a fresh press for it does not buy a
 * decision the user is making -- they already made it, and are now being asked
 * to re-make it in the middle of hearing the answer.
 *
 * ## What it costs, stated rather than implied
 *
 * One press can now cover a CHAIN of runs: each answer buys another window, so
 * as long as follow-ups keep arriving inside a minute the chain continues. What
 * bounds it is silence -- a minute with no follow-up ends it -- not a count.
 *
 * The chain is not entirely user-driven either. Inside a renewed window she may
 * call the tool on her own initiative, without the user asking. That is real,
 * and it is why this is a separate function from `authoriseDelegation` rather
 * than a second call to it: this one is a consequence, not a press, and the
 * caller has to say which it means.
 *
 * ## Only after an answer
 *
 * Never after a refusal, and structurally never after `not-authorised` -- that
 * outcome returns before a run exists, so it cannot reach the caller of this.
 * Renewing on refusal would make an unauthorised call authorise its own retry,
 * which is the gate failing open.
 *
 * ## Only for a run a PRESS admitted
 *
 * `basis` is required, and it is the fix for a hole the first version shipped
 * with. That version renewed unconditionally, so a run admitted under `anytime`
 * -- where no key was ever pressed -- still stamped `pressedAt`. Switch the
 * trigger back to `hotkey` inside the next minute and that stamp is a free
 * read the user never authorised.
 *
 * The test one file over, `does not bank a press for a later hotkey run`,
 * exists to forbid exactly that for presses. Renewal walked around it.
 */
export function renewAuthorisation(basis: AuthorisationBasis, now: number = monotonic()): void {
  if (basis !== 'press') return
  pressedAt = now
}

/** Drop any outstanding press. Used when a run is cancelled or refused. */
export function clearAuthorisation(): void {
  pressedAt = null
}
