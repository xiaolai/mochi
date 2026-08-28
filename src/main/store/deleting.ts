/**
 * Which deletions were interrupted, and how the next launch finds out.
 *
 * A delete records its INTENT before it touches anything, removes everything
 * filed under her, then clears the record. A process killed in the middle
 * leaves the mark, and the next launch finishes the job. So the states are
 * "not deleted" and "deleted, possibly still being tidied up", with nothing in
 * between where she is half gone and fully present.
 *
 * ## Why this is its own module rather than part of the catalogue
 *
 * Two modules need it and neither may import the other: `personas.ts` skips a
 * marked id while loading, and `delete-persona.ts` writes and clears the mark.
 * A module that imports nothing back is what keeps that direction obvious.
 *
 * This replaces the tombstone half of the former `unfinished.ts`, whose other
 * half carried a v1 retention setting forward and went with the rest of the
 * migration layer. The on-disk name is unchanged, because a real install may
 * have an interrupted deletion recorded under it right now.
 */
import { writeJsonAtomically } from './json-file'
import { personasRoot } from './persona-files'
import { readBounded } from './read-bounded'
import { isPersonaId } from '@shared/parse-persona'
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { problems } from '../problems'

/**
 * Where a deletion in progress is recorded.
 *
 * Beside the packages rather than inside one, because the package is the thing
 * being removed -- a record kept in there would go with the first successful
 * step and take the intent with it. Dot-prefixed, so `loadPersonas` skips it
 * with the staging folders.
 */
const MARKS = '.deleting'

function markPath(userData: string, id: string): string {
  return join(personasRoot(userData), MARKS, `${id}.json`)
}

/**
 * Whether a string may be joined under `personasRoot` as a package folder.
 *
 * ## An allowlist, because the blocklist it replaces missed the worst value
 *
 * The reader used to refuse `''`, anything containing a separator, and `'..'`.
 * It did not refuse `'.'` — and `join(personasRoot, '.')` IS `personasRoot`, so
 * recovery's recursive remove would have taken every persona on the machine. One
 * corrupted mark, the whole cast.
 *
 * That is not an oversight to patch by adding `'.'` to the list. It is what a
 * blocklist does: `plan-v2.md` records `agents.override.md` as "blocklist rot
 * that arrived immediately rather than in some future release", and this is the
 * same shape. The question a guard here can actually answer is not "which values
 * are dangerous" — nobody can enumerate that — but "which values are a package
 * folder", and there are few of those.
 *
 * So: it starts with a letter or a digit, which alone refuses `.`, `..`, every
 * hidden name and every absolute path; it holds only characters a folder created
 * by this app can hold; and it is bounded, because a name is a path component
 * and every filesystem has a limit that produces a different error much further
 * away.
 *
 * `readCandidate` joins it as `join(root, source, MANIFEST)`, so a legitimate
 * value is always a plain directory name — `isPersonaId`'s shape plus the dots
 * and cases a folder somebody made by hand may carry.
 */
const PACKAGE_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function isPackageFolder(value: unknown): value is string {
  return typeof value === 'string' && value !== '..' && PACKAGE_FOLDER.test(value)
}

/**
 * Record that a persona is being deleted, before anything is removed.
 *
 * Both fields are checked HERE as well as on the way back out. A mark is the
 * one durable instruction this store gives itself, and the reader cannot tell a
 * value this function wrote from one somebody typed into the file — so the
 * write is where an unusable value should fail, loudly, next to the caller that
 * produced it.
 */
export function markDeleting(userData: string, id: string, source: string): void {
  if (!isPersonaId(id)) throw new Error(`refusing to mark an unusable persona id: ${id}`)
  if (!isPackageFolder(source)) {
    throw new Error(`refusing to mark a deletion against an unusable folder: ${source}`)
  }
  mkdirSync(join(personasRoot(userData), MARKS), { recursive: true })
  writeJsonAtomically(markPath(userData, id), { id, source })
}

export function unmarkDeleting(userData: string, id: string): void {
  try {
    unlinkSync(markPath(userData, id))
  } catch (error: unknown) {
    /*
      ENOENT ONLY. An earlier version was right about one errno and applied it
      to all of them.

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
export function unfinishedDeletions(userData: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>()
  let files: string[]
  try {
    files = readdirSync(join(personasRoot(userData), MARKS))
  } catch {
    // No directory is the ordinary state: nothing has been deleted, or every
    // deletion finished.
    return found
  }
  for (const file of files) {
    const read = readBounded(join(personasRoot(userData), MARKS, file))
    if (!read.ok) {
      /*
        SKIPPED, and said so.

        This is the record that a deletion did not finish. Skipping one
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
      // joined on trust.
      // Both are PATH SEGMENTS downstream, so both go through the allowlist
      // rather than a list of values somebody thought to forbid.
      if (!isPersonaId(id)) continue
      if (!isPackageFolder(source)) {
        problems.note(
          'personas',
          null,
          `an unfinished deletion names an unusable folder and was left (${file})`,
        )
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
