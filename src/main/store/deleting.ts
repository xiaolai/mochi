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

/** Record that a persona is being deleted, before anything is removed. */
export function markDeleting(userData: string, id: string, source: string): void {
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
