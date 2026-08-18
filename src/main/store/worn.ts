import { join } from 'node:path'
import { isPersonaId } from '@shared/persona'
import { logBoundedRead, readBounded } from './read-bounded'
import { writeJsonAtomically } from './json-file'

/**
 * Which persona is being worn, remembered across restarts.
 *
 * ## One field, not a preferences store
 *
 * v1 kept this in `preferences.json` alongside window size, shortcuts, sound
 * settings, the delegation config and the model choice. That file's reader was
 * not migrated, because it pulls in five shared modules describing a settings
 * window that does not exist here yet — and none of that is needed to answer
 * "who is she today".
 *
 * So this reads **one key** out of that file, and now writes that one key back.
 * It was a read for as long as nothing in v2 could switch personas; the
 * settings window can, and the note left here said plainly that when a switcher
 * existed it should own this file rather than grow a second one beside it.
 *
 * Owning it means **read, change one key, write the whole object back**. v1's
 * file has window geometry, shortcuts and a model choice in it, and this
 * version understands none of those. Writing `{ activePersonaId }` alone would
 * silently discard somebody's settings for an application that may still be
 * installed — so unknown keys are carried through untouched, and a file that
 * cannot be read at all is replaced rather than merged into blindly.
 *
 * ## Why it matters more than it looks
 *
 * The archive is scoped per persona, which is a privacy property rather than an
 * accident: wearing A must not read B's conversations. So getting this wrong is
 * not cosmetic — the real installation on this machine has 21 conversations
 * under `loki`, and a v2 that defaults to the built-in `mochi` sees none of
 * them. That presents as "her memory does not work", and the cause is that she
 * is wearing the wrong face.
 */
const PREFERENCES = 'preferences.json'

export function readWornPersonaId(userData: string): string | null {
  const read = readBounded(join(userData, PREFERENCES))
  if (!read.ok) {
    // Absent is the ordinary answer on a fresh install — nobody has chosen, so
    // the caller falls back to the built-in. Anything else is worth a line.
    if (read.reason.kind !== 'absent') {
      console.warn(`[worn] ${logBoundedRead(read.reason)}`)
    }
    return null
  }

  let value: unknown
  try {
    value = JSON.parse(read.text)
  } catch (error: unknown) {
    console.warn('[worn] preferences.json is not valid JSON:', error)
    return null
  }

  const found = (value as { activePersonaId?: unknown } | null)?.activePersonaId
  // Validated rather than trusted. It becomes a lookup key and, downstream, a
  // path segment — the same reasoning `personas.ts` applies to a loose file's
  // stem, at the one line where a name turns into a location.
  if (!isPersonaId(found)) {
    if (found !== undefined) console.warn('[worn] activePersonaId is not a usable id')
    return null
  }
  return found
}

/**
 * Remember who is being worn, without discarding what else is in the file.
 *
 * Atomic, because this is read on every launch and a half-written
 * `preferences.json` presents as her forgetting who she is — and, since the
 * archive is scoped per persona, as her forgetting the person too.
 */
export function writeWornPersonaId(userData: string, id: string): void {
  if (!isPersonaId(id)) throw new Error(`refusing to remember an unusable persona id: ${id}`)

  // Everything already there, kept. See the note above: this file is older than
  // this application and holds keys it does not understand.
  let existing: Record<string, unknown> = {}
  const read = readBounded(join(userData, PREFERENCES))
  if (read.ok) {
    try {
      const value: unknown = JSON.parse(read.text)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        existing = value as Record<string, unknown>
      }
    } catch {
      // Unreadable JSON is REPLACED, not merged into. There is nothing to
      // preserve in a file nothing can parse, and refusing to write would
      // leave the switch silently ineffective.
      console.warn('[worn] preferences.json is not valid JSON; replacing it')
    }
  } else if (read.reason.kind !== 'absent') {
    console.warn(`[worn] ${logBoundedRead(read.reason)}; replacing it`)
  }

  writeJsonAtomically(join(userData, PREFERENCES), { ...existing, activePersonaId: id })
}
