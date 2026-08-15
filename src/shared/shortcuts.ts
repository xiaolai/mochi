/**
 * Which keys do what, as a value both processes can hold.
 *
 * `ShortcutId` moved here from `main/surfaces/shortcuts.ts` the moment these
 * became editable: the settings window now names an action when it sends a new
 * binding, and an id defined in main is one the renderer would have to
 * duplicate as a string literal. Two lists of the same actions is how a fourth
 * shortcut ends up wired in one process and unknown in the other.
 *
 * The REGISTERING still lives in main, because `globalShortcut` does.
 */

import { parseAccelerator, toAccelerator, type Chord } from './accelerator'

export const SHORTCUT_IDS = ['toggleVisible', 'toggleAwake', 'askWorkspace'] as const
export type ShortcutId = (typeof SHORTCUT_IDS)[number]

/** An accelerator per action, as Electron spells it. */
export type Shortcuts = Readonly<Record<ShortcutId, string>>

/**
 * The defaults, parsed rather than trusted.
 *
 * `Control+Shift` rather than `CommandOrControl+Shift`: on macOS the Command
 * layer is crowded with system and application bindings, and these have to work
 * while another application has focus.
 */
export const DEFAULT_SHORTCUTS: Shortcuts = {
  toggleVisible: 'Control+Shift+M',
  toggleAwake: 'Control+Shift+L',
  // The same family as the other two, deliberately: one modifier pair to learn.
  //
  // This key is an AUTHORISATION, not merely a convenience. It stays
  // live when the trigger is `anytime` -- there it becomes the faster entrance
  // rather than the only one.
  askWorkspace: 'Control+Shift+K',
}

/**
 * The defaults as chords, parsed once at load.
 *
 * Built eagerly so a typo in the constants above is a crash on the first
 * import — in the test run, not on somebody's machine — rather than a shortcut
 * that quietly does nothing. It also gives `chordsOf` a real value to fall back
 * to, which is what lets that function drop its non-null assertion.
 */
const DEFAULT_CHORDS: Readonly<Record<ShortcutId, Chord>> = (() => {
  const out = {} as Record<ShortcutId, Chord>
  for (const id of SHORTCUT_IDS) {
    const chord = parseAccelerator(DEFAULT_SHORTCUTS[id])
    if (chord === null) throw new Error(`the default shortcut for ${id} does not parse`)
    out[id] = chord
  }
  return out
})()

/**
 * Read a stored or transmitted set, falling back per action.
 *
 * Per ACTION, not all-or-nothing: one unreadable binding must not silently
 * reset the other, which is what a single early return would do. A user who
 * hand-edits the file and fumbles one line should lose that line only.
 *
 * Clamped rather than rejected, like `sizePercent` and unlike a persona: a
 * shortcut has an obvious nearest-valid answer — the default — and refusing to
 * start because one is malformed would be worse than starting with a key the
 * user has to re-set.
 */
export function readShortcuts(value: unknown): {
  readonly shortcuts: Shortcuts
  /**
   * The actions whose stored binding did not parse.
   *
   * Ids, not sentences. This is read by two callers with different needs — a
   * startup log in English and a settings window in the user's language — and
   * a module that returns prose has already chosen for both of them.
   */
  readonly problems: readonly ShortcutId[]
} {
  const problems: ShortcutId[] = []
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  const out: Record<ShortcutId, string> = { ...DEFAULT_SHORTCUTS }
  for (const id of SHORTCUT_IDS) {
    const raw = record[id]
    if (raw === undefined) continue
    const chord = parseAccelerator(raw)
    if (chord === null) {
      problems.push(id)
      continue
    }
    out[id] = toAccelerator(chord)
  }
  return { shortcuts: out, problems }
}

/**
 * Is this set self-consistent?
 *
 * Two actions on one chord is the conflict the OS will not report: registering
 * the same accelerator twice succeeds, and the second handler simply never
 * runs. The user presses the key, gets the other action, and nothing anywhere
 * says why — so it has to be caught here, before anything is registered.
 */
export function collides(shortcuts: Shortcuts): ShortcutId | null {
  const seen = new Map<string, ShortcutId>()
  for (const id of SHORTCUT_IDS) {
    const existing = seen.get(shortcuts[id])
    if (existing !== undefined) return id
    seen.set(shortcuts[id], id)
  }
  return null
}

/**
 * The chords, for anything that wants them parsed.
 *
 * Falls back per action rather than asserting. The assertion that used to be
 * here was justified by "everything in a `Shortcuts` came through
 * `readShortcuts`" — which the TYPE does not say. `Shortcuts` is a record of
 * strings, so any object literal satisfies it, and a `!` that is true only
 * because of a convention elsewhere throws `undefined` into a `Chord` the day
 * the convention is broken. A fallback is one line and cannot.
 */
export function chordsOf(shortcuts: Shortcuts): Readonly<Record<ShortcutId, Chord>> {
  const out = {} as Record<ShortcutId, Chord>
  for (const id of SHORTCUT_IDS) {
    out[id] = parseAccelerator(shortcuts[id]) ?? DEFAULT_CHORDS[id]
  }
  return out
}
