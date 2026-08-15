/**
 * The two keys that reach her without a mouse.
 *
 * Until this existed she was reachable from the tray and from nothing else —
 * and a companion you have to go and click on is one you stop calling. The
 * development-only `MOCHI_WAKE_ON_START` hook existed for exactly this gap and
 * is retired by it.
 *
 * ## Registration can fail, and failing quietly is the bug
 *
 * `globalShortcut.register()` returns FALSE when another application already
 * owns the combination. That is an ordinary outcome — plenty of apps take
 * `Control+Shift+L` — and the wrong response is to carry on: the user presses
 * the key, something else happens, and nothing anywhere says the app wanted it.
 * So every failure is reported to the caller, which puts it in the log and, in
 * time, in the Keys pane.
 *
 * A THROW is a different thing entirely and means a malformed accelerator.
 * `shared/accelerator.ts` makes that unreachable by construction: the only way
 * to produce a string here is `toAccelerator`, which composes members of two
 * fixed sets. The try/catch below is a backstop for the day somebody bypasses
 * that, not a substitute for it.
 */

import { globalShortcut } from 'electron'
import { toAccelerator, type Chord } from '@shared/accelerator'
import type { ShortcutId } from '@shared/shortcuts'

/**
 * Re-exported, never redeclared.
 *
 * This file declared its own copy of the union after the canonical one moved to
 * `shared/`. Two independent lists of the same actions compile perfectly and
 * drift the first time a third shortcut is added to one of them.
 */
export type { ShortcutId }

export interface Binding {
  readonly id: ShortcutId
  readonly chord: Chord
}

/*
 * There is no modifier-less check here any more, and that is not an omission.
 *
 * There was one, guarding against a hand-assembled `{ modifiers: [], key: 'M' }`
 * reaching `register()` and taking the letter M from every application on the
 * machine. `Chord.modifiers` is now a non-empty tuple, so that object does not
 * typecheck -- the state is unrepresentable rather than rejected, which is the
 * stronger of the two and leaves nothing to forget at a future call site.
 */

/**
 * Carries the CHORD as well as the string.
 *
 * The caller logs each outcome in the platform's own spelling, and to do that
 * it was re-parsing `accelerator` with a non-null assertion -- an assertion
 * true only because this module had just serialised it. Handing back the value
 * it already had removes both the round trip and the `!`.
 */
export type Outcome =
  | {
      readonly id: ShortcutId
      readonly chord: Chord
      readonly accelerator: string
      readonly ok: true
    }
  /** Another application owns it, or the OS refused. */
  | {
      readonly id: ShortcutId
      readonly chord: Chord
      readonly accelerator: string
      readonly ok: false
      readonly why: string
    }

export type Handlers = Readonly<Record<ShortcutId, () => void>>

/**
 * Register them all, replacing anything registered before.
 *
 * Idempotent: it unregisters this app's shortcuts first, so calling it again
 * after the user changes a binding cannot leave the old key live. Without that,
 * rebinding would accumulate — the old chord still firing, with nothing in the
 * interface admitting it exists.
 */
export function registerShortcuts(
  bindings: readonly Binding[],
  handlers: Handlers,
): readonly Outcome[] {
  unregisterShortcuts()
  const outcomes: Outcome[] = []
  for (const binding of bindings) {
    const accelerator = toAccelerator(binding.chord)
    const { id, chord } = binding
    try {
      const ok = globalShortcut.register(accelerator, handlers[binding.id])
      if (ok) held.add(accelerator)
      outcomes.push(
        ok
          ? { id, chord, accelerator, ok: true }
          : {
              id,
              chord,
              accelerator,
              ok: false,
              // The LIKELY reason, said as one. `register` returns false
              // for anything the OS declined -- another owner is the common
              // case, but macOS also refuses when accessibility permission is
              // missing, and some combinations are reserved outright. Stating
              // the certain part and hedging the rest beats a confident wrong
              // diagnosis that sends somebody hunting for an application that
              // is not running.
              why: 'the system refused it, most likely because another application owns it',
            },
      )
    } catch (error: unknown) {
      // Only reachable if a string arrived from outside the closed grammar.
      outcomes.push({ id, chord, accelerator, ok: false, why: String(error) })
    }
  }
  return outcomes
}

/**
 * Give them back.
 *
 * Global shortcuts outlive the window that wanted them; on quit they have to be
 * released or the combination stays claimed for as long as the process does.
 */
export function unregisterShortcuts(): void {
  // OURS only. `globalShortcut.unregisterAll()` releases every accelerator this
  // process holds, including any registered by code that is not this module --
  // so a future feature claiming its own chord would have it silently taken
  // away the next time a shortcut was rebound here. This module knows exactly
  // what it registered; nothing else needs to be its business.
  for (const accelerator of held) globalShortcut.unregister(accelerator)
  held.clear()
}

/** Exactly what this module has claimed, so it can give back no more. */
const held = new Set<string>()
