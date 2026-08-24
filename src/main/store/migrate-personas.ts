/**
 * v1's shape, and the once-per-install work of leaving it behind.
 *
 * Split out of `personas.ts` because it is finished work: it runs once on a
 * machine that still has the old layout and never again. Kept beside the
 * catalogue it writes into, not inside it, so that reading how a persona is
 * loaded today does not mean reading how one was loaded in 2025.
 */
import { type PersonaCatalog } from './personas'
import { LEGACY_FILE, MANIFEST, personasRoot } from './persona-files'
import { readBounded } from './read-bounded'
import { BUILT_IN_ID, type PersonaLoadProblem, deriveId, parsePersona } from '@shared/parse-persona'
import { type Persona } from '@shared/persona'
import { type Policy } from '@shared/policy'
import { readdirSync, renameSync, rmdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { reservePackage, writeManifest } from './persona-files'
import { migratePolicy } from './unfinished'
/**
 * Move the old single `persona.json` into the catalog, once.
 *
 * IDEMPOTENT, and ordered so that nothing is lost at any point it can be
 * interrupted: the new file is written and only then is the legacy one
 * retired. A crash between the two leaves both, and the next run sees the id
 * already present and retires the legacy file without writing twice.
 *
 * The legacy persona almost always carries `id: 'mochi'`, because that is what
 * editing the built-in produced -- and that id is reserved.
 * So it is renamed. Only the KEY changes; `name` is untouched, so she is still
 * called whatever she was called.
 *
 * Returns the id the migrated persona now has, or null when there was nothing
 * to migrate.
 */
export type Migration =
  /** Nothing to move, or nothing movable. The ordinary case on every launch after the first. */
  | { readonly kind: 'none' }
  /** Imported just now. This one should become active. */
  | {
      readonly kind: 'imported'
      readonly id: string
      /**
       * Her retention, when it could not be written to its own file.
       *
       * Handed back rather than dropped: the legacy file is retired on the
       * next line, so a value lost here is lost for good -- and the fallback
       * for a missing policy is to keep, which is the wrong direction to fail
       * in. The caller holds it for this run. Null in the ordinary case.
       */
      readonly carried: Policy | null
    }
  /**
   * Already in the catalog; the legacy file simply outlived its retirement.
   *
   * DISTINCT from `imported`, and the distinction is the whole point: reported
   * as an import, every launch would reselect it and quietly overrule whichever
   * persona the user has chosen since.
   */
  | {
      readonly kind: 'already'
      readonly id: string
      /**
       * Always null on this branch, and declared so the two import outcomes
       * have one shape.
       *
       * Nothing is outstanding here by construction: reaching `already` means
       * she is in the catalog, and anything her migration could not write is
       * parked in her package and retried by `loadPersonas` on every launch.
       */
      readonly carried: Policy | null
    }
  /**
   * There IS a legacy persona and it could not be moved.
   *
   * Distinct from `none`, which used to swallow this: an upgrading user whose
   * persona.json was unreadable simply lost their character with nothing
   * anywhere to say so. The file is never deleted, so the report is actionable.
   */
  | { readonly kind: 'failed'; readonly problem: PersonaLoadProblem }

export function migrateLegacyPersona(userData: string, catalog: PersonaCatalog): Migration {
  const legacy = join(userData, LEGACY_FILE)
  const read = readBounded(legacy)
  if (!read.ok) {
    // Absent is the ordinary case on any machine that never ran the old build,
    // and on every run after the first -- it is the only one that stays quiet.
    // Everything else means there IS a file and it cannot be moved, which the
    // user has a right to hear: it is the persona they wrote.
    return read.reason.kind === 'absent'
      ? { kind: 'none' }
      : { kind: 'failed', problem: { kind: 'legacy-unreadable' } }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(read.text)
  } catch {
    return { kind: 'failed', problem: { kind: 'legacy-malformed' } }
  }
  const result = parsePersona(parsed)
  if (!result.ok) {
    // Left in place, deliberately. A persona that will not parse is still the
    // only copy of what somebody wrote, and deleting it to tidy up is the one
    // outcome that cannot be undone.
    return { kind: 'failed', problem: { kind: 'legacy-invalid', problems: result.problems } }
  }
  const legacyPersona = result.persona

  // ALREADY MIGRATED? Asked by CONTENT, not by whether the old file is gone.
  //
  // The obvious guard -- "the legacy file still exists, so migrate it" -- is
  // not idempotent, because retiring the old file can fail on its own (a
  // read-only directory, a permissions change). Then every launch would import
  // the same persona again under a fresh id, and the list would grow by one a
  // day. Comparing what is already in the catalog answers the question the
  // filesystem cannot.
  const already = [...catalog.personas].find(
    ([id, persona]) => id !== BUILT_IN_ID && sameCharacter(persona, legacyPersona),
  )
  if (already !== undefined) {
    // Her retention comes across HERE too, before the file goes.
    //
    // This branch used to retire and return, carrying nothing -- on the
    // assumption that reaching it meant the import had already happened and
    // done the carry. It does not: `sameCharacter` matches by CONTENT, so an
    // independently created persona identical to the legacy one lands here on
    // the very first pass, and the legacy `keeps: false` was dropped with the
    // file, even on a perfectly writable disk.
    const [matchedId] = already
    const source = catalog.sources.get(matchedId)
    const carried =
      source === undefined ? null : migratePolicy(userData, matchedId, source, result.legacy)
    retire(legacy)
    return { kind: 'already', id: matchedId, carried }
  }

  const taken = new Set(catalog.personas.keys())
  const id =
    taken.has(legacyPersona.id) || legacyPersona.id === BUILT_IN_ID
      ? deriveId(legacyPersona.name, taken)
      : legacyPersona.id
  // WRITE FIRST, retire second. A crash between the two leaves both copies,
  // and the content check above makes the next run recognise its own work.
  //
  // Through the same guarded creation the settings path uses. A bare write
  // here would overwrite a `<id>.json` that is in the folder but not in the
  // catalog -- a malformed persona, or one refused as a duplicate -- and
  // destroying somebody's character while importing a different one is the
  // worst thing a migration can do.
  const root = personasRoot(userData)
  const source = id
  // STRUCTURED, not thrown. This function's whole return type exists to report
  // a migration that could not happen, and the creation below was the one step
  // that escaped it instead: a full disk or a read-only personas folder threw
  // out of `loadStoredPersonas` and took the launch with it, over a legacy file
  // that is left perfectly intact either way.
  try {
    reservePackage(root, source)
  } catch {
    return { kind: 'failed', problem: { kind: 'legacy-blocked', source } }
  }
  try {
    writeManifest(join(root, source), legacyPersona, id)
  } catch (error: unknown) {
    console.warn(`[personas] could not write the migrated manifest for ${id}:`, error)
    // The reservation goes back, so the next launch can try again rather than
    // meeting an empty package it refuses as blocked.
    rmSync(join(root, source), { recursive: true, force: true })
    return { kind: 'failed', problem: { kind: 'legacy-blocked', source } }
  }
  // Her retention comes across too. The manifest being written no longer holds
  // those fields, so discarding what the old one said would have quietly moved
  // somebody who had turned transcripts OFF back to keeping them -- and the
  // legacy file is retired on the next line, so the value would be gone for
  // good. Under the NEW id, which is what the rest of her state is filed under.
  const carried = migratePolicy(userData, id, source, result.legacy)
  // RETIRED UNCONDITIONALLY, and the durable record lives in her package.
  //
  // An earlier fix kept this file when the retention write failed, so the next
  // launch could retry from it. That preserved the opt-out and bought a worse
  // bug: deleting her removed the package and left the source, so she came back
  // on the next launch, and while the policy store stayed unwritable no UI
  // action could make her stay deleted. A persona the user cannot delete is not
  // an acceptable price for a setting they can.
  //
  // `migratePolicy` parks the outstanding value inside her package instead.
  // It is durable, it is writable -- the manifest just landed there -- and it
  // is removed with her.
  retire(legacy)
  return { kind: 'imported', id, carried }
}

/**
 * Move any loose `<name>.json` into `<name>/persona.json`, once.
 *
 * The shape before packages: one file per persona. A package is a folder so
 * she can carry her own face, and the two shapes must not both be supported
 * forever -- two code paths in a loader is how one of them rots unnoticed.
 *
 * Same discipline as the legacy migration: no-clobber, and the loose file is
 * only removed once the folder holds it. A crash between the two leaves both,
 * and the next run finds the folder already there and refuses to overwrite it,
 * so the loose copy is what survives rather than what wins.
 */
export function migrateLooseFiles(userData: string): readonly PersonaLoadProblem[] {
  const root = personasRoot(userData)
  const problems: PersonaLoadProblem[] = []
  let loose: string[]
  try {
    loose = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort()
  } catch (error: unknown) {
    // ONLY a missing folder is ordinary -- that is the state of a machine with
    // no personas. Everything else is a permission or I/O failure, and
    // swallowing it as "nothing to migrate" reported success over a folder full
    // of loose files this could not see: the same distinction `loadPersonas`
    // draws two functions above, missing here.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems.push({ kind: 'folder-unreadable' })
    }
    return problems
  }

  for (const file of loose) {
    const stem = file.slice(0, -'.json'.length)
    // The stem becomes a PATH SEGMENT on the next line, so it is checked
    // before it is joined. `...json` leaves `..`, and `.json` leaves nothing
    // at all -- both of which name something other than a folder inside
    // `personas/`, and `mkdirSync`/`renameSync` would act on whatever that is.
    // The same reasoning `memoryPath` and `policyPath` apply to an id: this is
    // the line where a name turns into a location.
    if (stem === '' || stem.includes('.') || stem.includes('/') || stem.includes('\\')) {
      problems.push({ kind: 'legacy-blocked', source: file })
      continue
    }
    try {
      // Reserved rather than checked-then-created. A folder of that name being
      // already there means merging is guesswork -- which manifest wins? -- so
      // the loose file stays put and is named.
      reservePackage(root, stem)
    } catch {
      problems.push({ kind: 'legacy-blocked', source: file })
      continue
    }
    try {
      renameSync(join(root, file), join(root, stem, MANIFEST))
    } catch (error: unknown) {
      rmSync(join(root, stem), { recursive: true, force: true })
      console.warn(`[persona] could not move ${file} into a package:`, error)
      problems.push({ kind: 'unreadable', source: file })
      // The folder was made a line before the rename that failed, so it is
      // sitting there empty -- and `entryExists` above only asks whether the
      // name is taken. Left behind, every later run reports this file as
      // BLOCKED by a folder that this run created and nothing ever put
      // anything in. Removed only when empty, so a real package is never at
      // risk from a tidy-up.
      try {
        rmdirSync(join(root, stem))
      } catch {
        // Not empty, or not removable. Either way the report above stands.
      }
    }
  }
  return problems
}

/** Everything except the id, which the migration is allowed to change. */
function sameCharacter(a: Persona, b: Persona): boolean {
  // `version` is excluded for the same reason `id` is: neither is a TRAIT.
  //
  // The import writes `version: PERSONA_FORMAT` over whatever the legacy file
  // said, so comparing it meant a genuine v1 file could never match the copy
  // made from it -- and the only reason that never showed was that the legacy
  // file was retired immediately, so the comparison was only ever reached for
  // files already at the current format. The moment a file survives a launch,
  // the check imports a duplicate of a character it should have recognised.
  const { id: _a, version: _va, ...restA } = a
  const { id: _b, version: _vb, ...restB } = b
  return JSON.stringify(restA) === JSON.stringify(restB)
}

/**
 * Move the legacy file aside, best effort.
 *
 * Renamed rather than deleted: the new copy is already durable, and a
 * `.migrated` file beside it costs nothing and answers "where did my persona
 * go" for anybody who looks. Failure is survivable precisely because the
 * already-migrated check does not depend on this having worked.
 */
function retire(legacy: string): void {
  try {
    renameSync(legacy, `${legacy}.migrated`)
  } catch {
    try {
      unlinkSync(legacy)
    } catch {
      // Left where it is. The content check makes the next run a no-op rather
      // than a duplicate import, which is the outcome that actually mattered.
    }
  }
}
