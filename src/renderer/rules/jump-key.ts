/**
 * Whether a keystroke is the one that opens "find a setting".
 *
 * ## Why this is a rule rather than three clauses in a listener
 *
 * It shipped as `event.metaKey || event.ctrlKey`, under a comment that said
 * *"`metaKey` on macOS and `ctrlKey` elsewhere"*. The comment described the
 * intent and the code accepted either modifier on every platform, which is not
 * a near-miss — **on macOS `Control+K` is kill-to-end-of-line**, a standard
 * text-editing binding that every native text field honours. The panel would
 * have swallowed it, with `preventDefault`, in the thirty prompt editors that
 * are the whole reason this feature exists.
 *
 * A decision with four ways to be subtly wrong belongs somewhere a test can
 * reach it. That is the same argument `whatWasPressed` makes about the key
 * capture in `settings/pane/pressed.ts`, and it is the same shape: five
 * branches that were previously tangled with a DOM builder and therefore
 * unexercised.
 *
 * ## The platform is GIVEN, never sniffed
 *
 * `key-glyphs.ts` states the rule and the reason: *"a renderer guessing from a
 * user-agent string is one that gets it wrong on some machine and cannot be
 * told it did"*. `SettingsAbout.platform` is `process.platform`, so this takes
 * the same value the keys pane draws its ⌃ ⇧ glyphs from.
 *
 * `null` — the platform is not known yet — answers NO. It is the safe direction
 * for the same reason the whole rule exists: opening on the wrong modifier
 * steals a key that belongs to the text field, while not opening costs one
 * keystroke. `main.ts` reads the settings once at startup so the window is only
 * ever in that state for the moment before its first read lands.
 */

/** Only what the decision reads, so a test does not have to build an event. */
export interface Pressed {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  /** Whether the key is being held down. See below — a held key must not re-open. */
  readonly repeat: boolean
}

export function opensJump(pressed: Pressed, platform: string | null): boolean {
  if (pressed.key.toLowerCase() !== 'k') return false
  if (platform === null) return false
  /*
    HELD KEYS DO NOT RE-OPEN.

    `openJump` returns early when the panel is already up, so a repeat is
    harmless today — but it still calls `preventDefault`, and the guard is one
    line against the next time this predicate gains a branch that is not
    idempotent.
  */
  if (pressed.repeat) return false
  /*
    EXACTLY ONE MODIFIER, and it is the platform's primary one.

    The other one is rejected rather than ignored: `Control+Command+K` is a
    combination somebody may have bound elsewhere, and a shortcut that fires on
    a superset of itself is one that cannot be avoided by adding a modifier.
    Shift is rejected for the same reason — `Shift+Command+K` is a distinct
    binding in most applications and this is not it.
  */
  if (pressed.altKey || pressed.shiftKey) return false
  const onMac = platform === 'darwin'
  const primary = onMac ? pressed.metaKey : pressed.ctrlKey
  const other = onMac ? pressed.ctrlKey : pressed.metaKey
  return primary && !other
}
