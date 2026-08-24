/**
 * The built-in character's overrides, which are not a package.
 *
 * She ships in the binary and has no folder to write a manifest into, so what
 * a person changes about her is stored as a sparse diff against
 * `DEFAULT_PERSONA` instead. `her-edits.test.ts` was already named for this
 * and had to reach into `store/personas` to find it.
 */
import { writeJsonAtomically } from './json-file'
import { personasRoot } from './persona-files'
import { readBounded } from './read-bounded'
import { BUILT_IN_ID, parsePersona } from '@shared/parse-persona'
import { DEFAULT_PERSONA, type Persona } from '@shared/persona'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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
 * Compared by serialisation because several of these fields are objects --
 * `theme` may be `{ hue }`, and `greeting` and `farewell` are moments -- and a
 * reference comparison would record every field as edited on the first save,
 * which is exactly the freeze this format exists to avoid, arrived at without
 * anybody choosing it.
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
