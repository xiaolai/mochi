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

import { cpSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUILT_IN_ID,
  DEFAULT_PERSONA,
  PERSONA_FORMAT,
  deriveId,
  parsePersona,
  type Persona,
  type PersonaLoadProblem,
} from '@shared/persona'
import { writeJsonAtomically } from './json-file'
import { PACKAGE_FACE } from './avatars'
import { readBounded } from './read-bounded'
import type { Transcripts } from './transcripts'
import { forgetMemory } from './memory'
import { forgetCapabilityState } from './capability-state'
import {
  forgetPolicy,
  hasPolicy,
  markRetentionMigrated,
  readPolicy,
  retentionMigrated,
  writePolicy,
} from './policy'
import { UNREADABLE_POLICY, parsePolicy, type Policy } from '@shared/policy'

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

/** The legacy single-persona file, read once by the migration and then retired. */
export const LEGACY_FILE = 'persona.json'

/**
 * Her retention, parked in her own package until the policy store accepts it.
 *
 * The durable half of the carry. `carriedPolicies` holds a failed migration in
 * memory and is retried on every read, which heals the moment the disk allows
 * -- but only within one run. If it never allows before the app quits, the
 * choice is gone, and the fallback for a missing policy file is to KEEP. A user
 * who turned transcripts off starts recording.
 *
 * IN HER PACKAGE, and that placement is the whole design:
 *
 * - It is writable. The manifest is already sitting there, so the directory
 *   accepted a write moments ago -- unlike the policy store, which is the thing
 *   that just refused one.
 * - It is HERS. Deleting her removes the folder and this with it, so a record
 *   kept for her cannot outlive her and re-import her. Keeping the legacy
 *   `persona.json` instead did exactly that: the package was deleted, the
 *   source was not, and the next launch brought her back. A persona the user
 *   cannot delete is a worse bug than the one being fixed.
 */
const PENDING_POLICY = 'pending-policy.json'

function pendingPolicyPath(userData: string, source: string): string {
  return join(personasRoot(userData), source, PENDING_POLICY)
}

/**
 * Try to promote a parked retention into the real store.
 *
 * Returns what is still outstanding, or null when there is nothing to do or it
 * finally landed. Called for EVERY admitted persona on every launch, not only
 * while the one-time migration is owed -- the marker records that the pass ran,
 * which is a different question from whether its writes succeeded.
 */
function settlePendingPolicy(userData: string, id: string, source: string): Policy | null {
  const pending = readBounded(pendingPolicyPath(userData, source))
  // Absent is the ordinary case, on every persona, on every launch.
  if (!pending.ok) return pending.reason.kind === 'absent' ? null : UNREADABLE_POLICY
  let parsed: unknown
  try {
    parsed = JSON.parse(pending.text)
  } catch {
    // A record EXISTS and cannot be read. `policy.ts` already has the answer
    // for that shape: a choice that exists and is unreadable is honoured as
    // "do not keep", because the alternative is recording somebody who may
    // have asked not to be. Treating it as absence would fall back to keeping.
    return UNREADABLE_POLICY
  }
  const record = parsed as Record<string, unknown>
  const policy = parsePolicy(record)
  if (policy === null) return UNREADABLE_POLICY
  // WHOSE choice this is, checked rather than assumed.
  //
  // The record is filed by FOLDER and applied by ID, and those are deliberately
  // not the same thing (see `sources`). Without this, a record copied into
  // another package -- by hand, by a sync tool, by a backup restored over the
  // top -- is settled under whatever id that package's manifest claims, which
  // hands one persona's retention to another. A package shipped with one is
  // also how a hand-installed persona could declare retention, which the
  // migration gate exists to forbid.
  if (record['id'] !== id) return null
  if (hasPolicy(userData, id)) {
    // Somebody set it since. Their choice wins over a stale parked one, and the
    // record has no further use.
    discardPendingPolicy(userData, source)
    return null
  }
  try {
    writePolicy(userData, id, policy)
    discardPendingPolicy(userData, source)
    return null
  } catch {
    return policy
  }
}

function discardPendingPolicy(userData: string, source: string): void {
  try {
    unlinkSync(pendingPolicyPath(userData, source))
  } catch {
    // Already gone, or unremovable. Harmless either way: `settlePendingPolicy`
    // checks `hasPolicy` first, so a leftover cannot overwrite a real choice.
  }
}

/**
 * Move a manifest's retention setting to its own file, once.
 *
 * Returns the value the caller must hold in memory instead, or null when
 * nothing needs carrying. Only for a persona who has NO setting of her own:
 * re-seeding over an existing one would undo a choice made since, and
 * `hasPolicy` answers "exists" for a file it cannot read precisely so an
 * unreadable choice is not mistaken for an absent one.
 */
function migratePolicy(
  userData: string,
  id: string,
  source: string,
  legacy: Policy | null,
): Policy | null {
  if (legacy === null || hasPolicy(userData, id)) return null
  try {
    writePolicy(userData, id, legacy)
    return null
  } catch (error: unknown) {
    // Not fatal -- refusing to load her because a migration could not write
    // would hide a character over a disk error. But not forgotten either: the
    // fallback for a missing policy file is "keep", so dropping this would
    // turn a stored opt-out into recording. The caller holds it for this run,
    // and the record below holds it for the next one.
    console.warn(`[personas] could not carry ${id}'s retention across:`, error)
    try {
      // Stamped with WHOSE it is. The record lives under a folder name and is
      // applied under an id, and settlement refuses to bridge the two on trust.
      writeJsonAtomically(pendingPolicyPath(userData, source), { id, ...legacy })
    } catch {
      // Her package is unwritable too, so there is nowhere durable left. The
      // in-memory copy is all there is, and it lasts until quit.
      console.warn(`[personas] and could not park it in ${source} either`)
    }
    return legacy
  }
}

/** Which id a manifest on disk claims, without validating the rest of it. */
function claimedId(text: string): string | null {
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
  return join(userData, PERSONAS_DIR)
}

export interface PersonaCatalog {
  /** Every persona that loaded, by id. Never empty -- the built-in is always here. */
  readonly personas: ReadonlyMap<string, Persona>
  /** Where each stored persona came from. No entry for the built-in. */
  readonly sources: ReadonlyMap<string, string>
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
  readonly carriedPolicies: ReadonlyMap<string, Policy>
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
  readonly legacy: Policy | null
}

/**
 * Where the built-in's edits live.
 *
 * She is the one persona whose manifest is COMPILED IN, so there is no
 * `persona.json` for her to own and none is ever written -- a folder claiming
 * her id is still refused by the loader below, which is what stops a
 * downloaded package from quietly becoming her.
 *
 * Her folder therefore holds only this: the fields somebody changed.
 */
export const EDITS = 'edits.json'

/**
 * The user's changes to the built-in, as a DIFF rather than a whole persona.
 *
 * This is the field-level reason for the format, and it is worth stating
 * because a stored full manifest would have been simpler to write: her
 * constant ships with the app, so a release that improves her prompt should
 * reach everybody who has not personally rewritten that prompt. A full
 * manifest freezes her at whichever version was open the first time somebody
 * renamed her, and the improvement lands for new installs only.
 *
 * It is also the shape already settled for packages -- edits beside
 * the manifest, merged at load -- so this is one mechanism rather than a
 * second one invented for her.
 */
export type PersonaEdits = Partial<Omit<Persona, 'id' | 'version'>>

/** The fields an overlay may carry. `id` and `version` are not among them. */
const EDITABLE = (Object.keys(DEFAULT_PERSONA) as (keyof Persona)[]).filter(
  (key) => key !== 'id' && key !== 'version',
)

/**
 * What somebody changed, and only that.
 *
 * Compared by serialisation because three of these fields are arrays or
 * objects (`theme` may be `{ hue }`, `expressions` and `motions` are lists),
 * and a reference comparison would record every field as edited on the first
 * save -- which is exactly the freeze this format exists to avoid, arrived at
 * without anybody choosing it.
 */
export function editsFrom(persona: Persona): PersonaEdits {
  const edits: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    const mine = persona[key]
    if (JSON.stringify(mine) !== JSON.stringify(DEFAULT_PERSONA[key])) edits[key] = mine
  }
  return edits
}

/**
 * The built-in as this install has her: her constant, under whatever edits.
 *
 * Her id and format version are taken from the constant unconditionally, not
 * merged. An overlay that could set the id would be a way to make her someone
 * else -- and her id is what keys her memory and her transcripts.
 */
export function builtInPersona(edits: PersonaEdits): Persona {
  return { ...DEFAULT_PERSONA, ...edits, id: BUILT_IN_ID, version: DEFAULT_PERSONA.version }
}

/**
 * Read her overlay, or return no edits.
 *
 * Every failure here lands on the same answer -- the original mochi -- and
 * says why. Refusing to start because an overlay is malformed would mean a
 * hand-edited file could stop the app; adopting half of one would mean she
 * came back partly renamed. The merged result is what gets validated, because
 * a fragment cannot be judged on its own: an overlay carrying only a greeting
 * is perfectly valid and a whole persona made of one is not.
 */
export function readEdits(userData: string): { edits: PersonaEdits; problem: string | null } {
  const none = { edits: {}, problem: null }
  const read = readBounded(join(personasRoot(userData), BUILT_IN_ID, EDITS))
  if (!read.ok) {
    return read.reason.kind === 'absent' ? none : { edits: {}, problem: 'could not be read' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(read.text)
  } catch {
    return { edits: {}, problem: 'is not valid JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { edits: {}, problem: 'is valid JSON but not an object' }
  }
  // Unknown keys are dropped rather than refused. An overlay written by a
  // LATER build is the ordinary consequence of moving between versions, and
  // refusing the whole file would undo every edit somebody made in the newer
  // one. A manifest is refused for the opposite reason -- see `parsePersona`.
  const record = parsed as Record<string, unknown>
  const edits: Record<string, unknown> = {}
  for (const key of EDITABLE) if (key in record) edits[key] = record[key]

  const result = parsePersona(builtInPersona(edits))
  return result.ok
    ? { edits, problem: null }
    : { edits: {}, problem: result.problems.map((p) => p.kind).join(', ') }
}

/** Write her overlay, or remove it when nothing differs from the original. */
export function writeEdits(userData: string, persona: Persona): void {
  const folder = join(personasRoot(userData), BUILT_IN_ID)
  const edits = editsFrom(persona)
  if (Object.keys(edits).length === 0) {
    // REMOVED, not written as `{}`. "She is the original" and "somebody edited
    // her back to the original" are the same state, and keeping an empty file
    // around would make the reset below look like it had failed.
    rmSync(join(folder, EDITS), { force: true })
    return
  }
  mkdirSync(folder, { recursive: true })
  writeJsonAtomically(join(folder, EDITS), edits)
}

/**
 * Put the built-in back to the persona she ships as.
 *
 * The counterpart to editing her in place. Without it, editing her would be
 * the one-way door that forking her used to be: her original prompt is in the
 * source, not in the window, so "undo" would mean retyping it from somewhere
 * the user cannot see.
 */
export function restoreBuiltIn(userData: string): void {
  rmSync(join(personasRoot(userData), BUILT_IN_ID, EDITS), { force: true })
}

/**
 * Read the folder. Never throws, never returns an empty catalog.
 *
 * Every file is examined even after failures: stopping early leaves a broken
 * persona permanently silent, and the person it fails is the one who wrote the
 * broken file.
 */
export function loadPersonas(
  userData: string,
  edits: PersonaEdits,
  /**
   * Whether this installation has run before.
   *
   * Decides whether the one-time retention migration may run at all. On a
   * machine where the app has never started there is nothing of the user's to
   * carry across -- so a manifest claiming to predate the move can only have
   * been placed there from outside, and migrating it would let a package
   * choose somebody's retention on their first launch. `keepDays: 1` is a
   * package quietly binning the user's history of itself after a day.
   *
   * Defaults to true so a caller that does not know behaves as before; main
   * knows, because the preferences file either existed or it did not.
   */
  ranBefore = true,
): PersonaCatalog {
  const root = personasRoot(userData)
  const problems: PersonaLoadProblem[] = []
  // The built-in, as this install has her. Her edits are applied HERE so the
  // catalog is the single answer to "what is this persona", the built-in
  // included. Applying them further downstream would leave
  // `catalog.personas.get(BUILT_IN_ID)` describing a mochi nobody is wearing.
  const personas = new Map<string, Persona>([[BUILT_IN_ID, builtInPersona(edits)]])
  const sources = new Map<string, string>()
  // Retention carried out of an old manifest that could not be written to its
  // own file. Empty in the ordinary case -- see `PersonaCatalog`.
  const carriedPolicies = new Map<string, Policy>()
  // Asked ONCE, before anything is read, so every persona in this pass gets
  // the same answer and the marker is written after all of them.
  const settled = retentionMigrated(userData)
  // May anything be carried across? Only on an installation that has run
  // before -- a first launch has nothing of the user's to carry FROM.
  const migrating = ranBefore && !settled
  // Is the one-time pass finished after this load? On a first launch it is
  // finished by there being nothing to do, and saying so is the point: the
  // package installed a minute later must not be able to claim it predates a
  // move this machine never lived through.
  const closing = !settled

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
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems.push({ kind: 'folder-unreadable' })
    }
    // Marked even here. A machine with no personas folder has nothing to
    // migrate, and returning without saying so left the one-time pass owed
    // for ever -- so the first package installed afterwards could claim to
    // predate the move and seed a retention policy, which is exactly what the
    // marker exists to prevent.
    if (closing) markRetentionMigrated(userData)
    return { personas, sources, problems, carriedPolicies }
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

  const byId = new Map<string, Candidate[]>()
  for (const source of files) {
    const read = readBounded(join(root, source, MANIFEST))
    if (!read.ok) {
      // `absent` is a race -- the file was listed and then removed -- and is
      // as unremarkable as never having existed.
      if (read.reason.kind !== 'absent') {
        problems.push({ kind: 'unreadable', source })
      }
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(read.text)
    } catch {
      problems.push({ kind: 'malformed', source })
      continue
    }
    const result = parsePersona(parsed)
    if (!result.ok) {
      problems.push({ kind: 'invalid', source, problems: result.problems })
      continue
    }
    // The reserved id is refused HERE rather than in `parsePersona`, which
    // validates the built-in herself and would refuse her own id.
    if (result.persona.id === BUILT_IN_ID) {
      problems.push({ kind: 'reserved-id', id: BUILT_IN_ID, source })
      continue
    }
    // A package cannot both carry a face and name one. Only the loader can
    // see both, which is why this is checked here rather than in the parser.
    if (result.persona.avatarId !== null && hasOwnFace(join(root, source))) {
      problems.push({ kind: 'two-faces', source })
      continue
    }
    const group = byId.get(result.persona.id)
    const candidate = { source, persona: result.persona, legacy: result.legacy }
    if (group === undefined) byId.set(result.persona.id, [candidate])
    else group.push(candidate)
  }

  for (const [id, group] of byId) {
    const first = group[0]
    if (group.length > 1 || first === undefined) {
      // The WHOLE group goes. Picking one would make the choice depend on
      // filesystem order, and the loser's memory would silently attach to the
      // winner -- the two share an id, which is the key memory is filed under.
      problems.push({ kind: 'duplicate-id', id, sources: group.map((c) => c.source) })
      continue
    }
    personas.set(id, first.persona)
    sources.set(id, first.source)
    // Migrated only for a persona that was ADMITTED, and after every reason to
    // refuse her has been checked. Seeding at parse time wrote a policy file
    // for packages that never entered the catalog -- a reserved id, a
    // two-faced package, one of a refused duplicate pair -- leaving a setting
    // filed under an id its owner does not hold, waiting for whoever gets it.
    // Only while the one-time pass is still owed. After it, a manifest
    // claiming to predate the move seeds nothing -- see `retentionMigrated`.
    if (migrating) {
      const carried = migratePolicy(userData, id, first.source, first.legacy)
      if (carried !== null) carriedPolicies.set(id, carried)
    }
    // UNCONDITIONALLY, and deliberately not in an `else`.
    //
    // `markRetentionMigrated` records that the pass RAN, which is a different
    // question from whether its writes succeeded — a carry that failed used to
    // live only in `carriedPolicies` while the marker was written anyway, so
    // the next launch skipped the migration and the opt-out reverted to the
    // default, which is to keep.
    //
    // Gating this on `!migrating` looked equivalent and was not: the marker
    // lives in the policy directory, so the write that failed is the same write
    // that records the pass as done. `migrating` therefore stays TRUE on the
    // relaunch — exactly the case a parked record exists for — and an `else`
    // skipped it. Running always is also cheap: it is one stat on a file that
    // is normally absent, and a no-op once the policy exists.
    const still = settlePendingPolicy(userData, id, first.source)
    if (still !== null) carriedPolicies.set(id, still)
  }
  if (closing) markRetentionMigrated(userData)

  return { personas, sources, problems, carriedPolicies }
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
  const known = catalog.sources.get(id)

  if (known === undefined) {
    // A NEW persona. Its filename is derived from its id once, here, and never
    // again -- from this point the `sources` map is authoritative, which is
    // what lets somebody rename the file without changing who she is.
    const source = id
    // NO-CLOBBER, and case-insensitively so.
    //
    // Being absent from the catalog does not mean the file is absent from the
    // folder: a persona rejected as malformed, or as a duplicate, is not in
    // the map and its file is still sitting there. Writing over it would
    // destroy somebody's only copy of a character in the course of creating a
    // different one -- and on macOS, `ADA.JSON` and `ada.json` are the same
    // file, so the comparison has to fold case even though ids never do.
    if (entryExists(root, source)) {
      throw new Error(`refusing to overwrite ${source}, which is already in the personas folder`)
    }
    // Stamped with the CURRENT format, not whatever version she was loaded
    // under. A v1 manifest rewritten by this build no longer holds `keeps` --
    // so leaving it labelled v1 would tell an older build it is safe to read,
    // and that build would fill `keeps: true` over an opt-out it cannot see.
    writeJsonAtomically(join(root, source, MANIFEST), {
      ...persona,
      id,
      version: PERSONA_FORMAT,
    })
    return { id, source }
  }

  // An EXISTING persona, written back to the file it came from. If that file
  // has gone -- renamed by hand while the app was running -- the map is stale
  // and recreating the old path would leave two files claiming one id, which
  // the next launch refuses as a duplicate and neither loads. Refusing here
  // costs a restart; the alternative costs the persona.
  if (!entryExists(root, known)) {
    throw new Error(`${known} is no longer there; reopen mochi before editing this persona`)
  }
  // A package may carry a face or NAME one, never both -- the loader refuses
  // the pair. Only this function can see both halves at once, so without the
  // check a save that set `avatarId` on a package holding `face.json` wrote a
  // manifest the next launch rejects: the persona vanishes from the shelf, and
  // the action that did it looked like it succeeded.
  if (persona.avatarId !== null && hasOwnFace(join(root, known))) {
    throw new Error(`${known} already carries its own face; it cannot also name one`)
  }
  writeJsonAtomically(join(root, known, MANIFEST), { ...persona, id, version: PERSONA_FORMAT })
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
 * a drill whose prompt says she is a drill, with no list to walk, handed
 * nothing and saying nothing. Nothing errored; she simply did not work.
 *
 * What is NOT copied is her PLACE in it. Progress lives outside the package,
 * so the copy starts at the beginning, which is what somebody duplicating a
 * drill wants and what somebody receiving one must get.
 */
export function copyPersonaTo(
  userData: string,
  catalog: PersonaCatalog,
  persona: Persona,
  name: string,
): Written {
  const id = deriveId(name, new Set(catalog.personas.keys()))
  const root = personasRoot(userData)
  // Same no-clobber rule as a first save, and for the same reason: absent from
  // the catalog does not mean absent from the folder.
  if (entryExists(root, id)) {
    throw new Error(`refusing to overwrite ${id}, which is already in the personas folder`)
  }
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
    const from = catalog.sources.get(persona.id)
    if (from !== undefined) {
      // Everything beside the manifest -- the word list, her face, whatever a
      // later capability adds. Copied by taking the FOLDER rather than by
      // listing the files this build happens to know about, so a capability
      // added tomorrow is carried without anybody remembering this line.
      cpSync(join(root, from), staging, { recursive: true })
      // Except the overlay, which is the built-in's user edits and belongs to
      // this install rather than to any package.
      rmSync(join(staging, EDITS), { force: true })
      // And except a parked retention, which belongs to the persona it was
      // carried for. It is filed by folder, so copying it would hand the new
      // persona a stranger's opt-out the first time her package is scanned --
      // and `settlePendingPolicy` would then write it under HER id, which is
      // the identity mistake the whole `sources` mapping exists to prevent.
      rmSync(join(staging, PENDING_POLICY), { force: true })
    } else {
      mkdirSync(staging, { recursive: true })
    }
    // Stamped, like every other manifest this build writes. A copy that
    // inherited the original's v1 would claim to be readable by a build that
    // still expects `keeps` -- and that build fills its own default over an
    // opt-out it cannot see.
    writeJsonAtomically(join(staging, MANIFEST), {
      ...persona,
      id,
      name,
      version: PERSONA_FORMAT,
    })
    renameSync(staging, join(root, id))
  } catch (error: unknown) {
    // The half-built copy goes with the failure. Left behind it would be a
    // directory the catalog cannot read and the next copy cannot overwrite.
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
  return { id, source: id }
}

/**
 * Is there already a directory entry with this name, ignoring case?
 *
 * `existsSync` would answer for the exact name only, which is the wrong
 * question on a case-insensitive filesystem: macOS's default gives one file
 * two spellings, so `ada.json` would be reported absent while `ADA.JSON` sat
 * in the folder waiting to be overwritten by the write that followed.
 */
function entryExists(root: string, name: string): boolean {
  const wanted = name.toLowerCase()
  try {
    return readdirSync(root).some((entry) => entry.toLowerCase() === wanted)
  } catch (error: unknown) {
    // A missing folder holds nothing. Anything else is a folder we cannot see
    // into, and claiming "nothing is there" about it is how the overwrite this
    // function exists to prevent happens anyway.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

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
  if (entryExists(root, source)) {
    return { kind: 'failed', problem: { kind: 'legacy-blocked', source } }
  }
  writeJsonAtomically(join(root, source, MANIFEST), {
    ...legacyPersona,
    id,
    version: PERSONA_FORMAT,
  })
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
  } catch {
    // No folder is the ordinary state of a machine with no personas.
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
    if (entryExists(root, stem)) {
      // A folder of that name is already there. Merging them is guesswork --
      // which manifest wins? -- so the loose file stays put and is named.
      problems.push({ kind: 'legacy-blocked', source: file })
      continue
    }
    try {
      mkdirSync(join(root, stem), { recursive: true })
      renameSync(join(root, file), join(root, stem, MANIFEST))
    } catch (error: unknown) {
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

/**
 * Remove a persona file that was just written and must not survive.
 *
 * Only ever called on a FORK whose follow-up step failed -- the file did not
 * exist a moment ago, so removing it restores what was there rather than
 * destroying anything. An ordinary edit overwrites a file that is already
 * somebody's, and rolling that back would turn a failed save into data loss;
 * the caller is responsible for telling the two apart.
 */
export function discardWrite(userData: string, source: string): void {
  try {
    // A package is a FOLDER. This was `unlinkSync`, which is from before that
    // was true -- so it threw `EPERM` on every call, got caught by the handler
    // below, and logged. The rollback it exists to perform has never once
    // happened: a fork whose follow-up failed stayed on disk, the save
    // reported failure, and the extra persona was in the list anyway.
    rmSync(join(personasRoot(userData), source), { recursive: true, force: true })
  } catch (error: unknown) {
    // Best effort. An orphan persona is visible in the list and recoverable by
    // hand; failing the rollback loudly here would replace one survivable mess
    // with a crash during error handling.
    console.warn(`[persona] could not remove ${source} after a failed save:`, error)
  }
}

/**
 * Remove a persona and everything filed under her.
 *
 * The MEMORY goes too, and that is not tidiness. Ids are derived from names,
 * so `deriveId` will hand out `ada` again the moment nothing holds it -- and a
 * new persona inheriting a stranger's notes is the privacy failure the whole
 * per-id filing exists to prevent. Leaving the notes behind would make that
 * inevitable rather than unlikely.
 *
 * Everything filed under her goes: the package, the memory, the transcripts.
 * The store is a PARAMETER so that omitting it cannot compile -- the first
 * version of this function forgot the transcripts, which is a defect with no
 * symptom until a recycled id hands somebody else's conversations to a new
 * persona.
 *
 * The built-in has no file and cannot be removed; the caller checks that,
 * because it needs to say so in the user's language rather than throw.
 */
export function deletePersona(
  userData: string,
  catalog: PersonaCatalog,
  id: string,
  history: Pick<Transcripts, 'forget'>,
): void {
  const source = catalog.sources.get(id)
  if (source === undefined) throw new Error(`${id} has no file to remove`)
  // The recorded folder must still BE there. `sources` is a snapshot from the
  // last load, and a folder renamed or replaced by hand since then makes it
  // stale -- so this would erase her notes, conversations, progress and
  // retention, then `rmSync` a path that no longer exists and report success.
  // Worse if something else now occupies that name. `savePersonaTo` refuses a
  // stale source for the same reason; deleting has more to lose than saving.
  // The folder must still be there AND still be hers. Checking only that the
  // name exists leaves the case that matters: a folder renamed and a different
  // package moved into its place, at which point this erases one persona's
  // notes and conversations and then removes another persona's package.
  const standing = readBounded(join(personasRoot(userData), source, MANIFEST))
  const claims = standing.ok ? claimedId(standing.text) : null
  if (claims !== id) {
    throw new Error(`${source} is no longer ${id}; reopen mochi before deleting this persona`)
  }
  // What is filed UNDER her goes first, and the package that reserves her id
  // goes last. The package is what keeps the id taken: remove it first and any
  // failure below leaves the id free with a stranger's notes still filed under
  // it, so the next persona named Ada inherits them -- the precise outcome the
  // three comments below describe guarding against.
  //
  // Ordered this way, a failure before the package is removed leaves her
  // exactly as she was. NOT so once the removal starts: `rmSync` recursive is
  // not transactional, and it can take the manifest and then fail on the
  // folder, leaving a package that no longer loads. That is a smaller wrong
  // than a released id with a stranger's notes under it, and it is a real
  // one -- see the test that arranges it rather than a sentence claiming it
  // cannot happen.
  forgetMemory(userData, id)
  // Her CONVERSATIONS too, and the store is a required argument rather than
  // something the caller might remember. This was missed once already: memory
  // was forgotten and transcripts were not, so deleting `ada` and letting the
  // name come round again -- which it does, because ids are derived from
  // names -- would have handed a stranger's conversations to a new character.
  // A parameter makes that omission a compile error instead of a privacy bug.
  history.forget(id)
  // And whatever a capability stored under her. A THIRD time now: the comment
  // above says this was missed once, and it was missed again the moment the
  // drill added a place for per-persona state. Every new store is another line
  // somebody has to remember here, which is why the comment is not the fix --
  // `forgetCapabilityState` is one call that covers the directory rather than
  // one call per feature.
  forgetCapabilityState(userData, id)
  // Her retention setting goes with the rest of her state, and the write below
  // is what makes that safe in both directions.
  //
  // Deleting it AFTER the package looked safer -- a policy left behind only
  // hands a new Ada an opt-out, which errs toward not writing. But the id is
  // already released by then, so a failure there leaves a stranger's setting
  // filed under a name somebody else now holds, which is the exact class of
  // leak per-id filing exists to prevent.
  //
  // Deleting it before has the opposite failure: an absent policy falls back
  // to `keeps: true`, so a package removal that fails would leave her present,
  // still loaded, and quietly recording again without the opt-out she chose.
  //
  // So it is deleted here and PUT BACK if the package cannot go. Neither
  // ordering is safe on its own; the compensating write is what closes both.
  const hers = hasPolicy(userData, id) ? readPolicy(userData, id) : null
  forgetPolicy(userData, id)
  try {
    // The WHOLE package. Her face lives in there too, and leaving an orphaned
    // folder behind would be read as a persona that failed to load rather than
    // one that was deleted.
    rmSync(join(personasRoot(userData), source), { recursive: true, force: true })
  } catch (error: unknown) {
    // She survives this failure, so her choice has to survive it too.
    if (hers !== null) {
      try {
        writePolicy(userData, id, hers)
      } catch (second: unknown) {
        // Loud, and not swallowed into the original: she is now present with
        // no stored setting, which means she will keep. That is worth saying
        // even though the delete is failing for another reason entirely.
        console.error(`[personas] ${id} survived deletion without her retention setting:`, second)
      }
    }
    throw error
  }
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
