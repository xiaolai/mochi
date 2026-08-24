import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_GRANTS, WITHHELD_GRANTS, isGrant, parseGrants } from '@shared/grants'
import type { Grant, Grants } from '@shared/grants'
import { isPersonaId } from '@shared/parse-persona'

import { logBoundedRead, readBounded } from './read-bounded'
import { writeJsonAtomically } from './json-file'

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
  return join(userData, GRANTS_DIR)
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
  const read = readBounded(grantsPath(userData, id))
  // EXISTENCE, not readability — the `hasOwnFace` lesson. `readBounded` says
  // `!ok` for absent and for oversized, symlinked or permission-denied alike,
  // so treating every failure as "nobody has chosen" would let the migration
  // overwrite a file it merely could not open.
  return read.ok || read.reason.kind !== 'absent'
}

/**
 * What she may do.
 *
 * Unreadable withholds everything rather than defaulting, which is the same
 * direction the global reader failed in: a permissions file this process cannot
 * read is not permission.
 */
export function readGrants(userData: string, id: string): Grants {
  const read = readBounded(grantsPath(userData, id))
  if (!read.ok) {
    if (read.reason.kind === 'absent') return DEFAULT_GRANTS
    console.warn(`[grants] ${id} ${logBoundedRead(read.reason)}; withholding everything`)
    return WITHHELD_GRANTS
  }
  try {
    return parseGrants(JSON.parse(read.text))
  } catch (error: unknown) {
    console.warn(`[grants] ${id} is not valid JSON; withholding everything:`, error)
    return WITHHELD_GRANTS
  }
}

/** Set one permission for one character, leaving the rest as they were. */
export function writeGrant(userData: string, id: string, grant: Grant, allowed: boolean): void {
  if (!isGrant(grant)) throw new Error(`not a grant: ${JSON.stringify(grant)}`)
  const path = grantsPath(userData, id)
  mkdirSync(grantsRoot(userData), { recursive: true })
  writeJsonAtomically(path, { ...readGrants(userData, id), [grant]: allowed })
}

/** Her permissions die with her. Called from `finishDeletion`. */
export function forgetGrants(userData: string, id: string): void {
  const path = grantsPath(userData, id)
  if (existsSync(path)) unlinkSync(path)
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
  legacy: Grants | null,
): readonly string[] {
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
