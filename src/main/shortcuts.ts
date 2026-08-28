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
  /*
    A COMBINATION THIS PASS HAS ALREADY TAKEN IS REFUSED, not registered twice.

    `applyKey` refuses a collision on the way in from the window, and that is
    not enough on its own: `preferences.json` is hand-editable, so two ids can
    arrive here holding one combination without that check ever running. It is
    the argument `readSleepAfterMinutes` makes about the same file — the pane is
    not the only way in.

    Electron does not refuse the second registration. It REPLACES the handler
    and answers true, so without this the second id silently does the first
    one's job, `refused` is null for both, and the pane draws two keys that are
    working. One of them is not.

    Refused rather than reset, and that is the whole reason this belongs here
    rather than in the store: `refused` is a state this build already draws — in
    red, under the row, with a dot in the nav — so the honest outcome is
    already expressible. Correcting the file instead would throw away a
    combination somebody typed and say nothing about it.
  */
  const taken = new Map<string, ShortcutId>()
  return (Object.keys(accelerators) as ShortcutId[]).map((id) => {
    const accelerator = accelerators[id]
    const owner = taken.get(accelerator)
    if (owner !== undefined) {
      /*
        Not named. `owner` is an internal id — "rest" — and `listKeys` exists
        because that is our word for it rather than anything a person is looking
        for. There are two keys, so "another of this application's" is
        unambiguous without leaking the id into a sentence somebody reads.
      */
      void owner
      return { id, accelerator, refused: `another of this application's keys already has it` }
    }
    const outcome = claimOne(id, accelerator, handlers[id])
    // Only when it was actually claimed. A combination another application owns
    // is not one this pass holds, and marking it taken would refuse a second id
    // for a reason that is not true.
    if (outcome.refused === null) taken.set(accelerator, id)
    return outcome
  })
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
  /**
   * What this id is holding, or null when it holds nothing.
   *
   * NULL IS NOT THE SAME AS "the old combination", and conflating them steals a
   * working key. A key can be showing a combination it does not have — refused
   * because another application owns it, or because the other id in this
   * application got there first — and `release` is by COMBINATION, not by id.
   * So releasing it on the way past hands back whatever is registered under that
   * string, which in the self-collision case is the OTHER key's live binding.
   *
   * That makes the obvious repair the destructive one: two keys land on one
   * combination in a hand-edited file, somebody moves the broken one off it, and
   * the key that was working stops. Measured, not reasoned about — it
   * unregistered `Alt+F9` and never put it back.
   */
  from: string | null,
  to: string,
  handler: () => void,
): { readonly outcome: ShortcutOutcome; readonly rolledBack: boolean } {
  /*
    THE SAME COMBINATION IS A NO-OP, not a release and a re-register.

    Saving a settings pane without touching a key sends the combination it
    already has. Releasing it and asking for it back is a window — short, and
    genuinely long enough — in which this application holds nothing and anything
    else on the machine can take it. So an unchanged save could lose the key it
    was saving, which is the one outcome nobody would look for.

    `from === to` means the id holds this and is being asked for it again. The
    caller passes `null` for a key that holds NOTHING (see `from`), so this
    cannot be confused with a key that merely displays the combination.
  */
  if (from !== null && from === to) {
    return { outcome: { id, accelerator: to, refused: null }, rolledBack: false }
  }
  /*
    A RELEASE THAT FAILED IS NOT A RELEASE.

    `release` used to swallow the failure and this went on to register the new
    combination, so both stayed bound: the old one still firing this handler,
    and nothing anywhere saying so. `unregister` throwing is rare and it is
    exactly the case where carrying on is wrong, because the thing that follows
    depends on it having worked.
  */
  if (from !== null && !release(from)) {
    return {
      outcome: { id, accelerator: from, refused: 'the old key could not be given back' },
      rolledBack: false,
    }
  }
  const taken = claimOne(id, to, handler)
  if (taken.refused === null) return { outcome: taken, rolledBack: false }
  /*
    Back to where it was, so a refusal costs nothing.

    Without this, choosing a combination another application holds would take
    away the key that WAS working — punishing somebody for trying, in the one
    control where trying is how you find out.
  */
  release(to)
  // Nothing to go back to. The id held nothing before and holds nothing now,
  // which is no worse than it was — and reporting it as a rollback would tell
  // the caller a working binding was restored when none existed.
  if (from === null) return { outcome: taken, rolledBack: false }
  const back = claimOne(id, from, handler)
  return { outcome: back, rolledBack: true }
}

/**
 * Give one combination back. ANSWERS whether it went.
 *
 * `unregister` on a combination this process does not hold is a no-op in
 * Electron, and this is called in exactly that case during a rollback — the
 * refused registration may or may not have taken. Wrapped, because a throw here
 * would abandon a rebind halfway with the old key already released.
 *
 * The ANSWER is the part that was missing. This returned `void`, so a caller
 * could not tell a release from a failed one, and `rebindShortcut` went on to
 * register the new combination either way — leaving both bound, the old one
 * still firing, with nothing anywhere saying so.
 */
function release(accelerator: string): boolean {
  try {
    globalShortcut.unregister(accelerator)
    return true
  } catch (error: unknown) {
    console.error(`[keys] could not give back ${accelerator}:`, error)
    return false
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
