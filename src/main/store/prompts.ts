import { join } from 'node:path'
import { missingFrom, type PromptSpec } from '@shared/prompts'
import { logBoundedRead, readBounded } from './read-bounded'
import { writeJsonAtomically } from './json-file'

/**
 * The prompts you have overridden, and the resolver everything reads through.
 *
 * ## One file of differences, not a copy of the catalogue
 *
 * Only what somebody changed is stored. A file holding every prompt would go
 * stale the moment a default improved: the app would keep sending last
 * release's wording for entries nobody had ever edited, with nothing saying so.
 * That is the failure `store/prompt.ts` describes for the system prompt --
 * *"editing it pins your text forever and every later improvement the app makes
 * is masked with nothing saying so"* -- and it is avoided the same way, by
 * defaulting to absent rather than to a snapshot.
 *
 * So a key that is not in this file means "whatever the app ships today", and
 * resetting one deletes it rather than writing the default back.
 *
 * ## Unreadable is not empty
 *
 * A file that exists and cannot be read returns the DEFAULTS and says so,
 * rather than being treated as "nothing overridden". Both produce a working
 * companion, which is exactly why the difference has to be reported: silently
 * running defaults over somebody's edited prompts is the app disagreeing with
 * the screen that shows them.
 */

export const PROMPTS_FILE = 'prompts.json'

export function promptsPath(userData: string): string {
  return join(userData, PROMPTS_FILE)
}

export type PromptsRead =
  | { readonly ok: true; readonly overrides: Readonly<Record<string, string>> }
  /** Present and unusable. The caller runs on defaults and must say so. */
  | { readonly ok: false; readonly why: string }

/**
 * What is on disk, or why it could not be used.
 *
 * Every value is checked to be a string: the file sits in the user's own data
 * directory and is hand-editable, so a number or an object under a key would
 * otherwise reach the wire as `[object Object]` in her instructions.
 */
export function readPromptOverrides(userData: string): PromptsRead {
  const read = readBounded(promptsPath(userData))
  if (!read.ok) {
    // Absent is the ordinary state -- nothing has been changed yet.
    if (read.reason.kind === 'absent') return { ok: true, overrides: {} }
    return { ok: false, why: logBoundedRead(read.reason) }
  }
  let value: unknown
  try {
    value = JSON.parse(read.text)
  } catch {
    return { ok: false, why: 'it is not JSON' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, why: 'it does not hold an object' }
  }
  const overrides: Record<string, string> = {}
  for (const [key, text] of Object.entries(value)) {
    if (typeof text === 'string') overrides[key] = text
  }
  return { ok: true, overrides }
}

/** Answers the text for a key. Built once and passed down. */
export type Prompts = (key: string) => string

/**
 * The resolver: an override when there is one, the default otherwise.
 *
 * Takes the catalogue so the defaults come from one place, and an unknown key
 * answers empty rather than throwing -- a caller asking for a prompt that no
 * longer exists is a bug worth seeing in the prompt she is sent, not a crash in
 * the middle of a session.
 */
export function resolvePrompts(
  specs: readonly PromptSpec[],
  overrides: Readonly<Record<string, string>>,
): Prompts {
  const defaults = new Map(specs.map((spec) => [spec.key, spec.text]))
  return (key: string) => {
    /*
      THE CATALOGUE DECIDES WHAT A KEY IS, and the override only decides what it
      says.

      This was `overrides[key] ?? defaults.get(key) ?? ''`, which reads the
      stored file FIRST — so a key the catalogue no longer has still resolved,
      to whatever a `prompts.json` happened to hold for it. That contradicts
      this function's own docblock two lines up, and it is reachable: the file
      is hand-editable, and a prompt renamed or removed between releases leaves
      its old entry behind on every machine that had edited it.

      The failure it produces is the quiet kind. A resolver answering a stale
      string looks exactly like one answering a current string, and the only
      symptom is a model being sent wording nobody can find in the settings
      pane — because the pane draws the catalogue, which no longer has the key.
    */
    const shipped = defaults.get(key)
    if (shipped === undefined) return ''
    return overrides[key] ?? shipped
  }
}

/** What the pane draws: the default, the override, and anything worrying. */
export interface PromptRow {
  readonly key: string
  readonly title: string
  readonly purpose: string
  readonly text: string
  readonly edited: boolean
  /**
   * Required phrases this override has dropped.
   *
   * Reported rather than refused. The phrase matters -- `askWorkspace.framing`
   * carries the `sources` contract `parseFields` enforces -- but somebody
   * editing their own prompt may know precisely what they are doing, and a
   * refusal would make this a lock wearing a warning's clothes. What it must
   * not do is fail silently, which is what it did when there was no screen.
   */
  readonly missing: readonly string[]
  /**
   * The longest this one may be, or absent when nothing bounds it.
   *
   * Carried to the pane rather than left to main alone, for the reason the
   * hearing pane states about its own limit: a control somebody can see should
   * name the limit before a write is attempted, not after one is refused.
   */
  readonly limit?: number
}

export function promptRows(
  specs: readonly PromptSpec[],
  overrides: Readonly<Record<string, string>>,
): readonly PromptRow[] {
  return specs.map((spec) => {
    const override = overrides[spec.key]
    const text = override ?? spec.text
    return {
      key: spec.key,
      title: spec.title,
      purpose: spec.purpose,
      text,
      edited: override !== undefined,
      missing: missingFrom(spec, text),
      ...(spec.limit === undefined ? {} : { limit: spec.limit }),
    }
  })
}

/**
 * Override one prompt, or clear it.
 *
 * Text identical to the default CLEARS rather than storing a copy, so a prompt
 * edited back to what it was stops being pinned -- otherwise it would keep
 * today's wording for ever while reporting itself unedited.
 */
export function writePromptOverride(
  userData: string,
  specs: readonly PromptSpec[],
  key: string,
  text: string | null,
): void {
  const read = readPromptOverrides(userData)
  /*
    A write over an unreadable file would replace edits nobody could read.

    `worn.ts` was corrected to this rule on 2026-08-19 and `bubbleSideMigrated`
    on 2026-08-24: absent means "nothing yet", anything else means "cannot
    tell", and cannot-tell must not become an overwrite.
  */
  if (!read.ok) throw new Error(`the prompts file could not be read: ${read.why}`)
  /*
    THE SAME RULE ON THE WAY IN, because a resolver that ignores unknown keys
    and a writer that accepts them means the file collects entries nothing will
    ever read again.

    The IPC handler checks this, which is why it has not happened; the check
    belonging to the handler rather than the store is what makes it a matter of
    every future caller remembering. `resolvePrompts` above now refuses to
    resolve an unknown key, so writing one is writing a line that is dead the
    moment it lands — and it would persist through every later save, because the
    merge preserves what it does not recognise.
  */
  const spec = specs.find((one) => one.key === key)
  if (spec === undefined) {
    throw new Error(`${key} is not a prompt this build has; refusing to store an override for it`)
  }
  const next = { ...read.overrides }
  const fallback = spec.text
  if (text === null || text === fallback) delete next[key]
  else next[key] = text
  writeJsonAtomically(promptsPath(userData), next)
}
