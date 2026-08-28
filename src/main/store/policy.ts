/**
 * The retention setting on disk, filed under her id.
 *
 * Why it is not a field of `Persona` is argued in `@shared/policy`, which owns
 * the type. This file owns the file: one small JSON per persona, beside the
 * memory folder and for the same reasons.
 *
 * ## Absent and unreadable are different answers
 *
 * Absent means nobody has chosen, so the app's default applies. Unreadable
 * means a choice exists and cannot be read, and the safe reading of a privacy
 * setting nobody can see is not to write. Both constants are in the shared
 * module with the argument attached.
 */

import { unlinkSync } from 'node:fs'
import { storeRoot } from './store-root'
import { join } from 'node:path'
import { isPersonaId } from '@shared/parse-persona'
import { DEFAULT_POLICY, UNREADABLE_POLICY, parsePolicy, type Policy } from '@shared/policy'
import { writeJsonAtomically } from './json-file'
import { type BoundedRead, logBoundedRead, readBounded } from './read-bounded'
import { rawObject } from './json-file'
import { problems } from '../problems'

export const POLICY_DIR = 'policies'

export function policyRoot(userData: string): string {
  return storeRoot(userData, POLICY_DIR)
}

/**
 * The file holding one persona's setting.
 *
 * `id` has already passed the persona grammar, which admits no dot and no
 * separator, so this join cannot escape the folder. The assertion is here
 * because this is the function that turns an id into a PATH — the one place a
 * grammar change letting a `/` through would become traversal rather than a
 * lookup failure. Same reasoning as `memory.ts`.
 */
function policyPath(userData: string, id: string): string {
  if (!isPersonaId(id))
    throw new Error(`refusing to build a policy path from ${JSON.stringify(id)}`)
  return join(policyRoot(userData), `${id}.json`)
}

/**
 * Whether she has a stored setting at all, without deciding what it means.
 *
 * ABSENT is the only answer that means "nobody has chosen". A file that is
 * there but oversized, symlinked away, or unreadable for permissions is still
 * a choice somebody made, and `readBounded` reports all of those as `!ok` --
 * so asking it alone let the migration below overwrite a stored opt-out with
 * a value from a manifest, on the grounds that it could not read it.
 */

/**
 * What she is set to, the default if nobody has said, or off if it is broken.
 *
 * The path assertion is OUTSIDE the read for the reason `recall` puts it
 * there: caught by the handler below, a refused id would come back as "nobody
 * has chosen", which is an answer this function legitimately gives every day.
 */
/**
 * Whether she has a policy file, and what it says — from ONE read.
 *
 * The single public reader, and it replaces two. `hasPolicy` and `readPolicy`
 * were separate trips to disk with the second deciding what the first meant,
 * and `keepsFor` called them in sequence: a policy written between them was
 * missed, one removed was read as the default, and either could resolve to
 * `keeps` for a character somebody had just switched recording off for.
 *
 * `readGrantsState` states the rule about the same shape one module along:
 * *"ONE reader for two questions, because the second decides what the first
 * means... Two separate checks would be two chances to get 'was this readable'
 * subtly differently."* This had exactly those two chances.
 *
 * `exists` is false ONLY for a genuinely absent file. One that is there and
 * cannot be read is `exists: true` carrying the unreadable answer, because the
 * carried map `keepsFor` consults is a fallback for "nothing was ever written",
 * not for "this could not be opened" — resolving an unreadable policy from a
 * migration's leftovers would answer a retention question with a value nobody
 * wrote.
 */
export function policyState(
  userData: string,
  id: string,
): { readonly exists: boolean; readonly policy: Policy } {
  const read = readBounded(policyPath(userData, id))
  if (!read.ok && read.reason.kind === 'absent') {
    return { exists: false, policy: DEFAULT_POLICY }
  }
  return { exists: true, policy: policyFrom(read, id) }
}

/**
 * What one read of a policy file means, in one place.
 *
 * Extracted so `keepsFor` can ask "is there one, and what does it say" from a
 * SINGLE read rather than two — see the rule it quotes. Nothing here changed
 * except where the read happens: a caller that has already done it hands the
 * result in, and one that has not goes through `readPolicy` above.
 */
function policyFrom(read: BoundedRead, id: string): Policy {
  if (!read.ok) {
    if (read.reason.kind === 'absent') return DEFAULT_POLICY
    console.warn(`[policy] ${id} ${logBoundedRead(read.reason)}`)
    return UNREADABLE_POLICY
  }
  let value: unknown
  try {
    value = JSON.parse(read.text)
  } catch (error: unknown) {
    console.warn(`[policy] ${id} is not valid JSON:`, error)
    /*
      IT SAYS WHAT ACTUALLY APPLIES, which is not the default.

      This read "the default is in force". `DEFAULT_POLICY` is `{ keeps: true }`
      and `UNREADABLE_POLICY` — what this branch returns — is `{ keeps: false }`.
      Its own comment says so in as many words: "Not the default, and the
      distinction is the point."

      So the one sentence somebody gets about their privacy setting told them
      the opposite of what the app was doing. Recording nothing is the SAFE
      direction and it is still a change they did not ask for; a message that
      names it wrongly is worse than no message, because it stops them looking.
    */
    problems.note(
      'retention',
      id,
      'the retention setting is not valid JSON, so nothing is being recorded until it is fixed',
    )
    return UNREADABLE_POLICY
  }
  const parsed = parsePolicy(value)
  if (parsed === null) {
    /*
      REPORTED, like the branch above it.

      Valid JSON that is not a policy went to `console.warn` alone — and a
      packaged app has no console, which is the entire reason `problems.ts`
      exists. So the two ways this file can be wrong were treated differently
      for no reason: a stray comma was visible and a renamed field was not,
      while both stop her recording anything.
    */
    console.warn(`[policy] ${id} does not hold a retention policy`)
    problems.note(
      'retention',
      id,
      'the retention setting is not one this build understands, so nothing is being recorded until it is fixed',
    )
    return UNREADABLE_POLICY
  }
  return parsed
}

/**
 * Record what somebody chose. Throws if it cannot be written.
 *
 * LOUDLY, and this is the one store in the app that may not fail quietly: it
 * decides whether a conversation is written to disk, so a save that silently
 * did nothing would leave the pane showing a setting the app is not honouring.
 * The rule is that when the effective answer cannot be established, nothing is
 * stored — and the caller can only honour that if it learns the write failed.
 */
export function writePolicy(userData: string, id: string, policy: Policy): void {
  // Merged onto the RAW file for the reason `rawObject` gives: `parsePolicy`
  // keeps only what this build understands, so writing its result back drops a
  // field a newer build wrote — and rolling back would erase somebody's choice
  // about a feature this build has never heard of.
  writeJsonAtomically(policyPath(userData, id), {
    ...rawObject(policyPath(userData, id)),
    ...policy,
  })
}

/**
 * Forget what a persona was set to.
 *
 * Called when she is deleted, and it THROWS rather than warning. Her id is
 * released by the removal of her package, which `deletePersona` now does LAST
 * precisely so a failure here keeps the name reserved — swallowing the error
 * would hand the next persona named Ada a stranger's retention setting, which
 * is the outcome that ordering exists to prevent.
 *
 * Absent is success. There is nothing to remove for somebody who never opened
 * the pane, and treating that as a failure would make deleting her report an
 * error for having accepted the default.
 */
export function forgetPolicy(userData: string, id: string): void {
  try {
    unlinkSync(policyPath(userData, id))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

/**
 * Whether this character's conversations are written down, honouring a carry
 * that could not reach disk.
 *
 * ## The direction that must never be guessed
 *
 * `readPolicy` answers `DEFAULT_POLICY` for a character with no policy file,
 * and that default is to KEEP. So a migration that could not write -- a full
 * disk, a read-only directory, a permissions change -- resolved a `keeps:false`
 * that somebody actually chose into recording. The one direction that must not
 * be guessed, guessed the wrong way.
 *
 * `loadPersonas` used to park that policy in `carriedPolicies` and retry it on
 * every read, so the information was never lost — it simply had no consumer:
 * the map was built, filled, returned, and read by nothing.
 *
 * **Both halves went with the v1 migration layer on 2026-08-26**, and the
 * PLUMBING outlived them by two days: the map stayed on `PersonaCatalog`, was
 * threaded through `index.ts`, and arrived here as a parameter that was always
 * empty. This comment said so — "is now always empty" — and the argument below
 * about why the store wins was reasoning about a case that could no longer
 * happen. Removed on 2026-08-28: the same map, built and returned and read by
 * nothing, one layer up from where it was first found.
 *
 * What replaced the carry is a refusal, because a declaration that cannot be
 * honoured must not be admitted quietly — see `retention-unsupported` in
 * `parse-persona.ts`. `UNREADABLE_POLICY` makes exactly this argument one step
 * later, for a policy that exists and cannot be parsed.
 */
export function keepsFor(userData: string, personaId: string): boolean {
  /*
    ONE read, answering both questions.

    `hasPolicy` then `readPolicy` was two trips to disk with the second deciding
    what the first meant, and the file can change between them: a policy written
    in that window is missed, one removed is read as the default, and the
    direction that matters is that either can resolve to `keeps` for a character
    somebody had just switched recording off for.

    `readGrantsState` states the rule this follows, about the same shape one
    module along: *"ONE reader for two questions, because the second decides what
    the first means... Two separate checks would be two chances to get 'was this
    readable' subtly differently."* This had exactly those two chances.

    `readPolicy` already distinguishes all three outcomes internally — absent is
    the default, unreadable is `UNREADABLE_POLICY`, and anything else is what the
    file says — so the carried map is consulted only when there is genuinely no
    file, which is what `hasPolicy` was being asked.
  */
  return policyState(userData, personaId).policy.keeps
}
