/**
 * What each persona remembers, filed under her id.
 *
 * ## Why this is not a field of `Persona`
 *
 * A persona is what somebody WROTE; memory is what came of using it. The two
 * have different lifetimes, and that is the whole argument: a persona can be
 * replaced by a newer version of itself -- edited, re-imported, one day
 * shipped as a package -- and the memory has to survive that. Held inside the
 * persona, "update" and "wipe her history" would be the same operation.
 *
 * It is also a privacy boundary rather than a tidiness one. A work persona and
 * a personal one sharing a memory is a fault, not a smell, so the file is per
 * id and nothing merges them.
 *
 * ## Bounded, because it is billed
 *
 * Every byte here is concatenated into a system prompt and sent on every wake.
 * `PERSONA_LIMITS.memory` is the ceiling and it is enforced HERE, on the way
 * out as well as in: a file edited by hand is exactly as capable of holding a
 * novel as a bug is, and the cost lands on the user either way.
 *
 * ## Nothing writes it yet
 *
 * `remember` exists and is tested; no caller invokes it, because deciding WHAT
 * is worth remembering is a product question this milestone does not answer.
 * What matters now is that the read path is real, so `instructionsFor` stops
 * being handed a hardcoded empty string.
 */

import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logBoundedRead, readBounded } from './read-bounded'
import { PERSONA_LIMITS, isPersonaId } from '@shared/persona'
import { writeJsonAtomically } from './json-file'

export const MEMORY_DIR = 'memory'

export function memoryRoot(userData: string): string {
  return join(userData, MEMORY_DIR)
}

/**
 * The file holding one persona's notes.
 *
 * `id` has already passed the persona grammar, which admits no dot and no
 * separator -- so this join cannot escape the folder. The assertion is not
 * defence in depth for its own sake: this function turns an id into a PATH,
 * and it is the one place where a grammar change that let a `/` through would
 * become a traversal rather than a lookup failure.
 */
function memoryPath(userData: string, id: string): string {
  if (!isPersonaId(id))
    throw new Error(`refusing to build a memory path from ${JSON.stringify(id)}`)
  return join(memoryRoot(userData), `${id}.json`)
}

/**
 * What she remembers, or nothing.
 *
 * Nothing is the ordinary case and is never an error: a persona nobody has
 * talked to has no notes, and reporting that identically to "her memory could
 * not be read" would put a warning in front of every new character.
 *
 * A file that cannot be read or does not hold text yields nothing too, and
 * says so in the log. Failing to start because a note is corrupt would be
 * worse than starting without it -- but doing that silently is what leaves
 * somebody wondering why she has forgotten them.
 */
export function recall(userData: string, id: string): string {
  // OUTSIDE the try, and that placement is the whole point. Inside it, the
  // refusal in `memoryPath` was caught by the handler below, which reads
  // `error.code`, finds no `ENOENT`, logs a warning and returns "" -- so an id
  // that should have been a loud programming error became "she has no memory",
  // which is a legitimate answer this function gives every day. The assertion
  // existed and could not be reached.
  const path = memoryPath(userData, id)
  // BOUNDED, and not through a symlink. Memory reaches a system prompt, so a
  // `memory/<id>.json` pointing somewhere else on the disk would send whatever
  // it points at to a model. See `read-bounded.ts`.
  const read = readBounded(path)
  if (!read.ok) {
    if (read.reason.kind !== 'absent') {
      console.warn(`[memory] ${id} ${logBoundedRead(read.reason)}`)
    }
    return ''
  }
  let value: unknown
  try {
    value = JSON.parse(read.text)
  } catch (error: unknown) {
    console.warn(`[memory] ${id} is not valid JSON:`, error)
    return ''
  }
  const notes = (value as { notes?: unknown } | null)?.notes
  if (typeof notes !== 'string') {
    console.warn(`[memory] ${id} has no notes to read`)
    return ''
  }
  // TRUNCATED rather than refused. The bound exists to stop an unbounded
  // request going out on every wake; dropping her whole memory because it grew
  // past the ceiling would be a worse answer to that than keeping what fits.
  return notes.length > PERSONA_LIMITS.memory ? notes.slice(0, PERSONA_LIMITS.memory) : notes
}

/**
 * Replace what she remembers.
 *
 * Whole-file, not append. Memory is meant to stay inspectable and deletable --
 * that is the argument for keeping it an explicit string rather than an
 * implicit accumulation in somebody's context window -- and an append-only log
 * quietly becomes the second thing.
 */
export function remember(userData: string, id: string, notes: string): void {
  const kept = notes.length > PERSONA_LIMITS.memory ? notes.slice(0, PERSONA_LIMITS.memory) : notes
  writeJsonAtomically(memoryPath(userData, id), { notes: kept })
}

/**
 * Delete what a persona remembered.
 *
 * Called when she is deleted, so a later persona that happens to derive the
 * same id cannot inherit her notes. Absent is success: there is nothing to
 * remove for a character nobody ever spoke to, and treating that as a failure
 * would make deleting her report an error for having been quiet.
 */
export function forgetMemory(userData: string, id: string): void {
  try {
    unlinkSync(memoryPath(userData, id))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    // THROWN, not warned. The comment here used to say the persona file was
    // already gone by the time this ran, so failing would only make things
    // worse -- and that stopped being true when `deletePersona` was reordered
    // to remove the package LAST. Her package is what reserves her id, so a
    // swallowed failure here releases `ada` to the next persona of that name
    // with a stranger's notes still filed under it, which is the whole outcome
    // the reordering exists to prevent. Failing keeps her, and her notes,
    // until it can be done properly.
    throw error
  }
}
