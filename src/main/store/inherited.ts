import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Getting v1 out of v2's way.
 *
 * This application's userData directory is the one v1 wrote to, because it is
 * the same bundle id. Most of what is there v2 owns and wants — the archive,
 * the personas, the notes. Some of it is v1's alone and nothing here reads it,
 * and it has already cost this project real time: a v1-era `avatars/README.txt`
 * described behaviour the loader has never had, and following it meant dropping
 * a file in, restarting, and watching nothing happen with no error.
 *
 * ## Why a LIST, and not "anything we do not recognise"
 *
 * The tempting rule is to sweep everything v2 does not own. It cannot be done
 * safely: Chromium writes dozens of files and folders into this same directory
 * — caches, cookies, storage, crash state, names that change between Electron
 * versions — and enumerating those to spare them is the same enumeration trap
 * §10 measured for tool-name blacklists. A list you must keep complete to stay
 * SAFE fails dangerously; a list you must keep complete to stay THOROUGH fails
 * harmlessly, one leftover at a time.
 *
 * So this names v1's artifacts explicitly and touches nothing else.
 *
 * ## Moved, never deleted
 *
 * Into one dated folder, with a line in the log. Nothing here is confident
 * enough to destroy somebody's data, and a folder they can look inside is the
 * difference between a migration and a loss.
 */

/**
 * v1's, and read by nothing in `src/main`. Verified by reading, not assumed:
 * `delegation-*` and `summary-*` were v1's Codex scratch files, `drill/` and
 * `summary-scratch/` its working directories, and `persona.json.migrated` the
 * tombstone of a migration that has already happened.
 *
 * `preferences.json` is deliberately NOT here: `store/worn.ts` still reads one
 * field out of it, and that is what stops a fresh v2 launch wearing the wrong
 * character over somebody's existing archive.
 */
export const SUPERSEDED = [
  'delegation-answer.json',
  'delegation-schema.json',
  'summary-schema.json',
  'summary-scratch',
  'drill',
  'persona.json.migrated',
] as const

/** Where they go. Dated, so a second run cannot collide with the first. */
export function quarantineFolder(stamp: string): string {
  return `superseded-v1-${stamp}`
}

export interface Moved {
  readonly name: string
  readonly to: string
}

/**
 * Move v1's leftovers aside. Returns what moved, so the caller can say so.
 *
 * Failure to move ONE is not failure to launch: a file held open, or on a
 * volume that refuses the rename, is a reason to carry on with the rest rather
 * than to refuse to start. It is reported instead.
 */
export function setAsideV1(
  userData: string,
  stamp: string,
  onProblem: (name: string, reason: string) => void,
): readonly Moved[] {
  let present: string[]
  try {
    present = readdirSync(userData)
  } catch {
    return []
  }
  const found = SUPERSEDED.filter((name) => present.includes(name))
  if (found.length === 0) return []

  const folder = quarantineFolder(stamp)
  const moved: Moved[] = []
  for (const name of found) {
    try {
      // Created lazily: a run with nothing to move must not leave an empty
      // folder behind suggesting something happened.
      mkdirSync(join(userData, folder), { recursive: true })
      renameSync(join(userData, name), join(userData, folder, name))
      moved.push({ name, to: folder })
    } catch (error: unknown) {
      onProblem(name, String(error))
    }
  }
  return moved
}
