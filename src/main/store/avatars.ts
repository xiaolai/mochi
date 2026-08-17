/**
 * Which avatar she wears, resolved from disk.
 *
 * Main reads the file, not the renderer. The renderer has no business touching
 * the filesystem: doing it there would mean either relaxing the CSP to fetch
 * `file:` URLs or inventing a second path-resolution route that has to be kept
 * exactly as safe as this one. Validated DATA crosses the bridge; paths never
 * do.
 *
 * ## The built-in is the FALLBACK, not a loaded file
 *
 * Worth stating plainly, because "the default goes through the same path as a
 * user avatar" is the sort of claim that sounds like a design principle and is
 * really only true of a function name. It cannot be a file: the fallback for a
 * missing or broken avatar IS the built-in, so if the built-in were a file, a
 * corrupted one would leave nothing to fall back to. It is also a typed const,
 * which makes adding a field to the format a compile error at the definition
 * rather than a runtime failure discovered by whoever launches next.
 *
 * What actually stops the plugin path rotting is a TEST -- `seedAvatars` writes
 * the real artifact, the test renames it into place and runs the whole chain
 * (read, parse, validate, resolve) expecting the built-in back. That exercises
 * it on every commit, where loading a file in production would only report
 * after shipping.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MOCHI, parseFaceSpec, type FaceSpec } from '@shared/avatar-spec'
import { isPersonaId } from '@shared/persona'
import { logBoundedRead, readBounded } from './read-bounded'

export const AVATARS_DIR = 'avatars'

/**
 * Named `.example`, so it is NOT loaded.
 *
 * A shipped default that the loader picks up would make the built-in depend on
 * a file being present and intact -- and the fallback for a missing file is the
 * built-in, so the failure would have nothing to fall back to. The const stays
 * the default; this is a starting point to copy.
 */
export const EXAMPLE_FILE = 'mochi.json.example'
export const README_FILE = 'README.txt'

const README = `Drop a .json avatar in this folder and restart.

A persona chooses which one she wears by its FILENAME without the extension:
an avatarId of "blueberry" wears blueberry.json. A persona that names none
wears the built-in mochi. Anything rejected is reported in the console by
filename and reason -- it is never silently ignored.

Names may use lowercase letters, digits and hyphens, and must start with a
letter. That is not decoration: the name is joined into a path.

  ${EXAMPLE_FILE}
      The built-in mochi, in this format. Copy it to something.json and edit.

Design one visually with \`pnpm tuner\`; its copy button emits this same shape.

Every field is required and range-checked. Colours must be hex (#8ec8a8).
`

/**
 * Write the folder somebody is meant to find, once.
 *
 * Discoverability is not a nicety here: without this the only way to learn the
 * format is to read the source or run the tuner, and a plugin system nobody
 * finds is not a plugin system.
 *
 * Serialised from the const rather than copied from a build artifact, so the
 * example and the default cannot drift -- the file written IS the default.
 *
 * Only when the folder is absent. Rewriting it would fight a user who deleted
 * the example on purpose, and could overwrite an avatar that happened to share
 * the name.
 */
export function seedAvatars(root: string): void {
  const seeds: ReadonlyArray<readonly [string, string]> = [
    [EXAMPLE_FILE, `${JSON.stringify({ name: 'mochi', ...MOCHI }, null, 2)}\n`],
    [README_FILE, README],
  ]
  try {
    mkdirSync(root, { recursive: true })
    for (const [name, body] of seeds) {
      try {
        // `wx` fails rather than overwrites, which does two jobs at once: it
        // never clobbers a user's file, and it is atomic -- an `existsSync`
        // check followed by a write is a race, and a partial failure under the
        // old "skip if the folder exists" guard was PERMANENT, because the
        // folder existed forever after and the missing README never returned.
        writeFileSync(join(root, name), body, { flag: 'wx' })
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
  } catch (error: unknown) {
    // Best effort. A read-only or missing userData is not a reason she cannot
    // come up -- she has a face either way.
    console.warn('[avatar] could not seed the avatars folder:', error)
  }
}

export interface AvatarProblem {
  readonly file: string
  readonly reason: string
}

export interface ResolvedAvatar {
  /** What to render. Always valid — the built-in when nothing else is. */
  readonly face: FaceSpec
  /** Which file it came from, or null for the built-in. */
  readonly source: string | null
  /**
   * Everything that was rejected, and why.
   *
   * Returned rather than logged here so the caller decides how loud to be. An
   * avatar that silently did not load presents as "the app ignored my file",
   * which is the single least debuggable outcome this feature can have.
   */
  readonly problems: readonly AvatarProblem[]
}

/** The avatars folder inside a userData directory. */
export function avatarsRoot(userData: string): string {
  return join(userData, AVATARS_DIR)
}

/**
 * The avatar a persona names, or the built-in.
 *
 * `id` is a filename STEM and has already passed the persona grammar, which
 * admits no dot and no separator -- so this cannot be pointed outside the
 * folder however the persona file was written. That is why the check is a
 * grammar at the boundary rather than a sanitising step here: there is nothing
 * left to strip.
 *
 * A named avatar that is missing or invalid falls back to the built-in and
 * SAYS SO, like everything else in this module. Silently drawing the wrong
 * face is the outcome a user cannot diagnose.
 */
export function resolveAvatarById(root: string, id: string | null): ResolvedAvatar {
  if (id === null) return { face: MOCHI, source: null, problems: [] }
  // CHECKED HERE, not assumed from the caller. Every caller today passes an
  // id that `parsePersona` already validated -- and that is a property of
  // today's callers, not of this function, which takes a bare `string` and
  // joins it into a path. `memoryPath` makes the same check for the same
  // reason; leaving this one to a convention is how the next caller writes
  // the traversal.
  if (!isPersonaId(id)) {
    return {
      face: MOCHI,
      source: null,
      problems: [{ file: id, reason: 'is not a usable avatar name' }],
    }
  }
  const file = `${id}.json`
  const read = readBounded(join(root, file))
  if (!read.ok) {
    return { face: MOCHI, source: null, problems: [{ file, reason: logBoundedRead(read.reason) }] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(read.text)
  } catch (error: unknown) {
    return {
      face: MOCHI,
      source: null,
      problems: [{ file, reason: `could not be read as JSON: ${String(error)}` }],
    }
  }
  const result = parseFaceSpec(parsed)
  return result.ok
    ? { face: result.face, source: file, problems: [] }
    : { face: MOCHI, source: null, problems: [{ file, reason: result.problems.join('; ') }] }
}

/** The face a package carries, if it carries one. */
export const PACKAGE_FACE = 'face.json'

/**
 * The face for a persona: the one in her package, the one she names, or the
 * built-in.
 *
 * Those are alternatives, never a precedence chain -- a package declaring BOTH
 * is refused upstream rather than resolved here. A precedence rule is a rule
 * somebody has to remember; two mutually exclusive fields is one the format
 * enforces.
 *
 * A package-local face is the point of packages: without it a persona can only
 * ever point at something living somewhere else, which is what `avatarId` had
 * to be when a persona was a single file.
 */
export function resolveFaceFor(
  avatarsFolder: string,
  packageFolder: string | null,
  avatarId: string | null,
): ResolvedAvatar {
  if (packageFolder !== null) {
    const read = readBounded(join(packageFolder, PACKAGE_FACE))
    // Absent is ordinary: most packages will name a shared avatar or none.
    if (read.ok) {
      let parsed: unknown
      try {
        parsed = JSON.parse(read.text)
      } catch (error: unknown) {
        return {
          face: MOCHI,
          source: null,
          problems: [{ file: PACKAGE_FACE, reason: `could not be read as JSON: ${String(error)}` }],
        }
      }
      const result = parseFaceSpec(parsed)
      return result.ok
        ? { face: result.face, source: PACKAGE_FACE, problems: [] }
        : {
            face: MOCHI,
            source: null,
            problems: [{ file: PACKAGE_FACE, reason: result.problems.join('; ') }],
          }
    }
    if (read.reason.kind !== 'absent') {
      return {
        face: MOCHI,
        source: null,
        problems: [{ file: PACKAGE_FACE, reason: logBoundedRead(read.reason) }],
      }
    }
  }
  return resolveAvatarById(avatarsFolder, avatarId)
}
