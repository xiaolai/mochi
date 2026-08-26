import { mkdirSync, unlinkSync } from 'node:fs'
import { legacyGrants } from './worn'
import { storeRoot } from './store-root'
import { join } from 'node:path'

import { DEFAULT_GRANTS, WITHHELD_GRANTS, isGrant, parseGrants } from '@shared/grants'
import type { Grant, Grants } from '@shared/grants'
import { isPersonaId } from '@shared/parse-persona'

import { logBoundedRead, readBounded } from './read-bounded'
import { writeJsonAtomically } from './json-file'
import { type LegacyGrants } from './worn'
import { rawObject } from './json-file'
import { problems } from '../problems'

/**
 * What each character may do, filed under her id.
 *
 * ## Why this is per character and not per install
 *
 * The same argument `policy.ts` makes, and for the same two reasons.
 *
 * It has to survive her package being updated: an author shipping v2 of a
 * tutor must not be able to hand himself permissions somebody withheld, and
 * with one global blob "update" and "regrant" are the same write.
 *
 * And it has to die with her. Ids are DERIVED from names and handed back out
 * once free, so a new character inheriting a stranger's permissions is the same
 * class of fault as inheriting their notes — worse, because permission is the
 * thing a person chose deliberately.
 *
 * It was global until 2026-08: `readGrants(userData)` took no id, so granting
 * one character the workspace granted it to every character, including any
 * imported later.
 */

const GRANTS_DIR = 'grants'

function grantsRoot(userData: string): string {
  return storeRoot(userData, GRANTS_DIR)
}

/**
 * The file holding one character's permissions.
 *
 * `id` has already passed the persona grammar, which admits no dot and no
 * separator, so this join cannot escape the folder. The assertion is here for
 * the reason `policyPath` gives: this is the one place a grammar change letting
 * a `/` through would become traversal rather than a lookup failure.
 */
function grantsPath(userData: string, id: string): string {
  if (!isPersonaId(id)) {
    throw new Error(`refusing to build a grants path from ${JSON.stringify(id)}`)
  }
  return join(grantsRoot(userData), `${id}.json`)
}

/** Whether anybody has chosen for her yet. ABSENT is the only answer meaning no. */
export function hasGrants(userData: string, id: string): boolean {
  // EXISTENCE, not readability — the `hasOwnFace` lesson. Treating every
  // failure as "nobody has chosen" would let the migration overwrite a file it
  // merely could not open.
  return grantsState(userData, id).kind !== 'absent'
}

/**
 * What she may do.
 *
 * Unreadable withholds everything rather than defaulting, which is the same
 * direction the global reader failed in: a permissions file this process cannot
 * read is not permission.
 */
/**
 * Absent, usable, or there-but-unusable — three answers, not two.
 *
 * `readGrants` collapses the last two to `WITHHELD_GRANTS`, which is the right
 * answer to "may she?" and the wrong base for a merge: writing one switch on
 * top of it would persist all-withheld and discard every other choice. Both
 * callers need the distinction, so it is made once here.
 */
type GrantsState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'held'; readonly grants: Grants }
  | { readonly kind: 'unusable'; readonly why: string }

function grantsState(userData: string, id: string): GrantsState {
  const read = readBounded(grantsPath(userData, id))
  if (!read.ok) {
    if (read.reason.kind === 'absent') return { kind: 'absent' }
    return { kind: 'unusable', why: logBoundedRead(read.reason) }
  }
  try {
    return { kind: 'held', grants: parseGrants(JSON.parse(read.text)) }
  } catch (error: unknown) {
    return { kind: 'unusable', why: `is not valid JSON: ${String(error)}` }
  }
}

/**
 * The grants in force for a character who has no file of her own yet.
 *
 * Three legacy states, not two, and the difference decides a default:
 *   - a legacy policy      → inherit it, so an unfinished migration cannot grant
 *   - no legacy at all     → `DEFAULT_GRANTS`, which is what a fresh install has
 *   - legacy UNREADABLE    → withhold, because "cannot tell" is not "allowed"
 *
 * The unreadable case is a named sentinel, not `undefined`: coalescing it to
 * `null` at a call site — which every caller did until the third audit found it
 * — turns the safest of the three into the most permissive, and an omitted
 * argument would have done the same by accident.
 */
function fallbackFor(legacy: LegacyGrants): Grants {
  if (legacy === 'unreadable') return WITHHELD_GRANTS
  return legacy ?? DEFAULT_GRANTS
}

export function readGrants(userData: string, id: string, legacy: LegacyGrants = null): Grants {
  const held = grantsState(userData, id)
  if (held.kind === 'unusable') {
    console.warn(`[grants] ${id} ${held.why}; withholding everything`)
    /*
      A POSTURE CHANGE, and it belongs somewhere a person can see it.

      Withholding on an unreadable file is the right default and it is not the
      state somebody configured. Every capability is off, she says she may not
      do things she has been allowed to do, and the only account of why was a
      line on a console no user is reading -- so the app looked broken rather
      than cautious.
    */
    problems.note(
      'grants',
      id,
      `permissions could not be read (${held.why}); everything is withheld`,
    )
    return WITHHELD_GRANTS
  }
  if (held.kind === 'held') return held.grants
  /*
    Absent falls back to the one global setting, when there is one.

    This is what stops a failed or incomplete migration from GRANTING
    everything. Seeding used to be the only thing standing between an upgrade
    and `DEFAULT_GRANTS`, so a migration that threw — or simply had not reached
    a character yet — quietly handed back every permission somebody had
    withheld. With the fallback here, migration is an optimisation that makes
    the answer durable, not the thing the answer depends on.
  */
  return fallbackFor(legacy)
}

/** Set one permission for one character, leaving the rest as they were. */
export function writeGrant(
  userData: string,
  id: string,
  grant: Grant,
  allowed: boolean,
  legacy: LegacyGrants = null,
): void {
  if (!isGrant(grant)) throw new Error(`not a grant: ${JSON.stringify(grant)}`)
  /*
    Refuse to write over a file that could not be read.

    `readGrants` answers `WITHHELD_GRANTS` when a file is there and unreadable,
    which is the right answer for "may she?" and the wrong base for a merge:
    toggling one switch would persist all-withheld and silently discard every
    other choice somebody had made. The global writer this replaced refused for
    exactly this reason, and dropping the refusal alongside the file layout was
    a regression rather than a decision.
  */
  const held = grantsState(userData, id)
  if (held.kind === 'unusable') {
    throw new Error(`refusing to rewrite ${id}'s permissions over a file that ${held.why}`)
  }
  /*
    The base is what a READ would have answered, not `DEFAULT_GRANTS`.

    They diverged: reads inherited the legacy policy for a character with no
    file, writes merged onto the defaults. Toggling one switch therefore
    re-granted every legacy denial silently, which is the exact failure the
    per-character move was made to prevent.
  */
  const base = held.kind === 'absent' ? fallbackFor(legacy) : held.grants
  // Merged onto the RAW file, so a key written by a newer build survives an
  // older one writing a switch. `parseGrants` keeps only what this build knows.
  const onDisk = rawObject(grantsPath(userData, id))
  mkdirSync(grantsRoot(userData), { recursive: true })
  writeJsonAtomically(grantsPath(userData, id), { ...onDisk, ...base, [grant]: allowed })
}

/**
 * Give a brand-new character her own file, holding the defaults.
 *
 * So she never reaches the legacy fallback. Quiet when she already has one —
 * this is called on a path that may be retried, and overwriting would discard a
 * choice rather than seed one.
 */
export function seedGrants(userData: string, id: string): void {
  if (hasGrants(userData, id)) return
  mkdirSync(grantsRoot(userData), { recursive: true })
  writeJsonAtomically(grantsPath(userData, id), DEFAULT_GRANTS)
}

/** Her permissions die with her. Called from `finishDeletion`. */
export function forgetGrants(userData: string, id: string): void {
  /*
    Unlink and ignore only ENOENT.

    `existsSync` answers false for a permission error and for a dangling
    symlink as readily as for absence, so guarding on it would let deletion
    report success, release the slug, and leave the file for whoever gets the
    name next. This is the third instance of that shape in this repository --
    `hasOwnFace` and `hasPolicy` were the first two -- and the rule they settled
    is that when the question is "is there a file", absent is the only answer
    that means no.
  */
  try {
    unlinkSync(grantsPath(userData, id))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/**
 * Carry the one global setting forward to everybody who existed under it.
 *
 * Without this, upgrading silently revokes every permission on the machine —
 * every character falls back to `DEFAULT_GRANTS` and whatever somebody chose is
 * gone. A grant silently dropped is a capability silently revoked, and it
 * presents as her declining to help with no explanation.
 *
 * Idempotent by construction: a character who already has a file is left alone,
 * so this is safe on every launch and the legacy value stops mattering once
 * everybody has been seeded.
 */
export function migrateGrants(
  userData: string,
  ids: Iterable<string>,
  legacy: LegacyGrants,
): readonly string[] {
  // `undefined` means the legacy file is THERE and unreadable. Seeding from it
  // is impossible and skipping it silently grants everything, so it throws and
  // the caller reports it rather than starting permissive.
  if (legacy === 'unreadable') {
    throw new Error('refusing to migrate permissions from a file that cannot be read')
  }
  if (legacy === null) return []
  const seeded: string[] = []
  for (const id of ids) {
    if (!isPersonaId(id) || hasGrants(userData, id)) continue
    mkdirSync(grantsRoot(userData), { recursive: true })
    writeJsonAtomically(grantsPath(userData, id), legacy)
    seeded.push(id)
  }
  return seeded
}

/**
 * Carry the one global setting forward, once, at startup.
 *
 * Lives here rather than in the composition root because it is entirely about
 * this module's format: what the old shape was, who still needs seeding, and
 * what it means when the legacy file cannot be read. `index.ts` should say
 * WHEN it happens, not how.
 *
 * A failure is reported rather than thrown. Seeding is an optimisation now —
 * `readGrants` falls back to the legacy policy for anybody unseeded — so a
 * failed pass leaves permissions correct and merely un-durable, which is worth
 * a line somebody can see and not worth refusing to start over.
 */
export function carryGrantsForward(
  userData: string,
  catalogue: (userData: string) => { readonly personas: ReadonlyMap<string, unknown> },
  note: (area: string, subject: string | null, said: string) => void,
): void {
  try {
    const seeded = migrateGrants(
      userData,
      catalogue(userData).personas.keys(),
      legacyGrants(userData),
    )
    if (seeded.length > 0) {
      console.log(`[grants] carried the global setting to ${seeded.join(', ')}`)
    }
  } catch (error: unknown) {
    console.error('[grants] could not carry the global setting forward:', error)
    note(
      'settings',
      null,
      'her permissions could not be carried forward from the previous version — check them ' +
        'on the shelf before trusting what she may do',
    )
  }
}
