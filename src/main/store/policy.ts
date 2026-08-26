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
import { logBoundedRead, readBounded } from './read-bounded'
import { rawObject } from './json-file'
import { problems } from '../problems'

export const POLICY_DIR = 'policies'

export function policyRoot(userData: string): string {
  return storeRoot(userData, POLICY_DIR)
}

/** Marks that retention has been carried out of old manifests, once, ever. */
const MIGRATED = '.migrated'

/**
 * Whether this installation has already moved retention out of the manifests.
 *
 * The gate that makes "a package cannot declare retention" true against a
 * hostile package rather than only a careless one. Accepting the legacy fields
 * from any manifest claiming to predate the move is not a check -- a package
 * can claim anything, and omitting `version` claims it by default.
 *
 * Carrying those fields across is a ONE-TIME event for an installation that
 * predates the move, not a feature packages get to use. After the first load
 * has done it, nothing seeds a policy from a manifest again.
 */
export function retentionMigrated(userData: string): boolean {
  const read = readBounded(join(policyRoot(userData), MIGRATED))
  return read.ok || read.reason.kind !== 'absent'
}

/** Record that it has happened, so it never happens again. */
export function markRetentionMigrated(userData: string): void {
  try {
    writeJsonAtomically(join(policyRoot(userData), MIGRATED), { at: Date.now() })
  } catch (error: unknown) {
    // Not fatal: the cost of failing is that the one-time pass runs again on
    // the next launch, which is idempotent -- it only seeds where there is no
    // setting already.
    console.warn('[policy] could not record that the retention migration ran:', error)
    // The marker is what stops the migration running again. Without it the pass
    // repeats on every launch, quietly re-deciding somebody's retention.
    problems.note(
      'retention',
      null,
      `the retention migration could not be recorded: ${String(error)}`,
    )
  }
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
export function hasPolicy(userData: string, id: string): boolean {
  const read = readBounded(policyPath(userData, id))
  return read.ok || read.reason.kind !== 'absent'
}

/**
 * What she is set to, the default if nobody has said, or off if it is broken.
 *
 * The path assertion is OUTSIDE the read for the reason `recall` puts it
 * there: caught by the handler below, a refused id would come back as "nobody
 * has chosen", which is an answer this function legitimately gives every day.
 */
export function readPolicy(userData: string, id: string): Policy {
  const path = policyPath(userData, id)
  const read = readBounded(path)
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
    // Falls back to a default retention. How long her conversations are kept is
    // not a thing to change silently.
    problems.note(
      'retention',
      id,
      'the retention setting is not valid JSON; the default is in force',
    )
    return UNREADABLE_POLICY
  }
  const parsed = parsePolicy(value)
  if (parsed === null) {
    console.warn(`[policy] ${id} does not hold a retention policy`)
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
 * `loadPersonas` already parks that policy in `carriedPolicies` and retries it
 * on every read, so the information was never lost. It simply had no consumer:
 * the map was built, filled, returned, and read by nothing. `UNREADABLE_POLICY`
 * makes exactly this argument one step later, for a policy that exists and
 * cannot be parsed.
 *
 * ## Why the store still wins
 *
 * A parked entry is a policy that has not landed yet, not an override. Once the
 * disk accepts the write, `hasPolicy` is true and the file is authoritative --
 * which also makes a stale carry harmless, since it is only consulted where
 * there is nothing better.
 */
export function keepsFor(
  userData: string,
  personaId: string,
  carried: ReadonlyMap<string, Policy>,
): boolean {
  if (hasPolicy(userData, personaId)) return readPolicy(userData, personaId).keeps
  const parked = carried.get(personaId)
  return parked === undefined ? readPolicy(userData, personaId).keeps : parked.keeps
}
