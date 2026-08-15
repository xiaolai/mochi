/**
 * Reading a persona's artifact off disk.
 *
 * `artifact.json` sits beside the manifest and declares what she does. It
 * replaces the drill's rule of "having a `words.json` makes you a drill",
 * which recognised one filename and could never recognise a second.
 *
 * ## The built-in can carry one
 *
 * She has no `sources` entry — that absence is how the catalog says "this one
 * has no file to write" — so an artifact resolved through `sources` alone
 * could never reach her. Her folder is the same one her edits live in, and
 * that is the right place: the app ships her character, and giving her
 * something to do is something this install did, not something she came with.
 */

import { join } from 'node:path'
import { BUILT_IN_ID } from '@shared/persona'
import { isSiblingFile, parseArtifact, type ResolvedArtifact } from '@shared/artifact'
import { personasRoot } from './personas'
import { readBounded } from './read-bounded'

/** The file that declares what a persona does. */
export const ARTIFACT_FILE = 'artifact.json'

/** Refused loudly rather than approximated. See `ArtifactProblem` handling. */
export interface ArtifactRead {
  readonly artifact: ResolvedArtifact | null
  /** Why not, when there is a file and it could not be used. */
  readonly problems: readonly string[]
}

const NONE: ArtifactRead = { artifact: null, problems: [] }

/**
 * Which folder holds a persona's package.
 *
 * The built-in's is named after her id even though the catalog has no entry
 * for her, because her folder exists for the overlay already. Everyone else's
 * comes from `sources`, which is authoritative precisely so a folder can be
 * renamed without changing who she is.
 */
export function packageFolder(
  personaId: string,
  sources: ReadonlyMap<string, string>,
): string | null {
  const known = sources.get(personaId)
  if (known !== undefined) return known
  return personaId === BUILT_IN_ID ? BUILT_IN_ID : null
}

/**
 * Read what she does, or nothing.
 *
 * An absent file is the ordinary case — nearly every persona is a companion
 * and does not declare a behaviour. A file that is present and wrong is a
 * PROBLEM: somebody wrote it on purpose and it did not take, and the worst
 * possible answer is a persona that loads, looks right, and does nothing.
 */
export function readArtifact(
  userData: string,
  personaId: string,
  sources: ReadonlyMap<string, string>,
): ArtifactRead {
  const folder = packageFolder(personaId, sources)
  if (folder === null) return NONE
  const root = join(personasRoot(userData), folder)

  // `readBounded`, not `readFileSync`. This file comes from a package somebody
  // else may have written, in a directory the user can write to: the bare read
  // had no size ceiling and followed symlinks, so `artifact.json` could name
  // any file the app can open and hand its contents to the parser -- which is
  // exactly the confinement `isSiblingFile` exists to provide, undone one line
  // above it.
  const read = readBounded(join(root, ARTIFACT_FILE))
  if (!read.ok) {
    // Absent is the ORDINARY case: nearly every persona is a companion and
    // declares no behaviour. Anything else means a file is there and this app
    // refused it, which must not look identical to having none.
    if (read.reason.kind === 'absent') return NONE
    return { artifact: null, problems: [`${ARTIFACT_FILE} could not be read: ${read.reason.kind}`] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(read.text)
  } catch (error: unknown) {
    return { artifact: null, problems: [`${ARTIFACT_FILE} is not valid JSON: ${String(error)}`] }
  }
  const result = parseArtifact(parsed)
  if (!result.ok) return { artifact: null, problems: result.problems }

  // The items may live in a sibling file. Resolved HERE rather than in the
  // parser, which is pure and has no business touching a disk.
  const items = result.artifact.items
  if (Array.isArray(items)) return { artifact: { ...result.artifact, items }, problems: [] }

  const named = (items as { file: string }).file
  // Checked again at the moment of use, not only at parse. Between the two
  // there is a `join`, and a name that reached it unchecked would be a package
  // choosing which file the app opens.
  if (!isSiblingFile(named)) {
    return { artifact: null, problems: [`"${named}" is not a file beside the manifest`] }
  }
  // Bounded and lstat-checked for the same reason as the manifest above, and
  // more so: this is the filename the PACKAGE chose. `isSiblingFile` stops it
  // naming a path; `readBounded` stops it naming a symlink that is one.
  const listRead = readBounded(join(root, named))
  if (!listRead.ok) {
    return { artifact: null, problems: [`${named} could not be read: ${listRead.reason.kind}`] }
  }
  let list: unknown
  try {
    list = JSON.parse(listRead.text)
  } catch (error: unknown) {
    return { artifact: null, problems: [`${named} is not valid JSON: ${String(error)}`] }
  }
  // A bare array or `{ items: [...] }`. Both are what somebody writes when
  // nobody told them which, and refusing one would be a format quiz.
  const raw = Array.isArray(list)
    ? list
    : typeof list === 'object' && list !== null
      ? ((list as Record<string, unknown>)['items'] ?? (list as Record<string, unknown>)['words'])
      : undefined
  if (!Array.isArray(raw)) {
    return { artifact: null, problems: [`${named} is not a list`] }
  }
  // Every element named, not filtered -- the same rule the inline list follows,
  // for the same reason. A list somebody maintains by hand is exactly where a
  // stray `null` or a trailing blank line ends up, and silently loading the
  // rest teaches that the file was fine.
  const bad = raw
    .map((one, index) => ({ one, index }))
    .filter(({ one }) => typeof one !== 'string' || one.trim() === '')
  if (bad.length > 0) {
    return {
      artifact: null,
      problems: bad.map(({ index }) => `${named}[${String(index)}] is not something she could say`),
    }
  }
  if (raw.length === 0) return { artifact: null, problems: [`${named} has nothing in it`] }
  return { artifact: { ...result.artifact, items: raw as readonly string[] }, problems: [] }
}
