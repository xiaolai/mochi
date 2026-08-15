/**
 * Which chords the OS actually gave us.
 *
 * `shortcuts.ts` next door does the registering; this owns the ANSWER, which
 * two surfaces read and neither owns: the tray prints the accelerator beside
 * its menu item, and the settings window marks a binding as taken. Both were
 * reading a mutable variable in the composition root.
 *
 * Kept as its own record rather than derived from the preferences, because the
 * preference is what the user ASKED for and this is what happened. A chord
 * another application owns appears in both, differently — the settings window
 * has to show you the combination you chose even when it does not work, or the
 * setting reads as though it never saved.
 */

import { describeAccelerator } from '@shared/accelerator'
import { SHORTCUT_IDS, chordsOf, type ShortcutId, type Shortcuts } from '@shared/shortcuts'
import { registerShortcuts, type Handlers } from './shortcuts'

/** `null` where the OS refused. Never absent: every action has an entry. */
export type Claimed = Readonly<Record<ShortcutId, string | null>>

const NONE: Claimed = { toggleVisible: null, toggleAwake: null, askWorkspace: null }

let claimed: Claimed = NONE

export function claimedShortcuts(): Claimed {
  return claimed
}

/**
 * Register the current set, and record what stuck.
 *
 * Reset to `NONE` first, so a rebind that loses a chord to another application
 * reports it as lost rather than leaving the previous success in place — the
 * record has to describe this registration, not the best one ever achieved.
 */
export function claimShortcuts(shortcuts: Shortcuts, handlers: Handlers): Claimed {
  claimed = NONE
  const chords = chordsOf(shortcuts)
  const outcomes = registerShortcuts(
    SHORTCUT_IDS.map((id) => ({ id, chord: chords[id] })),
    handlers,
  )
  for (const outcome of outcomes) {
    const shown = describeAccelerator(outcome.chord, process.platform)
    if (outcome.ok) {
      claimed = { ...claimed, [outcome.id]: outcome.accelerator }
      console.log(`[keys] ${shown} -> ${outcome.id}`)
    } else {
      console.warn(`[keys] ${shown} could not be claimed for ${outcome.id}: ${outcome.why}`)
    }
  }
  return claimed
}
