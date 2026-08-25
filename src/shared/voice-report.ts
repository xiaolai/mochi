import type { VoiceReport } from './ipc'

/**
 * What the renderer says the session is doing, checked rather than assumed.
 *
 * The handler this replaces did `report as VoiceReport` — a cast, which is a
 * statement about what the author believed, not a check on what arrived. Every
 * field travelled to `problems`, to the idle clock, and to SQLite exactly as
 * the renderer sent it.
 *
 * The one that mattered is `at`. `node:sqlite` stores any number an INTEGER
 * column takes but throws `RangeError` when reading one back outside ±2^53 —
 * for the whole result set, not the row. A single turn filed at `1e17` makes
 * the conversation list throw on every launch, and the list is the pane
 * holding the delete buttons, so nothing inside the app can undo it.
 *
 * Returns a REBUILT object, never the input. A guard that narrows a type in
 * place still passes the caller's object through, and the store writes what it
 * is handed; rebuilding is what makes "validated" mean the fields are the ones
 * named here.
 */

/**
 * An epoch value this app can store, sort, and read back.
 *
 * Duplicated from `main/store/instant.ts` rather than imported: this module is
 * `shared/` and may not reach into `main/`. Both are three lines and both are
 * tested, and the alternative — a `shared/` module existing only so a store
 * can share a predicate with an IPC boundary — is a layer invented for one
 * constant. If a third caller appears, that is when it earns the move.
 */
function usableInstant(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function readHeard(value: unknown): { readonly at: number; readonly interruptedAt: number } | null {
  if (value === null || typeof value !== 'object') return null
  const heard = value as Record<string, unknown>
  if (!usableInstant(heard['at']) || !usableInstant(heard['interruptedAt'])) return null
  return { at: heard['at'], interruptedAt: heard['interruptedAt'] }
}

/**
 * `null` when the payload is not something main should act on.
 *
 * Null rather than a thrown error, because the caller is an `ipcMain.on`
 * listener: throwing there crosses no boundary anybody can catch, and an
 * unhandled rejection in the main process takes the app with it.
 */
export function readVoiceReport(value: unknown): VoiceReport | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const report = value as Record<string, unknown>

  switch (report['kind']) {
    case 'flushed':
      return { kind: 'flushed' }

    case 'expiry': {
      // Unix SECONDS here, unlike every other instant in this file, which is
      // why it gets the same predicate rather than the same bound.
      const expiresAt = report['expiresAt']
      if (!usableInstant(expiresAt)) return null
      return { kind: 'expiry', expiresAt }
    }

    case 'heard': {
      const transcript = report['transcript']
      if (typeof transcript !== 'string') return null
      return { kind: 'heard', transcript }
    }

    case 'said': {
      const transcript = report['transcript']
      const phase = report['phase']
      const at = report['at']
      if (typeof transcript !== 'string') return null
      if (phase !== null && typeof phase !== 'string') return null
      if (!usableInstant(at)) return null
      // `heard: null` is the ordinary case — she finished naturally — so its
      // absence cannot be distinguished from a malformed one by truthiness.
      // Checked for the property, then parsed.
      const raw = report['heard']
      if (raw === null || raw === undefined) {
        return { kind: 'said', transcript, phase, at, heard: null }
      }
      const heard = readHeard(raw)
      if (heard === null) return null
      return { kind: 'said', transcript, phase, at, heard }
    }

    case 'pointer': {
      // Drives click-through on the companion window. A missing `onHer` here
      // was the failure this parser nearly introduced: the first draft handled
      // four of the seven kinds, the tests covered the same four, and the
      // three it dropped -- pointer, state, note -- would have gone silently
      // dead. Every member of the union is listed for that reason.
      const onHer = report['onHer']
      if (typeof onHer !== 'boolean') return null
      return { kind: 'pointer', onHer }
    }

    case 'state': {
      const state = report['state']
      if (typeof state !== 'string') return null
      return { kind: 'state', state }
    }

    case 'note': {
      const text = report['text']
      if (typeof text !== 'string') return null
      return { kind: 'note', text }
    }

    default:
      return null
  }
}
