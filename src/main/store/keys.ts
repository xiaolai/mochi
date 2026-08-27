import { join } from 'node:path'
import { isAccelerator } from '@shared/accelerator'
import { SHORTCUTS, type ShortcutId } from '@shared/shortcuts'
import { logBoundedRead, readBounded } from './read-bounded'
import { writeMerged } from './worn'

/**
 * Which combination each global key is bound to, remembered across restarts.
 *
 * ## `globalKeys`, deliberately not `shortcuts`
 *
 * `preferences.json` already has a `shortcuts` key. It is v1's chord table,
 * `worn.ts` lists it among the seven keys this build carries forward without
 * reading, and the note there is explicit about what to do if one is ever
 * wanted again: *"read it HERE and give it a name this build understands rather
 * than reviving the old one."* Writing this build's answer into v1's key would
 * hand a rolled-back v1 a table in a format it does not parse, and would make
 * the carry-forward rule false the first time somebody used this pane.
 *
 * ## Only what somebody CHOSE is stored
 *
 * An id with no entry is on the shipped combination, which means a reset
 * deletes rather than writes the default back — `store/prompts.ts` argues this
 * at length and the argument is the same one: a key reset today keeps tracking
 * whatever the app ships, instead of freezing at this release's answer while
 * reporting itself unchanged.
 *
 * ## An unusable stored value falls back rather than throwing
 *
 * `globalShortcut.register` throws on a malformed accelerator, and this file is
 * hand-editable — so a value that would throw is dropped here, loudly, and the
 * shipped combination is used instead. The alternative is a launch that dies on
 * a typo in a preferences file, with the fix reachable only by finding and
 * editing that file.
 */
const PREFERENCES = 'preferences.json'

/** The key under which this build stores its answer. Never v1's `shortcuts`. */
export const GLOBAL_KEYS = 'globalKeys'

export type Shortcuts = Readonly<Record<ShortcutId, string>>

/**
 * What each key is bound to today: what somebody chose, or what ships.
 *
 * Always complete, and always usable. Every caller registers or displays the
 * result, and neither has anything sensible to do with a missing entry.
 */
export function readShortcuts(userData: string): Shortcuts {
  const stored = storedKeys(userData)
  const bound: Record<string, string> = {}
  for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
    const chosen = stored[id]
    if (chosen === undefined) {
      bound[id] = SHORTCUTS[id]
      continue
    }
    if (!isAccelerator(chosen)) {
      // Loud, and then ignored. A hand-edited typo must not be able to stop the
      // launch, and it must not pass silently either — the shipped combination
      // is what the pane will show, and somebody has to be able to find out why.
      console.warn(
        `[keys] ${id} is bound to something unusable (${JSON.stringify(chosen)}); using default`,
      )
      bound[id] = SHORTCUTS[id]
      continue
    }
    bound[id] = chosen
  }
  return bound as Shortcuts
}

/**
 * Bind one key, or give it back to whatever the app ships.
 *
 * `null` DELETES the entry rather than writing the current default into it. See
 * the header, and `store/prompts.ts` for the same rule stated at length.
 *
 * It does not check the combination — `applyKey` does that, on the way in from
 * the window, so a refusal reaches somebody as a sentence rather than as a
 * throw. Asserted here anyway, because this file is the last thing between an
 * unusable string and `globalShortcut.register`, which throws on one.
 */
export function writeShortcut(userData: string, id: ShortcutId, accelerator: string | null): void {
  if (accelerator !== null && !isAccelerator(accelerator)) {
    throw new Error(`refusing to store an unusable key combination: ${accelerator}`)
  }
  const next = { ...storedKeys(userData) }
  if (accelerator === null || accelerator === SHORTCUTS[id]) {
    // Choosing the shipped combination is the same as not choosing: storing it
    // would pin this release's answer while reporting itself unedited.
    delete next[id]
  } else {
    next[id] = accelerator
  }
  writeMerged(userData, { [GLOBAL_KEYS]: next })
}

/** The raw map as stored, unchecked. Empty when nothing has been chosen. */
function storedKeys(userData: string): Record<string, unknown> {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) {
    if (read.reason.kind !== 'absent') console.warn(`[keys] ${logBoundedRead(read.reason)}`)
    return {}
  }
  try {
    const value: unknown = JSON.parse(read.text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const found = (value as Record<string, unknown>)[GLOBAL_KEYS]
    if (typeof found !== 'object' || found === null || Array.isArray(found)) return {}
    return { ...(found as Record<string, unknown>) }
  } catch {
    // Nothing to read. `writeMerged` reports the replacement when a write
    // happens; a read has nothing to say beyond falling back to the defaults.
    return {}
  }
}
