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
 * ## Fixed, for now, and that is a scope decision rather than a view
 *
 * v1 made these editable, which cost an accelerator parser, a conflict
 * resolver, a settings pane and a persisted map. None of that is wrong; all of
 * it is a second feature. Two constants get the keys working today, and the
 * shape below — a named action per binding — is what an editor would have
 * needed anyway.
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
