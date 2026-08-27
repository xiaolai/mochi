import { type ByPronoun } from './pronoun'

/**
 * The two keys that reach her without a mouse.
 *
 * A companion you have to go and click on is one you stop calling — and the two
 * things you want from her most often are the two things that need her NOT to
 * be in front of you: quiet, now, because somebody walked in; and gone, now,
 * because you need the corner of the screen.
 *
 * ## Why `Control+Shift` and not `Command`
 *
 * Carried over from v1 along with the bindings themselves. On macOS the Command
 * layer is crowded with system and application bindings, and these have to work
 * while another application has focus — that is the entire point of a global
 * shortcut. `Control+Shift` is comparatively empty.
 *
 * ## These are the DEFAULTS, not the bindings
 *
 * They were fixed, and the note here priced the alternative: an accelerator
 * parser, a conflict resolver, a settings pane and a persisted map. Three of
 * those arrived for other reasons — the settings pane exists, `preferences.json`
 * is already a store this build writes, and every other checked change on the
 * bridge has `applyLookup`'s shape. `shared/accelerator.ts` is the fourth.
 *
 * So this is what ships and what a reset goes back to. What is BOUND right now
 * is `store/keys.ts`, and nothing may register from this table directly: a
 * caller that did would be a second answer to what the application is listening
 * for, and it would be the answer that ignores everything somebody chose.
 */

export const SHORTCUTS = {
  /**
   * Wake her, or send her to sleep. Asleep she stops listening entirely.
   */
  rest: 'Control+Shift+L',
  /**
   * Hide her, or bring her back. She keeps listening while hidden: this is
   * about the screen, not about her attention.
   */
  hide: 'Control+Shift+M',
} as const

export type ShortcutId = keyof typeof SHORTCUTS

/**
 * What each key does, in words, one phrasing per pronoun.
 *
 * Here rather than in main, and that placement IS the fix. `listKeys` held this
 * table and read "Let her rest, or wake her" — in a module that never sees
 * `Persona.pronoun`, so a character worn as `he` or `it` was described in this
 * window as `her`, which is the failure `SettingsView.pronoun`'s comment
 * describes: validated, stored, migrated, tested, and never rendered.
 *
 * Beside the keys rather than with the window's other copy because it is the
 * same fact the two comments above already state — a table of what these do,
 * kept anywhere else, is a second place for somebody to change one of them.
 */
export const SHORTCUT_SAYS: Readonly<Record<ShortcutId, ByPronoun>> = {
  rest: {
    she: 'Let her rest, or wake her',
    he: 'Let him rest, or wake him',
    it: 'Let it rest, or wake it',
  },
  hide: {
    she: 'Hide her, or bring her back',
    he: 'Hide him, or bring him back',
    it: 'Hide it, or bring it back',
  },
}
