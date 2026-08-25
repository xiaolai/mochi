import { ipcMain } from 'electron'

import type { SettingsWrite } from '@shared/ipc'
import type { Transcripts } from '../store/transcripts'

/**
 * Clear part of her store, or all of it.
 *
 * ## Why this one lifts out and the others do not
 *
 * `index.ts` holds twenty-one mutable bindings and most of its handlers reach
 * several of them, which is why extracting them costs more interface than it
 * removes. This one reaches exactly two things — who is worn, and the store —
 * and neither is state it writes. Two thunks is a smaller surface than the
 * forty lines it takes with it.
 *
 * ## Why the sweeping gestures are here rather than in a tool
 *
 * The same rule `history:forget` states about permanent deletion: these are the
 * ones that want to be seen before they happen, by the person whose data it is.
 * Removing one entry is a conversation she can have — `forget_kept` — and does
 * not belong on this side.
 */
export interface ForgetKeptDeps {
  /** Who is worn right now, read at the moment the message arrives. */
  readonly worn: () => string
  /** Her store, or null when it could not be opened. */
  readonly store: () => Transcripts | null
}

export function registerForgetKept(deps: ForgetKeptDeps): void {
  const refuse = (why: string): SettingsWrite => ({ ok: false, why })

  ipcMain.handle('shelf:forget-kept', (_event, action: unknown): SettingsWrite => {
    if (typeof action !== 'object' || action === null) return refuse('That is not something to do.')
    const store = deps.store()
    if (store === null) return refuse('Her store could not be opened.')
    const worn = deps.worn()

    /*
      The sheet says who it was drawn for, and a stale answer is refused.

      Without this the window resolves "her" at CLICK time: switching character
      between drawing the button and pressing it would clear the store of
      whoever is worn NOW, which is precisely the irreversible mistake the
      section exists to make safe.
    */
    const meant = (action as { personaId?: unknown }).personaId
    if (typeof meant !== 'string' || meant !== worn) {
      return refuse('That was for a different character. Look again and repeat it.')
    }

    const kind = (action as { kind?: unknown }).kind
    if (kind === 'all') {
      store.kept.forgetAll(worn)
      return { ok: true }
    }
    if (kind === 'collection') {
      const collection = (action as { collection?: unknown }).collection
      if (typeof collection !== 'string') return refuse('That is not something to forget.')
      store.kept.forgetCollection(worn, collection)
      return { ok: true }
    }
    return refuse('That is not something to do.')
  })
}
