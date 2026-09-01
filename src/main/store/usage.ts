import { join } from 'node:path'
import { isCapabilityName } from '@shared/capability/manifest'
import { logBoundedRead, readBounded } from './read-bounded'
import { writeJsonAtomically } from './json-file'

/**
 * When each capability was last called — the half of the ledger that outlives
 * the process.
 *
 * ## Why this file exists rather than a query on the ledger
 *
 * The autonomy panel's whole affordance is *"last used"*: a standing grant you
 * can revoke is only a decision somebody can actually make if they can see
 * whether the thing has been used. The handoff assumed the capability ledger
 * already had it — *"'Last used' comes from the capability ledger, which
 * already records every call"* — and it does record every call, in a
 * `Map<callId, …>` that dies with the process.
 *
 * A panel showing "never" for a capability she used yesterday is worse than a
 * panel with no column at all, because it reads as a fact rather than as a gap.
 * So the durable half is here, and it is one small file rather than a row in
 * the transcript database: it is not a transcript, it is not per persona, and
 * it must be readable before the archive has ever been opened.
 *
 * ## Not per persona, deliberately
 *
 * A grant is what this machine lets her do, whoever is worn — see
 * `plan-shell.md`'s split. Filing use under a persona would make "last used"
 * mean something different from the switch beside it, and the two would
 * disagree the first time somebody changed character.
 *
 * ## Every key is checked on the way out
 *
 * The file sits in the user's own data directory and is hand-editable, so a key
 * that reached the panel unchecked would be attacker-controlled text drawn as a
 * capability name. `isCapabilityName` is the same grammar the manifest parser
 * enforces, asked here rather than restated.
 */

const USAGE_FILE = 'usage.json'

export function usagePath(userData: string): string {
  return join(userData, USAGE_FILE)
}

/**
 * What is on disk, or the fact that it could not be read.
 *
 * A UNION rather than a bare map, because "nothing has been used" and "the
 * record could not be read" are different answers and only one of them is a
 * claim. Collapsing them made the panel say "Never used" beside a capability
 * she had called that morning — which is precisely what 5b's acceptance
 * forbids: the column is real, or the row does not claim it.
 */
export type Usage =
  | { readonly ok: true; readonly used: ReadonlyMap<string, number> }
  | { readonly ok: false; readonly why: string }

/**
 * When each capability was last called, or why that is not known.
 *
 * An unreadable or malformed file answers `{ ok: false }` rather than throwing.
 * Getting this wrong costs a column; refusing to open the settings window over
 * it would cost the window.
 */
export function readUsage(userData: string): Usage {
  const found = new Map<string, number>()
  const read = readBounded(usagePath(userData))
  if (!read.ok) {
    // ABSENT is a real answer: nothing has been called yet, which is what a
    // fresh installation looks like and is not a gap in the record.
    if (read.reason.kind === 'absent') return { ok: true, used: found }
    const why = logBoundedRead(read.reason)
    console.warn(`[usage] ${why}`)
    return { ok: false, why }
  }

  let value: unknown
  try {
    value = JSON.parse(read.text)
  } catch (error: unknown) {
    console.warn('[usage] usage.json is not valid JSON:', error)
    return { ok: false, why: 'usage.json is not valid JSON' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    console.warn('[usage] usage.json does not hold a record of use')
    return { ok: false, why: 'usage.json does not hold a record of use' }
  }

  for (const [name, at] of Object.entries(value as Record<string, unknown>)) {
    // Both halves checked. A name becomes a row label in the settings window,
    // and a time becomes a date somebody reads — `new Date(NaN)` renders as
    // "Invalid Date", which is a worse answer than the row saying "never".
    if (!isCapabilityName(name)) continue
    if (!isWhen(at)) continue
    found.set(name, at)
  }
  return { ok: true, used: found }
}

/**
 * Whether a value is a time this application can show somebody.
 *
 * `Number.isFinite` alone is not enough, and the gap is not theoretical: a
 * finite number past `Date`'s ±8.64e15 range passes it, is stored, and renders
 * as the literal string "Invalid Date" in the panel — a worse answer than the
 * row saying nothing at all.
 */
function isWhen(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false
  return Number.isFinite(new Date(value).getTime())
}

/**
 * Record that a capability was just called.
 *
 * Read, change one key, write the whole object back — the same shape
 * `worn.ts` uses on `preferences.json`, and for the same reason: a writer that
 * knew only its own key would drop everybody else's.
 *
 * MONOTONIC. A clock that jumped backwards — a manual change, an NTP
 * correction, a machine resuming from sleep — would otherwise make a capability
 * look less recently used than it is, and "last used" going backwards is the
 * one way this column can lie without looking wrong.
 *
 * Throws if it cannot be written. The caller decides what to do about that;
 * swallowing it here would leave the panel showing a time that is not on disk,
 * which is the failure the panel exists to remove.
 */
export function noteUsed(userData: string, name: string, at: number): void {
  if (!isCapabilityName(name)) throw new Error(`not a capability name: ${JSON.stringify(name)}`)
  if (!isWhen(at)) throw new Error(`not a usable time: ${String(at)}`)

  // A file that EXISTS and cannot be read is not rewritten. Everything already
  // in it would be lost, and "she used it at some point" is worth more than one
  // fresh row — the same reasoning `remember_this` gives for refusing to write
  // over a note it could not read.
  const existing = readUsage(userData)
  if (!existing.ok)
    throw new Error(`refusing to write over a record that cannot be read: ${existing.why}`)
  const already = existing.used.get(name)
  if (already !== undefined && already >= at) return

  const next: Record<string, number> = {}
  for (const [key, when] of existing.used) next[key] = when
  next[name] = at
  writeJsonAtomically(usagePath(userData), next)
}
