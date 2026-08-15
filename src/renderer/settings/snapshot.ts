/**
 * Does this snapshot match what the panes expect?
 *
 * Its own module for the same reason as `redraw.ts`: `settings/main.ts` cannot
 * be imported by a test — it touches `document` and the bridge at load — and
 * this is the gate that keeps main and this window agreeing on one shape. A
 * gate nothing can exercise is a gate nobody knows the state of.
 */

import { parseFaceSpec } from '@shared/avatar-spec'
import { isCredentialSource } from '@shared/auth'
import { isLocaleTag } from '@shared/i18n'
import { logSaveProblem, type SettingsSnapshot } from '@shared/ipc'
import { parsePersona } from '@shared/persona'
import { SHORTCUT_IDS } from '@shared/shortcuts'

/**
 * Whether a snapshot can actually be rendered — checked with the SHARED
 * parsers, not with a shape test.
 *
 * The old version asked whether `persona` and `face` were objects and `locale`
 * was a string, which is true of `{}`, of a face with no colours, and of the
 * locale `"klingon"`. Every one of those reaches `render`, and the failures are
 * spread out: a missing `colBody` throws inside `accentVariables`, an unknown
 * locale throws in `messagesFor`, a persona without a `greeting` throws while
 * building the form — each landing in `boot`'s catch as "could not render the
 * settings form", naming nothing.
 *
 * `parsePersona` and `parseFaceSpec` already exist, already report every
 * problem by name, and are what MAIN validates with. Using them here means the
 * two ends of the channel agree on what a settings snapshot is, rather than the
 * renderer holding a laxer second opinion.
 */
export type SnapshotRead =
  | { readonly ok: true; readonly snapshot: SettingsSnapshot }
  | { readonly ok: false; readonly problems: readonly string[] }

/**
 * Check it, and hand back the NORMALISED value.
 *
 * `unusable` returned only the problems and threw away everything the parsers
 * had worked out -- so `boot` went on to render `value as SettingsSnapshot`,
 * the original object. `parsePersona` accepts a persona with no `theme` and
 * fills in the default; the raw object still has no theme, and the pane then
 * read `undefined` from a field the type promised was a `ThemeId`. The
 * validation passing was exactly what made that reachable.
 */
export function readSnapshot(value: unknown): SnapshotRead {
  const problems = unusable(value)
  if (problems.length > 0) return { ok: false, problems }
  const record = value as SettingsSnapshot
  const persona = parsePersona(record.persona)
  const face = parseFaceSpec(record.face)
  // Both are `ok` -- `unusable` just said so -- and this is where their
  // normalised output is kept rather than discarded.
  return {
    ok: true,
    snapshot: {
      ...record,
      ...(persona.ok ? { persona: persona.persona } : {}),
      ...(face.ok ? { face: face.face } : {}),
    },
  }
}

function unusable(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) return ['the snapshot is not an object']
  const record = value as Partial<SettingsSnapshot>
  const problems: string[] = []

  const persona = parsePersona(record.persona)
  if (!persona.ok) {
    problems.push(...persona.problems.map((problem) => `persona: ${logSaveProblem(problem)}`))
  }

  const face = parseFaceSpec(record.face)
  if (!face.ok) problems.push(...face.problems.map((problem) => `face: ${problem}`))

  if (!isLocaleTag(record.locale))
    problems.push(`locale "${String(record.locale)}" is not one we have`)

  // Clamped rather than rejected, matching main: one number with an obvious
  // nearest valid answer. Only a value that is not a number at all is a
  // problem, because that is a snapshot built wrongly rather than edited badly.
  if (typeof record.sizePercent !== 'number' || !Number.isFinite(record.sizePercent)) {
    problems.push('sizePercent is not a number')
  }
  // Every field the panes actually READ, not just the four that were checked.
  //
  // `auth`, `keys`, `about` and the locale entries went unvalidated, so a
  // malformed snapshot passed this gate and failed later inside a pane
  // builder -- as a TypeError on `undefined.accelerator` in a detached
  // render, which surfaces as a blank window with a console message. The whole
  // point of this function is that main and this window agree on the shape
  // BEFORE anything is drawn from it.
  problems.push(...missingText(record.about, 'about', ['name', 'repository', 'author', 'homepage']))

  const auth = asRecord(record.auth)
  if (auth === null) problems.push('auth is not an object')
  else {
    if (!isCredentialSource(auth['source'])) problems.push('auth.source is not a known source')
    if (typeof auth['keySet'] !== 'boolean') problems.push('auth.keySet is not a boolean')
    if (typeof auth['keyHint'] !== 'string') problems.push('auth.keyHint is not text')
    if (typeof auth['canStoreKey'] !== 'boolean') {
      problems.push('auth.canStoreKey is not a boolean')
    }
  }

  const keys = asRecord(record.keys)
  if (keys === null) problems.push('keys is not an object')
  else {
    for (const id of SHORTCUT_IDS) {
      const entry = asRecord(keys[id])
      if (entry === null) {
        problems.push(`keys.${id} is missing`)
        continue
      }
      problems.push(...missingText(entry, `keys.${id}`, ['accelerator', 'shown']))
      if (typeof entry['unavailable'] !== 'boolean')
        problems.push(`keys.${id}.unavailable is not a boolean`)
    }
  }

  if (!Array.isArray(record.locales)) problems.push('locales is not a list')
  else {
    for (const [index, entry] of record.locales.entries()) {
      const one = asRecord(entry)
      if (one === null || !isLocaleTag(one['tag']) || typeof one['nativeName'] !== 'string') {
        problems.push(`locales[${String(index)}] is not a locale`)
      }
    }
  }
  if (typeof record.version !== 'string') problems.push('version is not text')

  // The two the catalog added. Unvalidated, they were exactly the hole this
  // module exists to close: `paint` reads `personaProblems.length` directly,
  // so a snapshot without it throws inside a render and lands in `boot`'s
  // catch as "could not render the settings form", naming nothing. Main always
  // sends both today -- and "main always sends it" is the assumption this
  // gate refuses to make, because it is the one that stops being true.
  if (!Array.isArray(record.personas)) problems.push('personas is not a list')
  else {
    for (const [index, entry] of record.personas.entries()) {
      const one = asRecord(entry)
      if (one === null || typeof one['id'] !== 'string' || typeof one['name'] !== 'string') {
        problems.push(`personas[${String(index)}] is not an id and a name`)
      }
    }
  }
  if (!Array.isArray(record.personaProblems)) problems.push('personaProblems is not a list')

  return problems
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Which of these fields are not text, named so the log points at one thing. */
function missingText(value: unknown, where: string, fields: readonly string[]): readonly string[] {
  const record = asRecord(value)
  if (record === null) return [`${where} is not an object`]
  return fields
    .filter((field) => typeof record[field] !== 'string')
    .map((field) => `${where}.${field} is not text`)
}
