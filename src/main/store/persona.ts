/**
 * Which persona she is wearing, on disk.
 *
 * ## The built-in is the FALLBACK, not a stored record
 *
 * `DEFAULT_PERSONA` stays a typed const and is never written here, for the same
 * reason `avatars.ts` gives about the built-in face: the fallback for a missing
 * or corrupt store IS the built-in, so a built-in that lived in the store would
 * have nothing to fall back to when the store is the thing that broke. It is
 * also what makes adding a field a compile error at the definition rather than
 * a runtime surprise for whoever launches next.
 *
 * ## Interim, and named as such
 *
 * One JSON file. Personas, memory and transcripts are heading for SQLite --
 * `node:sqlite` is built into Electron 43 and FTS5 is compiled in, both
 * verified on this machine -- but that schema is under review and a store
 * written against a schema nobody has attacked yet is the expensive kind of
 * wrong. The two functions below are the whole surface, so what changes when
 * the schema lands is this file and nothing that calls it.
 */

import { join } from 'node:path'
import { logSaveProblem } from '@shared/ipc'
import { DEFAULT_PERSONA, parsePersona, type Persona } from '@shared/persona'
import { readJsonFile, writeJsonAtomically } from './json-file'

export const PERSONA_FILE = 'persona.json'

// Not exported: nothing outside this module has ever needed it, and the point
// of keeping the surface at two functions is that the SQLite migration touches
// this file alone. An exported path is a caller waiting to happen.
function personaPath(userData: string): string {
  return join(userData, PERSONA_FILE)
}

export interface LoadedPersona {
  readonly persona: Persona
  /** Why the stored one was not used, if it was not. Never silently swallowed. */
  readonly problem: string | null
}

/**
 * The stored persona, or the built-in.
 *
 * A stored file that does not validate is REPORTED and then ignored, rather
 * than partially merged. Merging a half-valid persona produces a character
 * nobody designed: the name from the file, the voice from the default, and a
 * greeting from whichever survived.
 */
export function loadPersona(userData: string): LoadedPersona {
  const read = readJsonFile(personaPath(userData))
  if (!read.ok) {
    // Only "no file yet" is the ordinary case. A permission error or an
    // unreadable directory means the persona is unreachable for a reason worth
    // saying out loud, and reporting it identically to "you have not
    // customised anything" leaves a user with a broken setup no clue at all.
    const problem =
      read.problem.kind === 'absent'
        ? null
        : read.problem.kind === 'malformed'
          ? `is not valid JSON: ${read.problem.detail}`
          : `could not be read: ${read.problem.detail}`
    return { persona: DEFAULT_PERSONA, problem }
  }

  const result = parsePersona(read.value)
  return result.ok
    ? { persona: result.persona, problem: null }
    : { persona: DEFAULT_PERSONA, problem: result.problems.map(logSaveProblem).join('; ') }
}

/** Write it atomically — see `json-file.ts` for why the rename matters. */
export function savePersona(userData: string, persona: Persona): void {
  writeJsonAtomically(personaPath(userData), persona)
}
