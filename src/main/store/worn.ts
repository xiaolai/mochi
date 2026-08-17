import { join } from 'node:path'
import { isPersonaId } from '@shared/persona'
import { logBoundedRead, readBounded } from './read-bounded'

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
 * So this reads **one key** out of that file. It is deliberately a read and not
 * a store: nothing in v2 can switch personas yet, so nothing has anything to
 * write. When a switcher exists it should own this file properly rather than
 * grow a second one beside it.
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
