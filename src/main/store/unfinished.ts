/**
 * What was half-done when we were last killed, and how it is finished.
 *
 * One question with its own on-disk invariants: a tombstone marks a package
 * whose deletion did not complete, and a pending-policy file holds a retention
 * value that could not be written where it belonged. Both exist because the
 * process can stop between two writes, and both are settled on the next
 * launch rather than left for somebody to notice.
 *
 * Split from `personas.ts` so the crash-recovery rules can be read as a set.
 * Scattered through the catalogue they read as incidental file handling, and
 * the ordering constraints between them are invisible.
 */
import { writeJsonAtomically } from './json-file'
import { personasRoot } from './persona-files'
import { hasPolicy, writePolicy } from './policy'
import { readBounded } from './read-bounded'
import { isPersonaId } from '@shared/parse-persona'
import { type Policy, UNREADABLE_POLICY, parsePolicy } from '@shared/policy'
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { problems } from '../problems'
/**
 * Her retention, parked in her own package until the policy store accepts it.
 *
 * The durable half of the carry. `carriedPolicies` holds a failed migration in
 * memory and is retried on every read, which heals the moment the disk allows
 * -- but only within one run. If it never allows before the app quits, the
 * choice is gone, and the fallback for a missing policy file is to KEEP. A user
 * who turned transcripts off starts recording.
 *
 * IN HER PACKAGE, and that placement is the whole design:
 *
 * - It is writable. The manifest is already sitting there, so the directory
 *   accepted a write moments ago -- unlike the policy store, which is the thing
 *   that just refused one.
 * - It is HERS. Deleting her removes the folder and this with it, so a record
 *   kept for her cannot outlive her and re-import her. Keeping the legacy
 *   `persona.json` instead did exactly that: the package was deleted, the
 *   source was not, and the next launch brought her back. A persona the user
 *   cannot delete is a worse bug than the one being fixed.
 */
export const PENDING_POLICY = 'pending-policy.json'

function pendingPolicyPath(userData: string, source: string): string {
  return join(personasRoot(userData), source, PENDING_POLICY)
}

/**
 * Where a deletion in progress is recorded.
 *
 * Beside the packages rather than inside one, because the package is the thing
 * being removed -- a record kept in there would go with the first successful
 * step and take the intent with it. Dot-prefixed, so `loadPersonas` skips it
 * with the staging folders, and a directory rather than a file so
 * `migrateLooseFiles` (which looks at `*.json` FILES in the root) never sees it.
 */
const TOMBSTONES = '.deleting'

function tombstonePath(userData: string, id: string): string {
  return join(personasRoot(userData), TOMBSTONES, `${id}.json`)
}

/** Record that a persona is being deleted, before anything is removed. */
export function writeTombstone(userData: string, id: string, source: string): void {
  mkdirSync(join(personasRoot(userData), TOMBSTONES), { recursive: true })
  writeJsonAtomically(tombstonePath(userData, id), { id, source })
}

export function clearTombstone(userData: string, id: string): void {
  try {
    unlinkSync(tombstonePath(userData, id))
  } catch (error: unknown) {
    /*
      ENOENT ONLY. The comment was right about one errno and applied to all of
      them.

      "Already gone" costs one extra sweep and nothing else -- true, and that
      is ENOENT. EACCES, EPERM or EROFS mean the record CANNOT be removed, so
      the sweep repeats on every launch for ever, re-running a deletion that
      has already happened and finding nothing to do. That is not idempotence
      working, it is a loop nobody is told about.
    */
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    console.warn(`[personas] the record of ${id}'s deletion could not be removed:`, error)
    problems.note(
      'personas',
      id,
      'a finished deletion could not be recorded as finished; it will be retried each launch',
    )
  }
}

/** Every deletion that has not finished, as `id -> source`. */
export function readTombstones(userData: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>()
  let files: string[]
  try {
    files = readdirSync(join(personasRoot(userData), TOMBSTONES))
  } catch {
    // No directory is the ordinary state: nothing has been deleted, or every
    // deletion finished.
    return found
  }
  for (const file of files) {
    const read = readBounded(join(personasRoot(userData), TOMBSTONES, file))
    if (!read.ok) {
      /*
        SKIPPED, and said so.

        A tombstone is the record that a deletion did not finish. Skipping one
        silently means that deletion is never resumed -- so data somebody asked
        to have removed stays on disk, and the only thing that knew has just
        decided not to mention it.

        Skipping is still right: the alternative is acting on a record we
        cannot read, and the block below says why that is worse. What was wrong
        was doing it quietly.
      */
      problems.note('personas', null, `an unfinished deletion could not be read (${file})`)
      continue
    }
    try {
      const parsed = JSON.parse(read.text) as Record<string, unknown>
      const id = parsed['id']
      const source = parsed['source']
      // Both are PATH SEGMENTS downstream, so they are checked here rather than
      // joined on trust -- the same rule `migrateLooseFiles` applies to a stem.
      if (typeof id !== 'string' || !isPersonaId(id)) continue
      if (typeof source !== 'string' || source === '' || /[/\\]/.test(source) || source === '..') {
        continue
      }
      found.set(id, source)
    } catch {
      // A record nobody can read names nobody in particular, and acting on a
      // guess here would delete the wrong persona's data. Reported for the
      // reason above: the deletion it recorded is now never resumed.
      problems.note('personas', null, `an unfinished deletion is unreadable and was left (${file})`)
      continue
    }
  }
  return found
}

/**
 * Try to promote a parked retention into the real store.
 *
 * Returns what is still outstanding, or null when there is nothing to do or it
 * finally landed. Called for EVERY admitted persona on every launch, not only
 * while the one-time migration is owed -- the marker records that the pass ran,
 * which is a different question from whether its writes succeeded.
 */
export function settlePendingPolicy(userData: string, id: string, source: string): Policy | null {
  const pending = readBounded(pendingPolicyPath(userData, source))
  // Absent is the ordinary case, on every persona, on every launch.
  if (!pending.ok) return pending.reason.kind === 'absent' ? null : UNREADABLE_POLICY
  let parsed: unknown
  try {
    parsed = JSON.parse(pending.text)
  } catch {
    // A record EXISTS and cannot be read. `policy.ts` already has the answer
    // for that shape: a choice that exists and is unreadable is honoured as
    // "do not keep", because the alternative is recording somebody who may
    // have asked not to be. Treating it as absence would fall back to keeping.
    return UNREADABLE_POLICY
  }
  const record = parsed as Record<string, unknown>
  const policy = parsePolicy(record)
  if (policy === null) return UNREADABLE_POLICY
  // WHOSE choice this is, checked rather than assumed.
  //
  // The record is filed by FOLDER and applied by ID, and those are deliberately
  // not the same thing (see `sources`). Without this, a record copied into
  // another package -- by hand, by a sync tool, by a backup restored over the
  // top -- is settled under whatever id that package's manifest claims, which
  // hands one persona's retention to another. A package shipped with one is
  // also how a hand-installed persona could declare retention, which the
  // migration gate exists to forbid.
  if (record['id'] !== id) return null
  if (hasPolicy(userData, id)) {
    // Somebody set it since. Their choice wins over a stale parked one, and the
    // record has no further use.
    discardPendingPolicy(userData, source)
    return null
  }
  try {
    writePolicy(userData, id, policy)
    discardPendingPolicy(userData, source)
    return null
  } catch {
    return policy
  }
}

function discardPendingPolicy(userData: string, source: string): void {
  try {
    unlinkSync(pendingPolicyPath(userData, source))
  } catch {
    // Already gone, or unremovable. Harmless either way: `settlePendingPolicy`
    // checks `hasPolicy` first, so a leftover cannot overwrite a real choice.
  }
}

/**
 * Move a manifest's retention setting to its own file, once.
 *
 * Returns the value the caller must hold in memory instead, or null when
 * nothing needs carrying. Only for a persona who has NO setting of her own:
 * re-seeding over an existing one would undo a choice made since, and
 * `hasPolicy` answers "exists" for a file it cannot read precisely so an
 * unreadable choice is not mistaken for an absent one.
 */
export function migratePolicy(
  userData: string,
  id: string,
  source: string,
  legacy: Policy | null,
): Policy | null {
  if (legacy === null || hasPolicy(userData, id)) return null
  try {
    writePolicy(userData, id, legacy)
    return null
  } catch (error: unknown) {
    // Not fatal -- refusing to load her because a migration could not write
    // would hide a character over a disk error. But not forgotten either: the
    // fallback for a missing policy file is "keep", so dropping this would
    // turn a stored opt-out into recording. The caller holds it for this run,
    // and the record below holds it for the next one.
    console.warn(`[personas] could not carry ${id}'s retention across:`, error)
    try {
      // Stamped with WHOSE it is. The record lives under a folder name and is
      // applied under an id, and settlement refuses to bridge the two on trust.
      writeJsonAtomically(pendingPolicyPath(userData, source), { id, ...legacy })
    } catch {
      // Her package is unwritable too, so there is nowhere durable left. The
      // in-memory copy is all there is, and it lasts until quit.
      console.warn(`[personas] and could not park it in ${source} either`)
      // Both routes failed, so this retention is lost: she keeps her
      // conversations for the default period rather than the chosen one, and
      // nothing else will ever mention it.
      problems.note('retention', id, 'a retention setting could not be carried across and was lost')
    }
    return legacy
  }
}
