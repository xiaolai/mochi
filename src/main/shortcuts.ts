/**
 * Claiming the global keys, rebinding them, and saying so when a claim fails.
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
 * A THROW is a different thing and means a malformed accelerator. That used to
 * be a programming error, because the two strings were constants in the source.
 * They are settable now, so `shared/accelerator.ts` is the grammar and every
 * value reaching this file has been through it — the catch stays, because a
 * hand-edited `preferences.json` is not the only way in and a launch that dies
 * on somebody's typo is worse than one that reports it.
 *
 * ## Rebinding gives the old key back BEFORE taking the new one
 *
 * And puts it back when the new one is refused. Registering the replacement
 * first looks safer and is not: `globalShortcut.register` on a combination this
 * process already holds REPLACES the handler and answers true, so a rebind that
 * did not release first could leave the old combination silently firing the new
 * action — and `unregister` afterwards would then take away the binding that
 * had just been made.
 *
 * The order means there is a moment with neither, and a failure in it would
 * leave the key dead. That is what `rollback` is for, and why its own failure is
 * reported rather than swallowed: two applications racing for one combination is
 * rare, and a key that has silently stopped working is exactly the state this
 * module exists to make visible.
 */

import { globalShortcut } from 'electron'
import { type ShortcutId } from '@shared/shortcuts'

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
 * Claim every key, and report each outcome.
 *
 * Every key is attempted, even after one fails: they are independent, and one
 * application holding `Control+Shift+M` says nothing about who holds
 * `Control+Shift+L`. Stopping at the first failure would silently drop a key
 * that was free.
 *
 * The combinations are passed IN rather than read from `SHORTCUTS`. They are a
 * setting now, and a function that reached for the constants would be a second
 * answer to what this application is bound to — the one that ignores everything
 * somebody chose.
 */
export function claimShortcuts(
  handlers: ShortcutHandlers,
  accelerators: Readonly<Record<ShortcutId, string>>,
): readonly ShortcutOutcome[] {
  return (Object.keys(accelerators) as ShortcutId[]).map((id) =>
    claimOne(id, accelerators[id], handlers[id]),
  )
}

/** Claim one, and say what happened. The single place `register` is called. */
export function claimOne(
  id: ShortcutId,
  accelerator: string,
  handler: () => void,
): ShortcutOutcome {
  try {
    const claimed = globalShortcut.register(accelerator, handler)
    return { id, accelerator, refused: claimed ? null : 'another application already has it' }
  } catch (error: unknown) {
    return { id, accelerator, refused: String(error) }
  }
}

/**
 * Move one key to a new combination, putting the old one back if that fails.
 *
 * Answers what the key is bound to NOW, whichever way it went — so the caller
 * has one value to store and one value to show, rather than having to work out
 * which of two attempts is the live one.
 *
 * `wanted` is what was asked for; the answer's `accelerator` is what is
 * actually registered. They differ exactly when the new combination could not
 * be taken AND the old one came back, which is the case a caller must not
 * mistake for success.
 */
export function rebindShortcut(
  id: ShortcutId,
  from: string,
  to: string,
  handler: () => void,
): { readonly outcome: ShortcutOutcome; readonly rolledBack: boolean } {
  release(from)
  const taken = claimOne(id, to, handler)
  if (taken.refused === null) return { outcome: taken, rolledBack: false }
  /*
    Back to where it was, so a refusal costs nothing.

    Without this, choosing a combination another application holds would take
    away the key that WAS working — punishing somebody for trying, in the one
    control where trying is how you find out.
  */
  release(to)
  const back = claimOne(id, from, handler)
  return { outcome: back, rolledBack: true }
}

/**
 * Give one combination back, tolerating one that was never held.
 *
 * `unregister` on a combination this process does not hold is a no-op in
 * Electron, and this is called in exactly that case during a rollback — the
 * refused registration may or may not have taken. Wrapped anyway: a throw here
 * would abandon a rebind halfway, with the old key already released.
 */
function release(accelerator: string): void {
  try {
    globalShortcut.unregister(accelerator)
  } catch (error: unknown) {
    console.error(`[keys] could not give back ${accelerator}:`, error)
  }
}

/**
 * Give them all back.
 *
 * A global shortcut outlives the window that wanted it, so this is not
 * housekeeping: without it a relaunch during development finds its own keys
 * already taken, by itself.
 */
export function releaseShortcuts(): void {
  globalShortcut.unregisterAll()
}
