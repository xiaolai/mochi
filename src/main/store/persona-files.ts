/**
 * Where characters live on disk, and what the files there are called.
 *
 * ## Why this is separate from the catalogue
 *
 * Splitting `personas.ts` produced a cycle: the catalogue needs the crash
 * recovery in `deleting.ts` and the built-in's diff in `her-edits.ts`, and
 * both of those need to know where a package sits -- which lived in the
 * catalogue. Two modules that import each other are two modules that must be
 * read together, which is worse than the one file they came from.
 *
 * So the layout moved down here instead. Everything above imports it and it
 * imports nothing back, which is what makes the direction obvious rather than
 * merely current.
 */
import { writeJsonAtomically } from './json-file'
import { storeRoot } from './store-root'
import { PERSONA_FORMAT, type Persona } from '@shared/persona'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
export const PERSONAS_DIR = 'personas'

/**
 * The one file every persona package must have.
 *
 * Named rather than implied by the folder, so the folder can hold the rest of
 * her -- a `face.json` today, motion clips when there is a format for them --
 * without the loader having to guess which file is the manifest.
 */
export const MANIFEST = 'persona.json'

/**
 * How many persona files this app will look at.
 *
 * ADVISORY, not enforced by refusing to load. Nobody writes eighty characters,
 * so passing this means something has gone wrong -- a script, a sync conflict,
 * a backup unpacked into the wrong folder -- and saying so is useful. What it
 * must NOT do is decide which personas exist: truncating the list dropped the
 * one the user was wearing whenever its filename sorted late.
 *
 * The real protection against main-thread cost is the per-file byte bound in
 * `read-bounded.ts`, which applies to every file however many there are.
 */
export const MAX_PERSONAS = 64

/** Which id a manifest on disk claims, without validating the rest of it. */
export function manifestId(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    const id = (parsed as Record<string, unknown>)['id']
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

export function personasRoot(userData: string): string {
  return storeRoot(userData, PERSONAS_DIR)
}

/**
 * Take a package name, or fail because somebody else already has it.
 *
 * ## What it guarantees, and what it does not
 *
 * This said "exclusively", which overstates it. `mkdir` is atomic AT THE MOMENT
 * IT RUNS: either this call created the directory or somebody else already had
 * it, with no window between the question and the answer. That is the whole
 * value and it is real.
 *
 * It is not a LOCK held until the caller is finished. `copyPersonaTo` reserves,
 * builds a staging folder, and then renames onto the reservation — and `rename`
 * silently replaces an EMPTY destination directory. So an actor that removes
 * the reservation and recreates it as an empty folder in between loses that
 * folder to the rename. Nothing portable closes that: it needs the directory
 * held open across the two operations, which neither Node nor POSIX offers for
 * a rename target.
 *
 * The window is milliseconds and the actor has to be inside the app's own data
 * directory, so the residual is narrow. Stating it is the point — a docblock
 * claiming exclusivity is what stops the next person looking for the gap.
 *
 * The ONE creation primitive, used by every path that makes a package. Each of
 * them used to ask `entryExists` and then write, which is a check-then-act
 * race rather than a guarantee: between the two, a sync client, a second
 * instance or the user with a file manager can create the destination, and the
 * write that follows lands inside somebody else's package. `renameSync` makes
 * it worse -- it silently REPLACES an empty destination directory, so the
 * no-clobber comment above it was describing a check the operation went on to
 * undo.
 *
 * `mkdir` without `recursive` is the primitive that actually holds: it either
 * creates the directory or fails with `EEXIST`, in one step, and it folds case
 * on the filesystems that fold case -- which is the other half of what
 * `entryExists` was hand-rolling, since `ADA` and `ada` are one directory on
 * macOS.
 */
export function createPackage(root: string, name: string): string {
  mkdirSync(root, { recursive: true })
  const folder = join(root, name)
  try {
    mkdirSync(folder)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`refusing to overwrite ${name}, which is already in the personas folder`)
    }
    throw error
  }
  return folder
}

/**
 * Write a manifest into a package, stamped with the current format.
 *
 * One helper because both writing paths did this -- a first save and a copy --
 * with different collision behaviour and different error mapping between them.
 * A third caller, the v1 legacy import, went with the migration layer.
 *
 * Stamped with the CURRENT format, not whatever version the persona was loaded
 * under: a v1 manifest rewritten by this build no longer holds `keeps`, so
 * leaving it labelled v1 tells an older build it is safe to read, and that
 * build fills `keeps: true` over an opt-out it cannot see.
 */
export function savePersonaManifest(
  folder: string,
  persona: Persona,
  id: string,
  name = persona.name,
): void {
  writeJsonAtomically(join(folder, MANIFEST), {
    ...persona,
    id,
    name,
    version: PERSONA_FORMAT,
  })
}
