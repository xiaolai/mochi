/**
 * Every persona on this machine, and which file each came from.
 *
 * ## The built-in is always in the catalog and never on disk
 *
 * She is a typed constant, by the argument the avatar format makes: the
 * fallback for a broken catalog IS her, so she cannot be the thing that broke.
 * But she must still be SELECTABLE -- somebody who wrote a tutor persona has to
 * be able to come back -- so `loadPersonas` always returns her as an entry, and
 * `sources` simply has no path for her. That absence is the answer to "can this
 * one be written to", which is why it is a missing key rather than a flag.
 *
 * ## Why `sources` exists at all
 *
 * An id does not come from a filename, because the id keys
 * memory and a rename would orphan it. So the mapping has to be kept somewhere,
 * and this is it: main-only, not exported through any bridge, rebuilt on every
 * load. Without it a save has no target and the only alternative is deriving a
 * path from an id -- which is how a `..` gets in later.
 *
 * ## Interim, like everything else in this folder
 *
 * A directory of small JSON files. It is heading for SQLite with the persona
 * store and the transcripts; keeping the surface to three functions is what
 * makes that a change here rather than at every call site.
 */

import { cpSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_PERSONA, type Persona } from '@shared/persona'
import { BUILT_IN_ID, deriveId, parsePersona, type PersonaLoadProblem } from '@shared/parse-persona'
import { PACKAGE_FACE } from './avatars'
import { readBounded } from './read-bounded'
import { EDITS, type PersonaEdits, builtInPersona, writeEdits } from './her-edits'
import { unfinishedDeletions } from './deleting'
import {
  MANIFEST,
  createPackage,
  manifestId,
  personasRoot,
  savePersonaManifest,
} from './persona-files'
import { MAX_PERSONAS } from './persona-files'
import { seedGrants } from './grants'

/**
 * The folder a persona is stored in, having checked it is still HERS.
 *
 * `sources` is a snapshot from the last load. A folder renamed by hand while
 * the app is running makes it stale, and a DIFFERENT package moved into that
 * name makes it actively wrong -- at which point writing to it edits somebody
 * else's persona and deleting it removes somebody else's package. Deletion
 * already asked this question; saving and copying only checked that the name
 * still existed, which is the weaker half.
 */
function verifiedSource(userData: string, catalog: PersonaCatalog, id: string): string {
  const source = catalog.sources.get(id)
  if (source === undefined) throw new Error(`${id} has no file to read`)
  const standing = readBounded(join(personasRoot(userData), source, MANIFEST))
  const claims = standing.ok ? manifestId(standing.text) : null
  if (claims !== id) {
    throw new Error(`${source} is no longer ${id}; reopen mochi before editing this persona`)
  }
  return source
}

export interface PersonaCatalog {
  /** Every persona that loaded, by id. Never empty -- the built-in is always here. */
  readonly personas: ReadonlyMap<string, Persona>
  /** Where each stored persona came from. No entry for the built-in. */
  readonly sources: ReadonlyMap<string, string>
  /**
   * Ids that are not selectable but are not free either.
   *
   * A persona whose deletion has not finished. She is out of `personas`, so
   * nothing wears her, lists her or writes to her -- but her package is still on
   * disk holding her name, so handing the id to a new character would both fail
   * the folder reservation and, if it did not, give somebody a stranger's
   * leftovers. `deriveId` is told about these for that reason.
   */
  readonly reserved: ReadonlySet<string>
  /**
   * Everything refused, and why.
   *
   * Returned rather than logged, exactly as `resolveAvatarById` does it, so the
   * caller decides how loud to be. A persona that silently did not load
   * presents as "the app ignored my file", which is the single least
   * debuggable outcome this feature can have.
   */
  readonly problems: readonly PersonaLoadProblem[]
  /**
   * Retention carried out of an old manifest that could NOT be stored.
   *
   * Empty in the ordinary case, because the migration writes the file and the
   * store answers from disk thereafter. It exists for the failure: a policy
   * that cannot be written falls back to "no file", and no file means keep --
   * so a disk error would turn somebody's stored `keeps: false` into
   * recording, silently, which is the one direction this must never fail in.
   * Held in memory for this run so the effective answer stays theirs.
   */
}

/**
 * A file that parsed, held with its origin until duplicates are settled.
 *
 * Two passes rather than one: an id is only known to be unique after every
 * file has been read, and the FIRST of a duplicate pair must not already be in
 * the catalog by the time the second one is found.
 */
interface Candidate {
  readonly source: string
  readonly persona: Persona
  /** A retention setting found in an older manifest, awaiting migration. */
  /** The manifest asked for retention this build cannot honour. */
  readonly declaresRetention: boolean
}

/**
 * Read the folder. Never throws, never returns an empty catalog.
 *
 * Every file is examined even after failures: stopping early leaves a broken
 * persona permanently silent, and the person it fails is the one who wrote the
 * broken file.
 */
export function loadPersonas(userData: string, edits: PersonaEdits): PersonaCatalog {
  const root = personasRoot(userData)
  const problems: PersonaLoadProblem[] = []
  // The built-in, as this install has her. Her edits are applied HERE so the
  // catalog is the single answer to "what is this persona", the built-in
  // included. Applying them further downstream would leave
  // `catalog.personas.get(BUILT_IN_ID)` describing a mochi nobody is wearing.
  const personas = new Map<string, Persona>([[BUILT_IN_ID, builtInPersona(edits)]])
  const sources = new Map<string, string>()
  let files: string[]
  try {
    files = readdirSync(root, { withFileTypes: true })
      // A package is a FOLDER, so a persona can carry her own face -- and, one
      // day, her own motion. A single file can only ever reference something
      // that lives somewhere else, which is what `avatarId` had to be.
      .filter((entry) => entry.isDirectory())
      // Not the dot-prefixed ones. `copyPersonaTo` builds into `.staging-<id>`
      // and renames it into place, so a package is only ever seen complete --
      // but a process killed mid-copy leaves the staging folder behind, and
      // scanning it would report a broken persona for a package that is not
      // one. `.DS_Store` and friends are excluded by the same rule.
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      // Sorted, so two machines holding identical folders report their problems
      // in the same order. `readdir` order is filesystem-dependent.
      .sort()
  } catch (error: unknown) {
    // ONLY a missing folder is ordinary -- nobody has written a persona yet.
    // A permission error means her characters are unreachable for a reason
    // worth saying out loud.
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
    if (!missing) {
      problems.push({ kind: 'folder-unreadable' })
    }
    return { personas, sources, problems, reserved: new Set() }
  }

  // BOUNDED, before anything is read.
  //
  // This runs on the main thread before any window appears, over a folder the
  // user can put anything in. Without a ceiling on the COUNT, ten thousand
  // files is ten thousand synchronous stats and parses between launch and the
  // first frame; without a ceiling on the SIZE, one large file is enough. Both
  // limits are far past what a person accumulates on purpose.
  // REPORTED, never truncated.
  //
  // Reading only the first 64 sorted names was worse than the problem it
  // solved: a fork whose filename sorted past the cutoff was written, reported
  // as saved, and then absent from the catalog -- so the tray did not list the
  // active persona, the next launch could not find the remembered id, and
  // duplicates beyond the cutoff went undetected. Silently losing the persona
  // somebody is wearing is a worse failure than a slow start.
  //
  // The per-file bound below is what actually protects the main thread; this
  // is advice that the folder has grown past what was designed for.
  //
  // The message says so. It used to say "the rest were not looked at", which
  // was never true -- every file is read, deliberately -- so the one diagnostic
  // covering a slow startup described a limit that does not exist and sent
  // anybody reading it looking for personas that had been skipped.
  if (files.length > MAX_PERSONAS) {
    problems.push({ kind: 'too-many', found: files.length, limit: MAX_PERSONAS })
  }

  // Deletions that have not finished. She is gone as far as everything above
  // this store is concerned, from the moment the deletion mark lands -- otherwise a
  // deletion interrupted after her memory went would put her back on the shelf
  // with half her history missing and no sign that anything had happened.
  const deleting = unfinishedDeletions(userData)

  const byId = new Map<string, Candidate[]>()
  for (const source of files) {
    const read = readCandidate(root, source)
    if (read.problem !== null) problems.push(read.problem)
    if (read.candidate === null) continue
    const group = byId.get(read.candidate.persona.id)
    if (group === undefined) byId.set(read.candidate.persona.id, [read.candidate])
    else group.push(read.candidate)
  }

  for (const [id, group] of byId) {
    // Not a problem to report: the user asked for her to go, and the sweep has
    // simply not caught up.
    if (deleting.has(id)) continue
    const first = group[0]
    if (group.length > 1 || first === undefined) {
      // The WHOLE group goes. Picking one would make the choice depend on
      // filesystem order, and the loser's memory would silently attach to the
      // winner -- the two share an id, which is the key memory is filed under.
      problems.push({ kind: 'duplicate-id', id, sources: group.map((c) => c.source) })
      continue
    }
    /*
      A RETENTION CHOICE THIS BUILD CANNOT HONOUR REFUSES HER.

      v1 wrote `keeps`/`keepDays` into the manifest and the loader moved them
      into the policy store on first read. That migration went with the rest of
      the v1 layer (`plan-0.1.md` W1), on the argument that there are no v1
      installs to migrate — but `parsePersona` still hands the fields back as
      `legacy`, so for a moment this admitted a persona whose stored opt-out had
      just been read and dropped. She would load, and record, having asked not
      to be.

      The fallback for a missing policy is to KEEP, which is the one direction
      this must never fail in. So the choice is between honouring a declaration
      whose machinery is gone and refusing the package that carries it, and
      refusing is the only one of those that cannot quietly record somebody.

      Only when it actually asks for something. A v1 manifest saying `keeps:
      true` asks for the default and loses nothing by being read as the
      default.

      Asked of `declaresRetention`, which reads the RAW fields, and not of the
      parsed `legacy` — which this first version did, and which let two shapes
      through: `keepDays: 7` normalises to `{keeps: true}` and a malformed
      `keeps` normalises to null, so a seven-day request and an unreadable one
      both read as "asked for nothing" and were admitted to keep for ever.
    */
    if (first.declaresRetention) {
      problems.push({ kind: 'retention-unsupported', id, source: first.source })
      continue
    }
    personas.set(id, first.persona)
    sources.set(id, first.source)
  }

  return { personas, sources, problems, reserved: new Set(deleting.keys()) }
}

/**
 * One package folder, read and judged. PURE apart from the reads.
 *
 * Extracted because `loadPersonas` had grown to 185 lines holding enumeration,
 * parsing and duplicate resolution in one scroll. The retention migration,
 * the pending-policy settlement and the marker lifecycle that used to sit
 * beside them went with the v1 migration layer.
 *
 * `retry` is what separates "this file is broken" from "this file could not be
 * opened". Only the second defers the one-time retention gate: a parse failure
 * reads the same way on every future launch, so deferring for it would mean
 * never closing.
 */
function readCandidate(
  root: string,
  source: string,
): {
  readonly candidate: Candidate | null
  readonly problem: PersonaLoadProblem | null
} {
  const read = readBounded(join(root, source, MANIFEST))
  if (!read.ok) {
    // `absent` is a race -- the file was listed and then removed -- and is
    // as unremarkable as never having existed.
    if (read.reason.kind === 'absent') return { candidate: null, problem: null }
    return { candidate: null, problem: { kind: 'unreadable', source } }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(read.text)
  } catch {
    return { candidate: null, problem: { kind: 'malformed', source } }
  }
  const result = parsePersona(parsed)
  if (!result.ok) {
    return {
      candidate: null,
      problem: { kind: 'invalid', source, problems: result.problems },
    }
  }
  // The reserved id is refused HERE rather than in `parsePersona`, which
  // validates the built-in herself and would refuse her own id.
  if (result.persona.id === BUILT_IN_ID) {
    return {
      candidate: null,
      problem: { kind: 'reserved-id', id: BUILT_IN_ID, source },
    }
  }
  // A package cannot both carry a face and name one. Only the loader can
  // see both, which is why this is checked here rather than in the parser.
  if (result.persona.avatarId !== null && hasOwnFace(join(root, source))) {
    return { candidate: null, problem: { kind: 'two-faces', source } }
  }
  return {
    candidate: {
      source,
      persona: result.persona,
      declaresRetention: result.declaresRetention,
    },
    problem: null,
  }
}

export interface Resolved {
  readonly persona: Persona
  /** Set when the remembered id was not usable, so the caller can say so. */
  readonly problem: PersonaLoadProblem | null
}

/**
 * Which persona is active, given what preferences remember.
 *
 * Falls back to the built-in and SAYS SO. A remembered id that no longer
 * resolves is the ordinary consequence of deleting a file, and answering it
 * identically to "you have never chosen one" leaves somebody looking at a
 * character they did not pick with nothing to read.
 */
export function activePersona(catalog: PersonaCatalog, activeId: string | null): Resolved {
  // Looked UP rather than returned as a constant, the built-in included. She
  // carries a colour this install may have chosen, and reading her from the
  // module instead of the catalog handed back a mochi wearing her factory
  // green -- which is exactly the fallback path, so the bug would have looked
  // like the feature never worked rather than like a lookup was missed.
  const builtIn = catalog.personas.get(BUILT_IN_ID) ?? DEFAULT_PERSONA
  if (activeId === null || activeId === BUILT_IN_ID) {
    return { persona: builtIn, problem: null }
  }
  const found = catalog.personas.get(activeId)
  return found === undefined
    ? { persona: builtIn, problem: { kind: 'active-missing', id: activeId } }
    : { persona: found, problem: null }
}

export interface Written {
  /** Who was written. Always the id that came in -- saving never renames. */
  readonly id: string
  readonly source: string
}

/**
 * Write a persona back where she came from. NEVER creates one.
 *
 * This used to fork the built-in, because her manifest is a constant and there
 * was nowhere to put an edit to her. That made a swatch or a keystroke into a
 * copy nobody asked for: the shelf grew a second entry under the same name,
 * and the picker could not get back to the first. She now keeps her changes in
 * an overlay beside the packages (see `EDITS`), so every persona is edited in
 * place and copying is something a person does on purpose -- `copyPersonaTo`
 * below, behind the button that says so.
 *
 * An id is immutable while editing precisely because it keys memory: changing
 * it is not an edit, it is a new persona plus an orphaned history.
 */
export function savePersonaTo(
  userData: string,
  catalog: PersonaCatalog,
  persona: Persona,
): Written {
  if (persona.id === BUILT_IN_ID) {
    // Her overlay, not a manifest. `sources` still has no entry for her, which
    // is what the rest of this module reads as "not a file you may write over".
    writeEdits(userData, persona)
    return { id: BUILT_IN_ID, source: join(BUILT_IN_ID, EDITS) }
  }
  const id = persona.id
  const root = personasRoot(userData)

  // An id nobody holds is REFUSED, not created.
  //
  // The branch that used to be here created a package, which contradicts this
  // function's own first line -- and it was unreachable through the settings
  // window, whose only caller submits the persona currently in the catalog.
  // Creation belongs to `copyPersonaTo`, behind the button that says so; a
  // second creation path is a second set of collision rules to keep in step.
  if (!catalog.sources.has(id)) {
    throw new Error(`${id} is not a persona this catalog holds; use copyPersonaTo to create one`)
  }
  // Written back to the file it came from, having checked that file is still
  // HERS. Checking only that the NAME still exists leaves the case that
  // matters: a folder renamed and a different package moved into its place, at
  // which point this overwrites the replacement's manifest. Deletion already
  // asked the stronger question; saving asked the weaker one.
  const known = verifiedSource(userData, catalog, id)
  // A package may carry a face or NAME one, never both -- the loader refuses
  // the pair. Only this function can see both halves at once, so without the
  // check a save that set `avatarId` on a package holding `face.json` wrote a
  // manifest the next launch rejects: the persona vanishes from the shelf, and
  // the action that did it looked like it succeeded.
  if (persona.avatarId !== null && hasOwnFace(join(root, known))) {
    throw new Error(`${known} already carries its own face; it cannot also name one`)
  }
  savePersonaManifest(join(root, known), persona, id)
  return { id, source: known }
}

/**
 * Copy a persona into a new one of her own. The ONLY thing that creates an id.
 *
 * Split from `savePersonaTo` because they are different intents that used to
 * share a function: one preserves who somebody is, the other makes somebody
 * new. Folded together, "am I editing or duplicating" was decided by whether
 * the id happened to be the built-in's -- so the answer changed depending on
 * which persona was worn, and the user was never asked.
 *
 * The new id is derived from the new NAME and returned rather than assumed:
 * a copy whose id nobody learns is an action with no visible result.
 *
 * ## It copies the PACKAGE, not the manifest
 *
 * With no registry and no install-by-URL, this is the only way to
 * author a persona inside the app: wear one, copy her, edit the copy. So a
 * copy that took only `persona.json` produced something broken and silent --
 * a persona whose prompt refers to a file that did not come with her, handed
 * nothing and saying nothing. Nothing errored; she simply did not work. A
 * package still carries a face, and whatever a later feature adds.
 *
 * What is NOT copied is anything filed outside the package under her id --
 * her notes, her conversations, her retention. Those come of USING her rather
 * than of the package, so a copy starts clean, which is both what somebody
 * duplicating a persona wants and what somebody receiving one must get.
 */
export function copyPersonaTo(
  userData: string,
  catalog: PersonaCatalog,
  persona: Persona,
  name: string,
): Written {
  // Ids with a pending deletion count as taken. See `PersonaCatalog.reserved`.
  const id = deriveId(name, new Set([...catalog.personas.keys(), ...catalog.reserved]))
  const root = personasRoot(userData)
  // The destination taken EXCLUSIVELY, before anything is built. `entryExists`
  // then `renameSync` was a check-then-act pair whose second half silently
  // replaces an empty destination anyway -- see `createPackage`.
  createPackage(root, id)
  // Staged under a temporary name and moved into place at the end.
  //
  // The copy used to build the destination in place: `cpSync`, then the
  // manifest rewritten over it. Between those two the folder holds the
  // ORIGINAL's manifest under a NEW folder name -- so a failure there (full
  // disk, permissions, the process ending) leaves a package claiming an id
  // that already exists, and the next load rejects BOTH as duplicates. Copying
  // her would have deleted her.
  //
  // `rename` within one directory is atomic on every filesystem this ships to,
  // so the destination either does not exist or is complete.
  const staging = join(root, `.staging-${id}`)
  rmSync(staging, { recursive: true, force: true })
  try {
    // VERIFIED, not merely cached. Copying trusted `sources` alone, so a folder
    // renamed and replaced since the last load produced a hybrid: another
    // persona's face and word list under this persona's manifest. Save and
    // delete both ask this question; copy did not.
    const from = catalog.sources.has(persona.id)
      ? verifiedSource(userData, catalog, persona.id)
      : undefined
    if (from !== undefined) {
      // Everything beside the manifest -- the word list, her face, whatever a
      // later capability adds. Copied by taking the FOLDER rather than by
      // listing the files this build happens to know about, so a capability
      // added tomorrow is carried without anybody remembering this line.
      cpSync(join(root, from), staging, { recursive: true })
      // Except the overlay, which is the built-in's user edits and belongs to
      // this install rather than to any package.
      rmSync(join(staging, EDITS), { force: true })
    } else {
      mkdirSync(staging, { recursive: true })
    }
    savePersonaManifest(staging, persona, id, name)
    // Onto the reservation this call made, which `rename` may replace because
    // it is an empty directory and it is ours.
    renameSync(staging, join(root, id))
  } catch (error: unknown) {
    // The half-built copy goes with the failure, and so does the reservation.
    // Left behind, either would be a directory the catalog cannot read and the
    // next copy cannot take.
    rmSync(staging, { recursive: true, force: true })
    /*
      The reservation removed NON-RECURSIVELY, which is the whole guarantee.

      `createPackage` takes the destination with a bare `mkdirSync` — no
      `recursive` — precisely because that either creates the directory or
      fails, in one step, with nothing in between to race. The teardown has to
      be its mirror image and was not: a recursive force-remove deletes whatever
      is at that path, and what is at that path is only OURS if nobody has
      touched it since. A sync client restoring a backup, a second instance, or
      somebody with a file manager can put a real package there while the copy
      is being built, and this line would have taken it.

      `rmdir` refuses a directory with anything in it. Our reservation is empty
      by construction, so the honest teardown succeeds exactly when the thing
      being removed is still the empty folder we made, and fails with `ENOTEMPTY`
      when it is somebody's data. Both outcomes are right, which is why the
      failure is only logged: the original error is what the caller needs, and a
      throw from cleanup would replace it.
    */
    try {
      rmdirSync(join(root, id))
    } catch (cleanup: unknown) {
      const code = (cleanup as NodeJS.ErrnoException).code
      // Gone already is fine. Anything else means the reservation is not what
      // we left there, and it stays.
      if (code !== 'ENOENT') {
        console.warn(`[persona] left ${id} in place after a failed copy (${code ?? 'unknown'})`)
      }
    }
    throw error
  }
  /*
    A NEW character starts at the defaults, not at somebody else's answer.

    `readGrants` falls back to the one pre-upgrade global setting when a
    character has no file, which is what stops an unfinished migration granting
    everything. Left unseeded, a character created today would inherit that
    fallback — a permission decision made about a different character, before
    per-character permissions existed. Writing her own file is what makes the
    fallback mean only "from before the upgrade".
  */
  seedGrants(userData, id)
  return { id, source: id }
}

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

/** Does this package carry its own face? */
export function hasOwnFace(packageFolder: string): boolean {
  // EXISTENCE, not readability. `readBounded` says `!ok` for absent and for
  // oversized, symlinked or permission-denied alike, so a `face.json` that is
  // there and unreadable read as "no face" -- and the two-face rule, which is
  // the thing stopping a package from both carrying a face and naming one,
  // was decided on whether this process happened to be able to open it.
  //
  // The same mistake `hasPolicy` had. Two of them makes it a class: when a
  // question is "is there a file", `absent` is the only answer that means no.
  const read = readBounded(join(packageFolder, PACKAGE_FACE))
  return read.ok || read.reason.kind !== 'absent'
}
