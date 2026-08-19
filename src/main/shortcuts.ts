/**
 * Claiming the two global keys, and saying so when a claim fails.
 *
 * ## Registration can fail, and failing quietly is the bug
 *
 * `globalShortcut.register()` returns FALSE when another application already
 * owns the combination. That is an ordinary outcome — plenty of things take
 * `Control+Shift+L` — and the wrong response is to carry on: somebody presses
 * the key, something else happens, and nothing anywhere says this application
 * wanted it. v1 learned that and reported every failure; the same reasoning
 * holds here, and the reporting now has somewhere to go, because `problems.ts`
 * exists and the conversations window can show it.
 *
 * A THROW is a different thing and means a malformed accelerator. The two
 * strings live in `shared/shortcuts.ts` as constants, so that is a programming
 * error rather than a runtime condition — caught here so it is reported like
 * everything else rather than taking the launch down.
 */

import { globalShortcut } from 'electron'
import { SHORTCUTS, type ShortcutId } from '@shared/shortcuts'

export interface ShortcutHandlers {
  readonly rest: () => void
  readonly hide: () => void
}

export interface ShortcutOutcome {
  readonly id: ShortcutId
  readonly accelerator: string
  /** Null when it was claimed. The reason, in a sentence, when it was not. */
  readonly refused: string | null
}

/**
 * Claim both, and report each outcome.
 *
 * Every key is attempted, even after one fails: they are independent, and one
 * application holding `Control+Shift+M` says nothing about who holds
 * `Control+Shift+L`. Stopping at the first failure would silently drop a key
 * that was free.
 */
export function claimShortcuts(handlers: ShortcutHandlers): readonly ShortcutOutcome[] {
  return (Object.keys(SHORTCUTS) as ShortcutId[]).map((id) => {
    const accelerator = SHORTCUTS[id]
    try {
      const claimed = globalShortcut.register(accelerator, handlers[id])
      return {
        id,
        accelerator,
        refused: claimed ? null : 'another application already has it',
      }
    } catch (error: unknown) {
      return { id, accelerator, refused: String(error) }
    }
  })
}

/**
 * Give them back.
 *
 * A global shortcut outlives the window that wanted it, so this is not
 * housekeeping: without it a relaunch during development finds its own keys
 * already taken, by itself.
 */
export function releaseShortcuts(): void {
  globalShortcut.unregisterAll()
}
